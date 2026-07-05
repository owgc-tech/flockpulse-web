export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED';
export type MemberRole = 'ADMIN' | 'LEADER' | 'MEMBER';

export interface InvitationRow {
  id: string;
  tenant_id: string;
  email: string;
  role: MemberRole;
  group_id: string | null;
  invited_by: string;
  auth_user_id: string;
  status: InvitationStatus;
  invited_at: string;
  responded_at: string | null;
}
