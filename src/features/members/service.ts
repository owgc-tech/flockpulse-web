import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
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
}

export interface UpdateMemberInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: MemberRoleValue;
}

// includeDeleted defaults to false for existing callers (event target/food-assignment
// pickers etc., which should only ever offer active members). FP-69's Member List needs
// both active and deactivated members to display a status column, so it passes true.
export async function listMembers(tenantId: string, includeDeleted = false) {
  let q = serviceClient()
    .from('members')
    .select('id, user_id, email, first_name, last_name, role, deleted_at, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (!includeDeleted) q = q.is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// FP-69/FP-72: Edit-screen prefill — same tenant-scoping pattern as listMembers, single row.
export async function getMemberById(id: string, tenantId: string) {
  const { data, error } = await serviceClient()
    .from('members')
    .select('id, user_id, email, first_name, last_name, role, deleted_at, created_at')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !data) {
    const err = new Error('Member not found for this tenant') as Error & { code: string };
    err.code = 'NOT_FOUND_IN_TENANT';
    throw err;
  }
  return data;
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
    })
    .select('id, email, first_name, last_name, role, created_at')
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
  if (input.role !== undefined) update.role = input.role;

  const db = serviceClient();

  const { data, error } = await db
    .from('members')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id, user_id, email, first_name, last_name, role')
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

  if (input.role !== undefined) {
    const { data: userData, error: getUserError } = await db.auth.admin.getUserById(data.user_id);
    if (getUserError || !userData?.user) {
      const err = new Error('Member updated but role metadata sync failed: could not load auth user') as Error & { code: string };
      err.code = 'METADATA_WRITE_FAILED';
      throw err;
    }
    const existingMeta = userData.user.app_metadata as Record<string, unknown>;
    const { error: metaError } = await db.auth.admin.updateUserById(data.user_id, {
      app_metadata: { ...existingMeta, role: input.role },
    });
    if (metaError) {
      const err = new Error(`Member updated but role metadata sync failed: ${metaError.message}`) as Error & { code: string };
      err.code = 'METADATA_WRITE_FAILED';
      throw err;
    }
  }

  const { user_id: _userId, ...memberWithoutUserId } = data;
  return memberWithoutUserId;
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
    .select('id, first_name, last_name, email, gender, marital_status, birthdate')
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !member) {
    const err = new Error('Member not found for this tenant') as Error & { code: string };
    err.code = 'NOT_FOUND_IN_TENANT';
    throw err;
  }

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

  return { ...member, groups };
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
    if (error.code === 'P0001' && error.message?.includes('still assigned as Pastoral Leader')) {
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
