DIP-FP-161-4-drop-old-columns.md
Story Summary
Phase 4 of 5 for FP-161 — the final cleanup step, deliberately done only now that Phase 3 has been live, tested, and corrected (FP-162, FP-163) for a real stretch. Drops events.prayer_leader_member_id and events.food_assignment, which the app has not written to since Phase 3 and has no remaining functional dependency on.
Repo Target
Web only — mobile never had its own database columns to drop; its type-level cleanup (removing the two fields from whatever type mirrors the raw detail response) is a small, low-risk follow-up in the same mobile PR, not a separate migration.
Grounding Check
Confirmed live against dev:

Both RPCs still reference these columns throughout, not just superficially: insert_event_with_audit has them in its parameter list, RETURNS TABLE, INSERT column list, and VALUES list. update_event_with_audit has them in RETURNS TABLE, two CASE WHEN p_patch ? clauses, and the final RETURN QUERY SELECT. Both functions' RETURNS TABLE shape changes, so both require DROP FUNCTION IF EXISTS before CREATE OR REPLACE, per house rule.
createEvent()'s RPC call (service.ts ~line 199-200) still passes p_prayer_leader_member_id: null, p_food_assignment: null — since this DIP removes the parameters from the RPC entirely (not just stops using them), this call must also stop passing them, not just pass null forever.
Four separate .select() column-list strings in service.ts (confirmed at lines ~234, ~532, ~562, ~608) explicitly name prayer_leader_member_id, food_assignment — all four need those two names removed, or every one of them will start erroring once the columns are dropped, not just the RPCs.
event.types.ts's raw row type still declares both fields — remove now that the columns genuinely no longer exist.
Mobile: no schema of its own to touch, but its own type mirroring the raw event-detail response (confirmed present in create.tsx/edit.tsx's scope area, exact type name to be reconfirmed live) needs the same two fields removed — implementer should do its own full sweep here rather than trust this list is complete, matching this session's repeated finding that these fields show up in more places than expected.
Domain rules: no conflict — pure cleanup, no data at stake (Phase 3 already established no backfill was wanted).

Implementation Plan

Migration: DROP FUNCTION IF EXISTS insert_event_with_audit(...) (full existing signature) then CREATE OR REPLACE FUNCTION with both parameters, the RETURNS TABLE columns, the INSERT column list, and VALUES list all stripped of prayer_leader_member_id/food_assignment — every other column/clause carried forward unchanged. Same treatment for update_event_with_audit. Then ALTER TABLE events DROP COLUMN IF EXISTS prayer_leader_member_id, DROP COLUMN IF EXISTS food_assignment; — the RPC updates must come first in the migration file, since they reference the columns being dropped.
service.ts: remove p_prayer_leader_member_id/p_food_assignment from the createEvent() RPC call entirely. Remove prayer_leader_member_id, food_assignment from all four .select() column-list strings.
event.types.ts: remove both fields from the raw row type.
Mobile: remove both fields from whatever type mirrors the raw detail response — implementer to confirm exact type name/location live, not assumed here.

Files to Create/Modify
Web: new migration; src/features/events/service.ts; src/features/events/event.types.ts
Mobile: whatever type file mirrors the raw event-detail response (confirm live)
Branch Name
feature/FP-161-4-drop-old-columns (web), feature/FP-161-4-drop-old-columns-mobile (mobile)
Commit Message
FP-161 (4/5): drop prayer_leader_member_id/food_assignment columns, remove all remaining references
Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-161

Stop Point
Save verbatim to documentation/dips/DIP-FP-161-4-drop-old-columns.md in both repos, frozen after save. Validate migration locally via supabase db reset. Open separate PRs against dev, do not merge. Flag the manual remote-migration-apply step clearly — this one is destructive (drops real columns) and touches two heavily-used RPCs; recommend applying only after confirming Phase 3 + corrections have been stable for a while, which they have.
Include full diffs in the completion report.
