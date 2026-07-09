export type MemberRole = 'ADMIN' | 'LEADER' | 'MEMBER';

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
