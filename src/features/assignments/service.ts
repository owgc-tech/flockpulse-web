import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface CreateGroupAssignmentInput {
  tenantId: string;
  memberId: string;
  groupId: string;
}

export interface CreateLeaderAssignmentInput {
  tenantId: string;
  memberId: string;
  leaderMemberId: string;
}

export async function listAssignments(tenantId: string) {
  const { data, error } = await serviceClient()
    .from('assignments')
    .select('id, member_id, assignment_type, group_id, leader_member_id, created_at')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

export async function createGroupAssignment(input: CreateGroupAssignmentInput) {
  const { data, error } = await serviceClient()
    .from('assignments')
    .insert({
      tenant_id: input.tenantId,
      member_id: input.memberId,
      assignment_type: 'GROUP',
      group_id: input.groupId,
    })
    .select('id, member_id, assignment_type, group_id, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      const err = new Error('Member already has an active assignment to this group') as Error & { code: string };
      err.code = 'DUPLICATE_ASSIGNMENT';
      throw err;
    }
    throw error;
  }
  return data;
}

export async function createLeaderAssignment(input: CreateLeaderAssignmentInput) {
  const { data, error } = await serviceClient()
    .from('assignments')
    .insert({
      tenant_id: input.tenantId,
      member_id: input.memberId,
      assignment_type: 'LEADER',
      leader_member_id: input.leaderMemberId,
    })
    .select('id, member_id, assignment_type, leader_member_id, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      const err = new Error('Member already has an active assignment to this leader') as Error & { code: string };
      err.code = 'DUPLICATE_ASSIGNMENT';
      throw err;
    }
    throw error;
  }
  return data;
}

// Soft-delete only — matches the no-DELETE-policy decision in the migration.
export async function softDeleteAssignment(id: string, tenantId: string) {
  const { error } = await serviceClient()
    .from('assignments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null);

  if (error) throw error;
}

// FP-7: Leader-scoped read — returns only members assigned to this leader.
export async function getMyAssignedMembers(tenantId: string, leaderMemberId: string) {
  const { data, error } = await serviceClient()
    .from('assignments')
    .select(`
      id,
      member_id,
      members!assignments_member_id_fkey (
        id, email, first_name, last_name, role
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('leader_member_id', leaderMemberId)
    .eq('assignment_type', 'LEADER')
    .is('deleted_at', null);

  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => row.members);
}
