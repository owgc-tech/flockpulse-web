import { createClient } from '@supabase/supabase-js';
import { listRoleCatalog, getRoleCatalogEntryById } from '@/src/features/role-catalog/role-catalog.service';
import { ROLE_LABELS } from '@/src/lib/auth/roleLabels';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// DIP-FP-192-web: resolves the tenant's role_catalog once (small, bounded
// list) into a lookup map, rather than a per-row query per member/invitation.
// Falls back to the existing ROLE_LABELS[role] map only when
// role_catalog_entry_id is null or doesn't resolve — defensive, not the
// normal path (every member/invitation gets a role_catalog_entry_id set at
// write time going forward, and the migration backfilled every existing row).
async function buildRoleDisplayNameMap(tenantId: string): Promise<Map<string, string>> {
  const entries = await listRoleCatalog(tenantId);
  return new Map(entries.map(e => [e.id, e.name]));
}

function resolveRoleDisplayName(
  role: string,
  roleCatalogEntryId: string | null,
  nameMap: Map<string, string>
): string {
  if (roleCatalogEntryId) {
    const name = nameMap.get(roleCatalogEntryId);
    if (name) return name;
  }
  return ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role;
}

// DIP-FP-113-web: kept in sync with src/lib/auth/middleware.ts's Role type.
type MemberRoleValue =
  | 'ADMIN'
  | 'LEADER'
  | 'MEMBER'
  | 'SR_COORDINATOR'
  | 'COORDINATOR'
  | 'COMMUNITY_SERVANT'
  | 'PASTORAL_LEADER';

export interface CreateMemberInput {
  tenantId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: MemberRoleValue;
  // DIP-FP-192-web: optional — createMember() has no UI caller today (FP-69's
  // POST /api/members isn't wired to any admin form), so this can't be made
  // required without a breaking change to a currently-unreachable path.
  roleCatalogEntryId?: string;
}

export interface UpdateMemberInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: MemberRoleValue;
  // DIP-FP-192-web: when provided, the caller (app/api/members/route.ts) has
  // already resolved `role` from this entry's tier server-side — see
  // updateMemberRole() below, which is what MemberEditForm.tsx now calls.
  roleCatalogEntryId?: string;
}

// includeDeleted defaults to false for existing callers (event target/food-assignment
// pickers etc., which should only ever offer active members). FP-69's Member List needs
// both active and deactivated members to display a status column, so it passes true.
export async function listMembers(tenantId: string, includeDeleted = false) {
  let q = serviceClient()
    .from('members')
    .select('id, user_id, email, first_name, last_name, role, role_catalog_entry_id, deleted_at, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (!includeDeleted) q = q.is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;

  const nameMap = await buildRoleDisplayNameMap(tenantId);
  return (data ?? []).map(m => ({
    ...m,
    role_display_name: resolveRoleDisplayName(m.role, m.role_catalog_entry_id, nameMap),
  }));
}

// FP-69/FP-72: Edit-screen prefill — same tenant-scoping pattern as listMembers, single row.
export async function getMemberById(id: string, tenantId: string) {
  const { data, error } = await serviceClient()
    .from('members')
    .select('id, user_id, email, first_name, last_name, role, role_catalog_entry_id, deleted_at, created_at')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !data) {
    const err = new Error('Member not found for this tenant') as Error & { code: string };
    err.code = 'NOT_FOUND_IN_TENANT';
    throw err;
  }

  const nameMap = await buildRoleDisplayNameMap(tenantId);
  return { ...data, role_display_name: resolveRoleDisplayName(data.role, data.role_catalog_entry_id, nameMap) };
}

export async function createMember(input: CreateMemberInput) {
  const { data, error } = await serviceClient()
    .from('members')
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      role: input.role,
      role_catalog_entry_id: input.roleCatalogEntryId ?? null,
    })
    .select('id, email, first_name, last_name, role, role_catalog_entry_id, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      const err = new Error('Email already active for this tenant') as Error & { code: string };
      err.code = 'DUPLICATE_EMAIL';
      throw err;
    }
    throw error;
  }
  return data;
}

