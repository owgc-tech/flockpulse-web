export interface GroupRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
}

export interface GroupMemberRow {
  assignment_id: string;
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  // DIP-FP-113-web: kept in sync with src/lib/auth/middleware.ts's Role type.
  role: 'ADMIN' | 'LEADER' | 'MEMBER' | 'SR_COORDINATOR' | 'COORDINATOR' | 'COMMUNITY_SERVANT' | 'PASTORAL_LEADER';
}
