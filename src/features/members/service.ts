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

export async function listMembers(tenantId: string) {
  const { data, error } = await serviceClient()
    .from('members')
    .select('id, user_id, email, first_name, last_name, role, created_at')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw error;
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

  if (error) throw error;
  return data;
}

// Soft-delete only — no hard-delete path exists by design.
export async function softDeleteMember(id: string, tenantId: string) {
  const { error } = await serviceClient()
    .from('members')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null);

  if (error) throw error;
}
