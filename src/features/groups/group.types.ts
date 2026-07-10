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
  role: 'ADMIN' | 'LEADER' | 'MEMBER';
}
