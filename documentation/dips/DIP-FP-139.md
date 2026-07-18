DIP-FP-139.md
Story Summary
InvitationsTable.tsx still has its own local ROLE_LABELS map covering only ADMIN/LEADER/MEMBER, left over from before FP-113 expanded the role model to seven roles. The shared, complete map already exists at src/lib/auth/roleLabels.ts (extracted during FP-135/FP-137-adj-1) and is already consumed by MembersTable.tsx and UserAvatarMenu.tsx. This DIP just points InvitationsTable.tsx at the shared map and deletes its stale local copy — no new logic, no schema, no API change.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check
Confirmed live against dev:

src/lib/auth/roleLabels.ts exports ROLE_LABELS: Record<Role, string> with all seven current roles, Role imported from ./middleware.
InvitationsTable.tsx (line 26) has its own stale const ROLE_LABELS: Record<string, string> = { ADMIN: 'Admin', LEADER: 'Leader', MEMBER: 'Member' }, used at line 123 as ROLE_LABELS[inv.role] ?? inv.role.
InvitationDisplayRow.role is typed MemberRole (from invitation.types.ts), not Role (from middleware.ts) — these are two independently-declared, structurally-identical 7-value literal unions (a pre-existing, deliberate duplication documented inline as of FP-113, explicitly not something this DIP touches). Since TypeScript typing is structural, ROLE_LABELS[inv.role] type-checks correctly against the imported Record<Role, string> with no cast or type-layer change needed — confirmed by comparing all three declarations (Role, and the two separate MemberRoles in member.types.ts and invitation.types.ts) line-for-line.
No other file in this table references the local ROLE_LABELS — safe to delete outright, not just leave unused.
Domain rules: no conflict — display-only change, no access-control or data implications.

Implementation Plan

Add import { ROLE_LABELS } from '@/src/lib/auth/roleLabels'; to InvitationsTable.tsx's import block.
Delete the local const ROLE_LABELS: Record<string, string> = { ... } (line 26).
No other line changes — the existing usage (ROLE_LABELS[inv.role] ?? inv.role) is already correct and needs no rewrite; it'll just resolve against the shared, complete map now.

Files to Create/Modify

app/admin/(shell)/invitations/InvitationsTable.tsx

Migration Files
Not applicable.
Branch Name
feature/FP-139-invitations-role-labels
Commit Message
FP-139: use shared ROLE_LABELS in InvitationsTable
Pull Request Description
Maps to acceptance criteria:

"Imports and uses the shared ROLE_LABELS map" → done via import swap.
"Local ROLE_LABELS definition removed" → deleted, not just superseded.
"All seven roles render a correct label" → shared map already covers all seven; no per-role logic needed since the lookup itself was already correct, only its data source was stale.
"Existing ADMIN/LEADER/MEMBER behavior unchanged" → those three labels are identical strings in both the old local map and the shared one ('Admin', 'Leader', 'Member') — confirmed by direct comparison, not assumed.

Jira Linkage

PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control)
PDEStoryID: FP-139

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-139.md, frozen after save. npm run build must pass cleanly before pushing (standing rule for any DIP touching .ts/.tsx). Open PR against dev, do not merge. No migration, no remote step.
Include full diffs in the completion report — for a change this size, that's the whole file plus a two-line diff, not a burden.
