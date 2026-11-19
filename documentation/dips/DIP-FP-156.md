DIP-FP-156.md
Story Summary
Editing an already-scheduled event's target updates events.target correctly but never re-syncs event_attendees (the actual RSVP roster), which is only ever materialized once, at the DRAFT → SCHEDULED transition. This DIP extends update_event_with_audit() — the same RPC already handling every other patchable field — to re-sync event_attendees atomically whenever target changes on an already-scheduled event: add rows for newly-included members, delete rows for removed members. rsvps, attendance, and self-report data are never touched, by design — they're historical fact, independent of the current invite list.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web. No mobile changes — this is a pure backend/data-integrity fix; both platforms' Edit Event flows already call the same web API/RPC.
Grounding Check
Confirmed live against dev:

update_event_with_audit()'s current definition (migration 20260718000048) has target = COALESCE(p_patch->'target', events.target) — updates the column, does nothing else with it.
handle_event_scheduling() (migration 20260708000028) is the exact roster-resolution logic to reuse: union of (a) every member belonging to any group in target->'group_ids' via assignments (assignment_type = 'GROUP', deleted_at IS NULL), tenant-scoped, and (b) every member explicitly listed in target->'member_ids', tenant-scoped, deleted_at IS NULL. This DIP reuses this exact logic for both the "add newly-included" and "remove no-longer-included" halves, not a reinvented version.
Critical guard, not in the original ticket, found during this DIP's grounding: the resync must be conditioned on the event's status being SCHEDULED at the time of the patch — confirmed via listEventsForMember's own comment that DRAFT events are guaranteed to have zero event_attendees rows by design (the materialization trigger only fires on the DRAFT→SCHEDULED transition). Running the resync unconditionally on every target patch would wrongly create event_attendees rows for a still-unpublished DRAFT event, breaking that invariant and causing an unpublished event to prematurely appear in members' My Events lists. The resync only runs when v_row.status = 'SCHEDULED' after the UPDATE.
Atomicity: implemented inside update_event_with_audit() itself, immediately after UPDATE events ... RETURNING * INTO v_row and before the audit-log call — same transaction as the target column write itself, no partial-failure window between "target updated" and "roster resynced."
RETURNS TABLE signature unchanged — no new output columns, so this is a plain CREATE OR REPLACE FUNCTION, no DROP FUNCTION IF EXISTS needed per the standing house rule (only required when the return shape changes).
rsvps/attendance/self-report tables are confirmed independently keyed on (event_id, member_id), not FK'd to event_attendees — deleting an event_attendees row has zero cascading effect on any of them, exactly matching Joseph's explicit design decision.
Both web (EventForm.tsx) and mobile (edit.tsx) Edit Event flows already send the complete target object (not a partial patch of just one sub-key) — confirmed for web during FP-131's grounding, and mobile's edit screen mirrors the same pattern. No app-layer changes needed on either platform; this is entirely a backend fix.
Domain rules: no conflict with Section 4's invariants — RSVP/self-report/attendance data is explicitly untouched, matching the "sole source of truth" separation already established.

Implementation Plan

Migration: CREATE OR REPLACE FUNCTION update_event_with_audit(...) — after the existing UPDATE events ... RETURNING * INTO v_row, add:

sql   IF p_patch ? 'target' AND v_row.status = 'SCHEDULED' THEN
     INSERT INTO event_attendees (tenant_id, event_id, member_id)
     SELECT v_row.tenant_id, v_row.id, a.member_id
     FROM assignments a
     WHERE a.group_id = ANY(ARRAY(SELECT jsonb_array_elements_text(v_row.target->'group_ids'))::UUID[])
       AND a.assignment_type = 'GROUP' AND a.deleted_at IS NULL AND a.tenant_id = v_row.tenant_id
     UNION
     SELECT v_row.tenant_id, v_row.id, m.id
     FROM members m
     WHERE m.id = ANY(ARRAY(SELECT jsonb_array_elements_text(v_row.target->'member_ids'))::UUID[])
       AND m.tenant_id = v_row.tenant_id AND m.deleted_at IS NULL
     ON CONFLICT DO NOTHING;

     DELETE FROM event_attendees ea
     WHERE ea.event_id = v_row.id AND ea.tenant_id = v_row.tenant_id
       AND ea.member_id NOT IN (
         SELECT a.member_id FROM assignments a
         WHERE a.group_id = ANY(ARRAY(SELECT jsonb_array_elements_text(v_row.target->'group_ids'))::UUID[])
           AND a.assignment_type = 'GROUP' AND a.deleted_at IS NULL AND a.tenant_id = v_row.tenant_id
         UNION
         SELECT m.id FROM members m
         WHERE m.id = ANY(ARRAY(SELECT jsonb_array_elements_text(v_row.target->'member_ids'))::UUID[])
           AND m.tenant_id = v_row.tenant_id AND m.deleted_at IS NULL
       );
   END IF;
placed before the PERFORM write_audit_log(...) call. Every other column's UPDATE clause and the function's RETURNS TABLE/RETURN QUERY shape stay exactly as they are today — this DIP only adds the block above.
Files to Create/Modify

supabase/migrations/20260719000050_resync_event_attendees_on_target_edit.sql (new)

Migration Files
See the exact SQL block in the Implementation Plan above — inserted into a full CREATE OR REPLACE FUNCTION update_event_with_audit(...) migration carrying forward every other line from the current live definition (migration 20260718000048) unchanged.
Branch Name
feature/FP-156-resync-attendees-on-target-edit
Commit Message
FP-156: re-sync event_attendees when an already-scheduled event's target is edited
Pull Request Description
Maps to acceptance criteria:

"Saving a target edit re-syncs event_attendees" → new block inside update_event_with_audit(), atomic with the target column write.
"rsvps/attendance/self-report untouched" → confirmed by design (no FK relationship, nothing in this DIP references those tables at all).
"SQL-side vs app-layer, verify at DIP time" → SQL-side, chosen for atomicity and consistency with handle_event_scheduling()'s existing pattern.
"Applies to both web and mobile edit flows" → confirmed both already funnel through this same RPC; no per-platform changes needed.
New finding beyond the original ticket: resync is guarded to SCHEDULED-status events only, preventing a DRAFT event from prematurely gaining event_attendees rows before it's actually published.

Jira Linkage

PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
PDEStoryID: FP-156

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-156.md, frozen after save. Validate the migration locally via supabase db reset before opening the PR. Open PR against dev, do not merge. Flag the manual remote-migration-apply step explicitly in the PR description, same as every prior migration DIP — this one touches a frequently-used RPC, worth testing thoroughly before applying remotely.
Include full diffs in the completion report.
