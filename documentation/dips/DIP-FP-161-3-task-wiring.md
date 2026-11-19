DIP-FP-161-3-task-wiring.md
Story Summary
Phase 3 of 5 for FP-161. Wires the Task system (built in Phase 1) into the actual Event Form/Detail on both platforms, replacing the old hardcoded Prayer Leader (prayer_leader_member_id) and Food Assignment (food_assignment) fields with the new, uniform event_tasks_assignments system. Per Joseph's explicit direction: no backfill — existing events simply start with no task assignments under the new system; re-entering Prayer Leader/Food Assignment through the new UI is itself the test. The old columns are not dropped in this phase (that's Phase 4) — the app just stops reading and writing them entirely, going forward.
Repo Target
Both flockpulse-web and flockpulse-mobile — confirmed via a full sweep that both platforms have real, editable UI for these two fields, not just display.
Grounding Check
Confirmed live against dev (both repos):

Full reference sweep, web: EventForm.tsx (single-select dropdown for Prayer Leader, GroupMemberMultiSelect for Food Assignment — the exact component the new uniform task-assignee picker should reuse), EventDetail.tsx (read display), app/api/events/route.ts + [id]/route.ts (POST/PATCH body destructuring), event.types.ts, service.ts (createEvent/updateEvent's patch-building). No reports or other surfaces reference either field — contained scope.
Full reference sweep, mobile: create.tsx, edit.tsx (both full editing UI, not just display), [id].tsx (display), types.ts. The Self-Report tab's toRouteEvent() stub sets both fields to null as a placeholder — not a real usage, no change needed there.
Existing "always optional, no event-type gating" precedent (comment in EventForm.tsx, FP-107): Prayer Leader and Food Assignment already behave exactly like the new system's three core tasks are meant to — this DIP generalizes an already-proven pattern, not inventing new behavior.
Design decision, per Joseph's confirmed answer to open question #2 (all tasks — including Prayer Leader — can be assigned to an individual, group, or a mix): Prayer Leader's UI changes from a single-select dropdown to the same GroupMemberMultiSelect pattern Food Assignment already uses. All tasks, including the three core ones, get visually identical assignee pickers — uniform experience, no special-casing.
Domain rules: no conflict — event configuration only, no RSVP/attendance/formation invariant touched.

Implementation Plan
Web:

EventForm.tsx: remove the standalone Prayer Leader dropdown and Food Assignment GroupMemberMultiSelect block entirely. Add a new "Tasks" section: fetch the tasks catalog (via Phase 1's listTasks), always render the three core tasks (matched by name: "Prayer Leader," "Food Assignment," "Music") as GroupMemberMultiSelect pickers, pre-filled from any existing event_tasks_assignments row for that task+event when editing. Below that, an "Add Task" control listing remaining catalog tasks not yet added to this event; adding one reveals its own picker, identical in shape to the core three. On save, the form must produce an accurate end-state in event_tasks_assignments — created for newly-assigned tasks, updated for changed assignees, deleted for cleared/removed ones. Exact diffing mechanics (incremental vs. full replace-and-recreate) are implementation's call, not dictated here — the required outcome is what matters, not the method.
EventDetail.tsx: replace the "Prayer Leader"/"Food Assignment" display rows with a single "Tasks" section listing every event_tasks_assignments row for the event (task name + resolved assignee names/groups).
service.ts: createEvent()/updateEvent() stop reading/writing prayerLeaderMemberId/foodAssignment from their input entirely — remove those fields from CreateEventInput/UpdateEventInput. The underlying prayer_leader_member_id/food_assignment columns stay in the database, untouched, just never written to going forward (Phase 4 drops them). Task assignment reads/writes go through Phase 1's eventTaskAssignment.service.ts functions instead.
app/api/events/route.ts + [id]/route.ts: remove prayerLeaderMemberId/foodAssignment from POST/PATCH body destructuring.
event.types.ts: remove both fields from CreateEventInput/UpdateEventInput (leave them on any type still representing the raw DB row shape, e.g. EventDetailRow, since the columns themselves still exist).

Mobile:
6. create.tsx: same UI treatment as web's EventForm.tsx — remove the old Prayer Leader/Food Assignment fields, add the Tasks section with the three core tasks always shown plus an add-task mechanism, using whatever this app's existing multi-select/target-picker component is (mirroring create.tsx's own existing Food Assignment picker pattern for the other tasks, not inventing a new UI pattern).
7. edit.tsx: same treatment, pre-filled from existing assignments.
8. [id].tsx: replace the Prayer Leader/Food Assignment display with the same unified Tasks list web now shows.
9. types.ts: remove prayerLeaderMemberId/foodAssignment from whatever input type mirrors web's CreateEventInput/UpdateEventInput; leave them on any type mirroring the raw detail-endpoint response shape.
Files to Create/Modify
Web: app/admin/(shell)/events/EventForm.tsx, app/admin/(shell)/events/[id]/EventDetail.tsx, app/api/events/route.ts, app/api/events/[id]/route.ts, src/features/events/event.types.ts, src/features/events/service.ts
Mobile: app/(app)/events/create.tsx, app/(app)/events/[id]/edit.tsx, app/(app)/events/[id].tsx, src/features/events/types.ts
Migration Files
Not applicable — no schema change in this phase; old columns stay in place, unused, until Phase 4.
Branch Name
feature/FP-161-3-task-wiring (web), feature/FP-161-3-task-wiring-mobile (mobile)
Commit Message
FP-161 (3/5): wire Task system into Event Form/Detail, retire Prayer Leader/Food Assignment as dedicated fields (no backfill)
Pull Request Description
Maps to acceptance criteria: three core tasks always shown as optional, uniform assignee picker (individual/group/mix) for every task including the former Prayer Leader/Food Assignment, additional catalog tasks addable per-event, old fields no longer read or written anywhere in the app (columns retained for Phase 4 to drop). Explicitly note: existing events' Prayer Leader/Food Assignment data is now inaccessible through the app (not backfilled, per Joseph's explicit direction) — re-entering it via the new Tasks section is expected, not a bug.
Jira Linkage

PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
PDEStoryID: FP-161

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-161-3-task-wiring.md in both repos, frozen after save in each. npm run build/tsc --noEmit must pass cleanly in both. Open separate PRs against dev in each repo, do not merge. No migration, no remote step.
Include full diffs for every file in both repos in the completion report.