// DIP-FP-113-adj-2: role edits from this endpoint previously only updated the
// members row — the viewer's JWT app_metadata.role (what every RLS policy and
// requireRole() check actually reads) stayed stale until their next natural
// token refresh. Syncing it here follows the exact same get-then-merge-then-
// write pattern already used by invitation.service.ts and
// registration.service.ts, so tenant_id/member_id/group_id already set on the
// auth user are preserved rather than clobbered.
export async function updateMember(id: string, tenantId: string, input: UpdateMemberInput) {
  const update: Record<string, unknown> = {};
  if (input.firstName !== undefined) update.first_name = input.firstName;
  if (input.lastName !== undefined) update.last_name = input.lastName;
  if (input.email !== undefined) update.email = input.email;

  // DIP-FP-192-web: roleCatalogEntryId is the new normal path — the server
  // (not the client) derives the generic tier `role` value from the entry's
  // tier, never trusting a client-supplied role string alongside it. Plain
  // `role` (no roleCatalogEntryId) stays supported for any other caller.
  let effectiveRole: string | undefined = input.role;
  if (input.roleCatalogEntryId !== undefined) {
    const entry = await getRoleCatalogEntryById(input.roleCatalogEntryId, tenantId);
    effectiveRole = entry.tier;
    update.role_catalog_entry_id = input.roleCatalogEntryId;
    update.role = entry.tier;
  } else if (input.role !== undefined) {
    update.role = input.role;
  }

  const db = serviceClient();

  const { data, error } = await db
    .from('members')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id, user_id, email, first_name, last_name, role, role_catalog_entry_id')
    .single();

  // PGRST116 = PostgREST "no rows returned" for .single() — a nonexistent id, a foreign-tenant
  // id, or an already-deactivated member all land here previously as a raw 500; now mapped
  // to the canonical NOT_FOUND_IN_TENANT so the route can return a proper 404.
  if (error) {
    if (error.code === 'PGRST116') {
      const err = new Error('Member not found for this tenant') as Error & { code: string };
      err.code = 'NOT_FOUND_IN_TENANT';
      throw err;
    }
    throw error;
  }

  if (effectiveRole !== undefined) {
    const { data: userData, error: getUserError } = await db.auth.admin.getUserById(data.user_id);
    if (getUserError || !userData?.user) {
      const err = new Error('Member updated but role metadata sync failed: could not load auth user') as Error & { code: string };
      err.code = 'METADATA_WRITE_FAILED';
      throw err;
    }
    const existingMeta = userData.user.app_metadata as Record<string, unknown>;
    const { error: metaError } = await db.auth.admin.updateUserById(data.user_id, {
      app_metadata: { ...existingMeta, role: effectiveRole },
    });
    if (metaError) {
      const err = new Error(`Member updated but role metadata sync failed: ${metaError.message}`) as Error & { code: string };
      err.code = 'METADATA_WRITE_FAILED';
      throw err;
    }
  }

  const nameMap = await buildRoleDisplayNameMap(tenantId);
  const { user_id: _userId, ...memberWithoutUserId } = data;
  return {
    ...memberWithoutUserId,
    role_display_name: resolveRoleDisplayName(data.role, data.role_catalog_entry_id, nameMap),
  };
}

export interface UpdateMyProfileInput {
  firstName?: string;
  lastName?: string;
  gender?: 'MALE' | 'FEMALE';
  maritalStatus?: 'SINGLE' | 'MARRIED' | 'WIDOWED' | 'DIVORCED' | 'SEPARATED';
  birthdate?: string;
}

// FP-112: self-service profile read — same five fields complete_registration() collects,
// plus the member's own group memberships (folded in here rather than a second endpoint,
// same "one purpose-built response" pattern as reminder-context).
export async function getMyProfile(memberId: string, tenantId: string) {
  const db = serviceClient();

  const { data: member, error } = await db
    .from('members')
    .select('id, first_name, last_name, email, role, role_catalog_entry_id, gender, marital_status, birthdate')
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !member) {
    const err = new Error('Member not found for this tenant') as Error & { code: string };
    err.code = 'NOT_FOUND_IN_TENANT';
    throw err;
  }

  // DIP-FP-192-web: resolved here so UserAvatarMenu.tsx (via the admin shell
  // layout) shows this member's actual catalog title, not just their
  // generic tier.
  const nameMap = await buildRoleDisplayNameMap(tenantId);
  const roleDisplayName = resolveRoleDisplayName(member.role, member.role_catalog_entry_id, nameMap);

  const { data: assignmentRows, error: assignmentsError } = await db
    .from('assignments')
    .select('groups!assignments_group_id_fkey (id, name)')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .eq('assignment_type', 'GROUP')
    .is('deleted_at', null);

  if (assignmentsError) throw assignmentsError;

  const groups = (assignmentRows ?? []).map((row: Record<string, unknown>) => {
    const group = row.groups as { id: string; name: string } | { id: string; name: string }[] | null;
    return Array.isArray(group) ? group[0] : group;
  }).filter((g): g is { id: string; name: string } => g != null);

  return { ...member, role_display_name: roleDisplayName, groups };
}

