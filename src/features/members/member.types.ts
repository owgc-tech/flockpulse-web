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
  deleted_at: string | null;
  created_at: string;
}
