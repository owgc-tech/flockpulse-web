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
  // DIP-FP-192-web: the tenant-configurable catalog entry this invite's role
  // is actually drawn from. Null only for invitations that predate the
  // catalog and were never backfilled-matchable (shouldn't happen in
  // practice — the migration backfills every PENDING row).
  role_catalog_entry_id: string | null;
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
  // DIP-FP-192-web: resolved server-side, same contract as MemberRow's
  // role_display_name — always populated, falls back to ROLE_LABELS[role]
  // only when role_catalog_entry_id is null.
  role_display_name: string;
  status: InvitationStatus;
  group_name: string | null;
  inviter_name: string;
  invited_at: string;
  responded_at: string | null;
}
