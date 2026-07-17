import type { Role } from './middleware';

// Moved verbatim from app/admin/(shell)/members/MembersTable.tsx's local
// const — DIP-FP-135-FP-137-adj-1: extracted so UserAvatarMenu.tsx can share
// it rather than adding a third divergent copy alongside InvitationsTable.tsx's
// stale one (not touched here, out of scope).
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  LEADER: 'Leader',
  MEMBER: 'Member',
  SR_COORDINATOR: 'Sr. Coordinator',
  COORDINATOR: 'Coordinator',
  COMMUNITY_SERVANT: 'Community Servant',
  PASTORAL_LEADER: 'Pastoral Leader',
};