// FP-112: application-layer enforcement of the members_update_self RLS policy's documented
// intent — only these five fields are ever accepted, mirroring exactly what
// complete_registration()/update_registration()'s own validation already enforces.
export async function updateMyProfile(memberId: string, tenantId: string, input: UpdateMyProfileInput) {
  if (input.gender !== undefined && !['MALE', 'FEMALE'].includes(input.gender)) {
    const err = new Error('gender must be MALE or FEMALE') as Error & { code: string };
    err.code = 'INVALID_VALUE';
    throw err;
  }
  if (input.maritalStatus !== undefined && !['SINGLE', 'MARRIED', 'WIDOWED', 'DIVORCED', 'SEPARATED'].includes(input.maritalStatus)) {
    const err = new Error('maritalStatus must be SINGLE, MARRIED, WIDOWED, DIVORCED, or SEPARATED') as Error & { code: string };
    err.code = 'INVALID_VALUE';
    throw err;
  }
  if (input.birthdate !== undefined && new Date(input.birthdate) > new Date()) {
    const err = new Error('birthdate cannot be in the future') as Error & { code: string };
    err.code = 'INVALID_VALUE';
    throw err;
  }

  const update: Record<string, unknown> = {};
  if (input.firstName !== undefined) update.first_name = input.firstName;
  if (input.lastName !== undefined) update.last_name = input.lastName;
  if (input.gender !== undefined) update.gender = input.gender;
  if (input.maritalStatus !== undefined) update.marital_status = input.maritalStatus;
  if (input.birthdate !== undefined) update.birthdate = input.birthdate;

  const { data, error } = await serviceClient()
    .from('members')
    .update(update)
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id, first_name, last_name, email, gender, marital_status, birthdate')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      const err = new Error('Member not found for this tenant') as Error & { code: string };
      err.code = 'NOT_FOUND_IN_TENANT';
      throw err;
    }
    throw error;
  }
  return data;
}

// Soft-delete only — no hard-delete path exists by design.
export async function softDeleteMember(id: string, tenantId: string) {
  const { data, error } = await serviceClient()
    .from('members')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .single();

  // Previously this silently "succeeded" (no error, no rows-affected check) even when nothing
  // matched — a nonexistent/foreign-tenant/already-deactivated id looked identical to a real
  // deactivation. Checking rows-affected via .select().single() and mapping the PGRST116
  // "no rows" case to NOT_FOUND_IN_TENANT closes that gap.
  if (error) {
    // FP-74: mirrors talk.service.ts's exact pattern for FP-29's analogous guard —
    // code === 'P0001' (Postgres's generic "raised exception" SQLSTATE) then a message
    // substring match, mapped to the same INVALID_STATE_TRANSITION code. The affected-member
    // count is parsed out of the trigger's own message and attached structurally so the route
    // doesn't need to re-parse free text.
    // DIP-FP-193-web: matches the renamed trigger message (migration
    // 20260806000066) — this substring and that RAISE EXCEPTION text must
    // always change together, or the delete-block silently stops matching.
    if (error.code === 'P0001' && error.message?.includes('still assigned as Assigned Leader')) {
      const err = new Error(error.message) as Error & { code: string; assignedMemberCount?: number };
      err.code = 'INVALID_STATE_TRANSITION';
      const match = error.message.match(/to (\d+) member/);
      if (match) err.assignedMemberCount = parseInt(match[1], 10);
      throw err;
    }
    // FP-146: same guard-reason pattern, distinguished by which count field is present —
    // this trigger's message uses "owns N group(s)" instead of "assigned ... to N member(s)".
    // Matched on 'group(s)' specifically (not just 'still owns') since FP-161-2 added a second
    // "still owns" guard reason below whose message also contains that substring.
    if (error.code === 'P0001' && error.message?.includes('still owns') && error.message?.includes('group(s)')) {
      const err = new Error(error.message) as Error & { code: string; ownedGroupCount?: number };
      err.code = 'INVALID_STATE_TRANSITION';
      const match = error.message.match(/owns (\d+) group/);
      if (match) err.ownedGroupCount = parseInt(match[1], 10);
      throw err;
    }
    // FP-161-2: third guard-reason branch — this trigger's message uses "owns N event(s)"
    // instead of "group(s)", distinguished the same way ownedGroupCount is above.
    if (error.code === 'P0001' && error.message?.includes('still owns') && error.message?.includes('event(s)')) {
      const err = new Error(error.message) as Error & { code: string; ownedEventCount?: number };
      err.code = 'INVALID_STATE_TRANSITION';
      const match = error.message.match(/owns (\d+) event/);
      if (match) err.ownedEventCount = parseInt(match[1], 10);
      throw err;
    }
    const err = new Error('Member not found for this tenant') as Error & { code: string };
    err.code = 'NOT_FOUND_IN_TENANT';
    throw err;
  }
  if (!data) {
    const err = new Error('Member not found for this tenant') as Error & { code: string };
    err.code = 'NOT_FOUND_IN_TENANT';
    throw err;
  }
}
