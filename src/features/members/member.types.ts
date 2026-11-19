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

export interface MemberRow {
  id: string;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: MemberRole;
  // DIP-FP-192-web: null for members that predate the role catalog and
  // haven't been re-saved since — the tenant-configurable catalog entry this
  // member's role is actually drawn from.
  role_catalog_entry_id: string | null;
  // DIP-FP-192-web: resolved server-side — the catalog entry's name, or
  // ROLE_LABELS[role] as a fallback when role_catalog_entry_id is null.
  // Always populated; callers should never need to derive this themselves.
  role_display_name: string;
  deleted_at: string | null;
  created_at: string;
}
