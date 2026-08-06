### Story Summary
Renames the "Pastoral Leader" member-assignment relationship (who supervises this member — distinct from the role-title concept FP-192 already replaced) to "Assigned Leader" across all user-facing copy. UI-copy-only scope, confirmed: the `set_member_pastoral_leader()` RPC name and the `/api/members/[id]/pastoral-leader` route path are deliberately not renamed (internal identifiers, no user-facing text, unnecessary deploy risk). One pair of changes has to move together: the DB trigger's raised exception message and the exact substring match that catches it in `members/service.ts` — if these drift out of sync, the delete-block silently stops matching and the guard breaks without erroring.

### Repo Target
Web (Next.js) — this relationship field, its block/reassign flow, and all related copy exist only in the web admin UI.

### Grounding Check
Re-confirmed live against `owgc-tech/flockpulse-web` `dev`, post-FP-192 merge (that PR touched `MemberEditForm.tsx` too, for the unrelated role-dropdown change — re-verified this story's target lines weren't affected, only shifted slightly: the substring match in `members/service.ts` is now at line 331, not 267 as originally noted when this story was filed — same code, line drifted from FP-192's earlier additions to the same file):
- `MemberEditForm.tsx`: field label at line 186, block-banner message at line 198, and the two messages at lines 231/235 — all still present, unchanged by FP-192.
- `BulkReassignForm.tsx` line 68, and `/api/members/[id]/pastoral-leader/route.ts` line 17 — both still present, unchanged.
- Trigger function is `block_member_deactivation_if_assigned_leader()` (`20260714000037_bulk_reassign_leader_and_deactivation_guard.sql`), raising via `RAISE EXCEPTION 'Cannot deactivate member %: still assigned as Pastoral Leader to % member(s) — reassign them first', NEW.id, v_count;` — this exact string is what `members/service.ts`'s `.includes('still assigned as Pastoral Leader')` matches against.
- No RSVP/attendance/tenant-isolation invariant touched — pure copy change plus one trigger message string.

### Implementation Plan
1. **New migration**: `CREATE OR REPLACE FUNCTION public.block_member_deactivation_if_assigned_leader()` — identical body, only the `RAISE EXCEPTION` message text changes from `'...still assigned as Pastoral Leader to % member(s)...'` to `'...still assigned as Assigned Leader to % member(s)...'`. No `DROP FUNCTION` needed (signature unchanged, `CREATE OR REPLACE` is sufficient).
2. **`src/features/members/service.ts`**: update the substring match from `.includes('still assigned as Pastoral Leader')` to `.includes('still assigned as Assigned Leader')`, in the same commit as step 1 — these two must ship together.
3. **`MemberEditForm.tsx`**: field label "Pastoral Leader (optional)" → "Assigned Leader (optional)"; the three user-visible messages (block-banner "currently assigned to X as...", "...still someone's assigned...", "...is still assigned as... to N members") all updated to say "Assigned Leader."
4. **`BulkReassignForm.tsx`**: "...to a new Pastoral Leader." → "...to a new Assigned Leader."
5. **`/api/members/[id]/pastoral-leader/route.ts`**: validation message "...null clears the Pastoral Leader)" → "...null clears the Assigned Leader)". Route path itself stays `pastoral-leader` (out of scope, per Jira).

### Files to Create/Modify
- New migration in `supabase/migrations/`
- `src/features/members/service.ts` (modify)
- `app/admin/(shell)/members/[id]/edit/MemberEditForm.tsx` (modify)
- `app/admin/(shell)/members/[id]/reassign/BulkReassignForm.tsx` (modify)
- `app/api/members/[id]/pastoral-leader/route.ts` (modify)

### Migration Files (if applicable)
`CREATE OR REPLACE FUNCTION public.block_member_deactivation_if_assigned_leader()` — same trigger, same logic, only the exception message string changes (see Implementation Plan step 1). Written to disk, applied locally only, never against the remote database directly.

### Branch Name
feature/FP-193-web-assigned-leader-rename

### Commit Message
FP-193-web: rename "Pastoral Leader" relationship field to "Assigned Leader"

### Pull Request Description
Maps to FP-193's acceptance criteria: every user-facing "Pastoral Leader" reference for the member-assignment relationship (field label, block/error messages, the DB trigger's raised message, and its matching substring check in `members/service.ts`) renamed to "Assigned Leader." Explicitly out of scope, confirmed unchanged: the `PASTORAL_LEADER` role-catalog entry (FP-192's concern, not this story's), the `set_member_pastoral_leader()` RPC name, and the `/api/members/[id]/pastoral-leader` route path.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-193

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-193-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
