export type RoleTier = 'ADMIN' | 'LEADER' | 'MEMBER';

export interface RoleCatalogEntryRow {
  id: string;
  tenant_id: string;
  name: string;
  tier: RoleTier;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateRoleCatalogEntryInput {
  name: string;
  tier: RoleTier;
}

// DIP-FP-192-web: tier is set once at creation and is never in this input —
// only name can be renamed. Letting tier change out from under members
// already assigned to an entry would be a silent RBAC change wearing a
// rename's clothing.
export interface UpdateRoleCatalogEntryInput {
  name?: string;
  deletedAt?: string | null;
}

export interface ReassignRoleCatalogEntryResult {
  members_reassigned: number;
  invitations_reassigned: number;
}
