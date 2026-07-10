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

// FP-72: Edit-screen prefill — the member's current active LEADER assignment, if any.
export async function getActiveLeaderAssignment(memberId: string, tenantId: string) {
  const { data, error } = await serviceClient()
    .from('assignments')
    .select('id, member_id, leader_member_id, created_at')
    .eq('member_id', memberId)
    .eq('tenant_id', tenantId)
    .eq('assignment_type', 'LEADER')
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// FP-72: atomic Pastoral Leader replace — thin wrapper over set_member_pastoral_leader(),
// which retires any existing active LEADER assignment(s) and inserts the new one (or just
// retires, if leaderMemberId is null) in a single transaction. Not two sequential
// .from('assignments') calls — see DIP-FP-69-FP-72's atomicity rule.
export async function setPastoralLeader(
  memberId: string, leaderMemberId: string | null, tenantId: string, actorMemberId: string
) {
  const { data, error } = await serviceClient().rpc('set_member_pastoral_leader', {
    p_member_id: memberId,
    p_leader_member_id: leaderMemberId,
    p_tenant_id: tenantId,
    p_actor_member_id: actorMemberId,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('CROSS_TENANT_ACCESS')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'CROSS_TENANT_ACCESS';
      throw err;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row ?? null; // null when leaderMemberId was null (cleared, nothing to return)
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

// FP-71: Group Edit's Membership section — the group's current active membership.
// Returns the assignment id alongside member info so the frontend's Remove action can call
// the existing DELETE /api/assignments?id=<assignmentId> directly — no new write path.
export async function getGroupMembers(groupId: string, tenantId: string) {
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
    .eq('group_id', groupId)
    .eq('assignment_type', 'GROUP')
    .is('deleted_at', null);

  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    assignment_id: row.id,
    ...(row.members as Record<string, unknown>),
  }));
}

// FP-73/FP-74: admin-facing lookup — same query as getMyAssignedMembers() (which already
// accepts an arbitrary leaderMemberId, not only the caller's own), aliased with a name that
// reads correctly for an Admin looking up ANY leader's assignees, not just their own. Backs
// both the Bulk Reassign screen ("N members currently assigned") and the blocked-deactivation
// UI (who's affected).
export async function getMembersAssignedToLeader(leaderMemberId: string, tenantId: string) {
  return getMyAssignedMembers(tenantId, leaderMemberId);
}

// FP-73: atomic bulk reassignment — thin wrapper over bulk_reassign_leader_members_with_audit(),
// which loops set_member_pastoral_leader() per affected member inside one transaction (no new
// assignment mechanism, per FP-73's own AC).
export async function bulkReassignLeaderMembers(
  outgoingLeaderId: string, incomingLeaderId: string, tenantId: string, actorMemberId: string
) {
  const { data, error } = await serviceClient().rpc('bulk_reassign_leader_members_with_audit', {
    p_outgoing_leader_id: outgoingLeaderId,
    p_incoming_leader_id: incomingLeaderId,
    p_tenant_id: tenantId,
    p_actor_member_id: actorMemberId,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('VALIDATION_ERROR')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    if (msg.includes('CROSS_TENANT_ACCESS')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'CROSS_TENANT_ACCESS';
      throw err;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row as { reassigned_count: number };
}
