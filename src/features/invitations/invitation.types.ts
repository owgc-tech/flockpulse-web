export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED';
// DIP-FP-113-web: kept in sync with src/lib/auth/middleware.ts's Role type
// (a pre-existing duplication across this codebase, not introduced here —
// see PR description).
export type MemberRole =
  | 'ADMIN'
  | 'LEADER'
  | 'MEMBER'
  | 'SR_COORDINATOR'
  | 'COORDINATOR'
  | 'COMMUNITY_SERVANT'
  | 'PASTORAL_LEADER';

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

// Resolved shape for display — group_id/invited_by foreign keys expanded to names.
export interface InvitationDisplayRow {
  id: string;
  email: string;
  role: MemberRole;
  status: InvitationStatus;
  group_name: string | null;
  inviter_name: string;
  invited_at: string;
  responded_at: string | null;
}
