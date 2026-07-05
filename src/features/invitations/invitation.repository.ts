import { createClient } from '@supabase/supabase-js';
import type { InvitationRow, MemberRole } from './invitation.types';

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
