import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface CreateMemberInput {
  tenantId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'LEADER' | 'MEMBER';
}

export interface UpdateMemberInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: 'ADMIN' | 'LEADER' | 'MEMBER';
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

  if (!includeDeleted) q = (q as any).is('deleted_at', null);

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

export async function updateMember(id: string, tenantId: string, input: UpdateMemberInput) {
  const update: Record<string, unknown> = {};
  if (input.firstName !== undefined) update.first_name = input.firstName;
  if (input.lastName !== undefined) update.last_name = input.lastName;
  if (input.email !== undefined) update.email = input.email;
  if (input.role !== undefined) update.role = input.role;

  const { data, error } = await serviceClient()
    .from('members')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id, email, first_name, last_name, role')
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
  if (error || !data) {
    const err = new Error('Member not found for this tenant') as Error & { code: string };
    err.code = 'NOT_FOUND_IN_TENANT';
    throw err;
  }
}
