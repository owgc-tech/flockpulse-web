### Story Summary
Removes server-side notification scheduling entirely, now confirmed unnecessary — mobile's own local reminder reconciliation is the actual live mechanism (confirmed zero references to `event_notifications` anywhere in the mobile codebase), and no dispatch worker for this table was ever built (no edge functions exist in this repo, and FP-46 — a prior tech-debt ticket about this exact mechanism — documents that it's been producing dead data from day one). This removes creation, rescheduling, and the redundant `EVENT_UPDATE` insert, drops the now-fully-unused `event_notifications` table, and removes the one remaining dependent (`talk_id`'s immutability-after-dispatch check) rather than leave it to crash against a dropped table. Confirmed decision (2026-08-08): drop the table outright, and `talk_id` becomes freely editable going forward — the immutability rule was tied to the old dispatch lifecycle and isn't being preserved.

### Repo Target
Web (Next.js) — all four `event_notifications` references live in `src/features/events/service.ts`; the table itself is dropped via migration. No mobile changes — mobile never referenced this table.

### Grounding Check
Re-confirmed live against `owgc-tech/flockpulse-web` `dev`, this session — nothing drifted overnight:
- Only one file in the entire app/src tree references `event_notifications` at all: `src/features/events/service.ts`, at exactly four call sites.
- `handle_event_scheduling()`'s current live definition (most recent `CREATE OR REPLACE`, in `20260708000028_multi_target_event_scheduling.sql`) has two INSERT blocks in one `IF` branch: the `event_attendees` roster materialization (keep, unrelated, still needed) and the `event_notifications` triple-insert (`PRE_EVENT_REMINDER`/`POST_EVENT_SELF_REPORT`/`LEADER_CONFIRMATION` — remove).
- `updateEvent()` (`service.ts:338`) has three of the four references: the rescheduling block (recalculates `scheduled_for` on timing changes — remove), the `EVENT_UPDATE` row-insertion-per-attendee block (remove, redundant per Story 1 referenced in this ticket), and the `talk_id` immutability check (`count` of non-`PENDING` rows — remove entirely, per confirmed decision, not reworked into a different mechanism).
- FP-46 (status: Done, despite its actual fix never being implemented) documents that the `LEADER_CONFIRMATION` row this removes has been dead data since it was written — no dispatch worker was ever built to consume any `event_notifications` row, for any purpose. This corroborates the "safe to remove, not just theoretically safe" conclusion independently of this ticket's own reasoning.
- No RLS policy, other trigger function, or edge function references `event_notifications` — confirmed via full-migration grep and confirming no `supabase/functions` directory exists in this repo at all.

### Implementation Plan
1. **`handle_event_scheduling()`**: `CREATE OR REPLACE` removing only the `event_notifications` triple-insert block. The `event_attendees` INSERT and everything else in the function body stays untouched, unchanged, byte-for-byte.
2. **`updateEvent()`** (`src/features/events/service.ts`):
   - Remove the `talk_id` immutability check entirely (the `count`/`IMMUTABLE_FIELD` block) — not reworked, removed. `talk_id` becomes unconditionally editable via this function going forward.
   - Remove the timing-change rescheduling block (`rescheduleMap`/`unsent` query/update loop) entirely.
   - Remove the `EVENT_UPDATE` insert-per-attendee block entirely.
3. **New migration**: `DROP TABLE IF EXISTS event_notifications;` — after the three code changes above are in the same PR, so nothing in the app still queries a table that no longer exists at any point in this change.

### Files to Create/Modify
- `src/features/events/service.ts` (modify)
- New migration in `supabase/migrations/` (modify `handle_event_scheduling()`, drop `event_notifications`)

### Migration Files (if applicable)
`CREATE OR REPLACE FUNCTION handle_event_scheduling()` (same signature, `event_notifications` insert removed, `event_attendees` insert unchanged) and `DROP TABLE IF EXISTS event_notifications;` — written to disk, applied locally only, never against the remote database directly.

### Branch Name
feature/FP-100-web-remove-server-side-notification-scheduling

### Commit Message
FP-100-web: remove now-unnecessary server-side notification scheduling

### Pull Request Description
Maps to FP-100's acceptance criteria exactly: notification-row creation removed from `handle_event_scheduling()` (attendee-roster materialization untouched), the rescheduling block and `EVENT_UPDATE` insert both removed from `updateEvent()`, and — per the confirmed decision on the previously-flagged open question — `event_notifications` is dropped outright via migration, with its one remaining dependent (`talk_id`'s immutability check) removed rather than left to break. Confirm in the PR that `talk_id` is genuinely freely editable post-merge (no leftover check anywhere), and that a normal event update (timing change, attendee list) still succeeds cleanly with no error referencing the dropped table.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-100

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-100-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
