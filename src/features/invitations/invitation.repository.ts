import { createClient } from '@supabase/supabase-js';
import type { InvitationDisplayRow, InvitationRow, MemberRole } from './invitation.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function insertInvitation(params: {
  tenantId: string;
  email: string;
  role: MemberRole;
  groupId: string | null;
  invitedBy: string;
  authUserId: string;
}): Promise<InvitationRow> {
  const { data, error } = await serviceClient()
    .from('invitations')
    .insert({
      tenant_id: params.tenantId,
      email: params.email,
      role: params.role,
      group_id: params.groupId,
      invited_by: params.invitedBy,
      auth_user_id: params.authUserId,
      status: 'PENDING',
    })
    .select('id, tenant_id, email, role, group_id, invited_by, auth_user_id, status, invited_at, responded_at')
    .single();

  if (error) throw error;
  return data as InvitationRow;
}

export async function listInvitations(tenantId: string): Promise<InvitationRow[]> {
  const { data, error } = await serviceClient()
    .from('invitations')
    .select('id, tenant_id, email, role, group_id, invited_by, auth_user_id, status, invited_at, responded_at')
    .eq('tenant_id', tenantId)
    .order('invited_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as InvitationRow[];
}

// Returns invitations with group_id → group name and invited_by → inviter name resolved.
// Two-step lookup avoids PostgREST embed ambiguity (multiple FK paths to members/groups).
export async function listInvitationsWithNames(tenantId: string): Promise<InvitationDisplayRow[]> {
  const db = serviceClient();
  const rows = await listInvitations(tenantId);
  if (rows.length === 0) return [];

  const groupIds = [...new Set(rows.map(r => r.group_id).filter(Boolean))] as string[];
  const memberIds = [...new Set(rows.map(r => r.invited_by))];

  const [groupsResult, membersResult] = await Promise.all([
    groupIds.length > 0
      ? db.from('groups').select('id, name').in('id', groupIds)
      : Promise.resolve({ data: [], error: null }),
    db.from('members').select('id, first_name, last_name').in('id', memberIds),
  ]);

  if (groupsResult.error) throw groupsResult.error;
  if (membersResult.error) throw membersResult.error;

  const groupMap = new Map((groupsResult.data ?? []).map(g => [g.id, g.name as string]));
  const memberMap = new Map(
    (membersResult.data ?? []).map(m => [m.id, `${m.first_name} ${m.last_name}`])
  );

  return rows.map(r => ({
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status,
    group_name: r.group_id ? (groupMap.get(r.group_id) ?? null) : null,
    inviter_name: memberMap.get(r.invited_by) ?? r.invited_by,
    invited_at: r.invited_at,
    responded_at: r.responded_at,
  }));
}

export async function getInvitationById(
  tenantId: string,
  invitationId: string
): Promise<InvitationRow | null> {
  const { data, error } = await serviceClient()
    .from('invitations')
    .select('id, tenant_id, email, role, group_id, invited_by, auth_user_id, status, invited_at, responded_at')
    .eq('id', invitationId)
    .eq('tenant_id', tenantId)
    .single();

  if (error) return null;
  return data as InvitationRow;
}

export async function pendingInvitationExistsForEmail(
  tenantId: string,
  email: string
): Promise<boolean> {
  const { count } = await serviceClient()
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('email', email)
    .eq('status', 'PENDING');

  return (count ?? 0) > 0;
}
