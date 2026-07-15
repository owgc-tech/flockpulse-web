DIP-FP-120-web
Story Summary
Adds online-meeting support to events: a tenant-scoped pool of fixed Zoom accounts (`meeting_resources`), database-enforced conflict detection so two events can never double-book the same account for overlapping times, and a freeform "other platform" option with no conflict tracking. Purely additive — physical location stays required exactly as today; this gives events an optional additional online-join option (hybrid, not a replacement). No Zoom API integration; join links are fixed, not created per-event. Attendance mode (in-person vs. remote) is explicitly not tracked — considered and deliberately dropped. When a user attempts to book an already-reserved Zoom account, the resulting error must show the conflicting event's name, date/time, and who booked it.
Repo Target
Web (Next.js) — `owgc-tech/flockpulse-web`.
Grounding Check

* Confirmed live: `createEvent()` writes via `serviceClient().rpc('insert_event_with_audit', {...})` with individual named params (`p_location_url`, etc.) — a `SECURITY DEFINER` RPC, not a direct table insert. Adding new event fields requires updating this RPC's params and `RETURNS TABLE` shape: `DROP FUNCTION IF EXISTS insert_event_with_audit` before `CREATE OR REPLACE`.
* Confirmed live: `updateEvent()` builds a generic `patch: Record<string, unknown>` object in TypeScript (only including keys that were actually provided) and RPCs the whole thing to `update_event_with_audit(p_event_id, p_tenant_id, p_patch, p_actor_member_id)`. Not yet verified — check the SQL body of `update_event_with_audit()` before writing any migration code for this: if it applies `p_patch` generically (e.g. a dynamic per-key `UPDATE`), the update path needs zero SQL changes — just add the three new keys to the TS-side `patch` object. If it instead names each column explicitly inside the function body, that function needs the same `DROP FUNCTION IF EXISTS` treatment as the insert path. Don't assume either way.
* Confirmed `attachEffectiveStatus` is already exported (done as part of FP-119) — available if needed anywhere in this story, no action required for it specifically.
* Confirmed `POST /api/events` and `PATCH /api/events/[id]` both destructure fields explicitly from the request body — both route files must be manually updated to destructure and pass through the three new fields, or they'll silently be dropped even if the service layer accepts them.
* Confirmed existing pattern for "optional URL-ish event field" is `locationUrl` (nullable, `?? null` when absent) — mirror this exactly for the new fields.
* Confirmed the RLS pattern to mirror for `meeting_resources` — `event_types`' three policies (`supabase/migrations/20260629000016_event_types_and_fk.sql`): `SELECT` open to any tenant member (`tenant_id = get_tenant_id()`), `INSERT`/`UPDATE` restricted to `caller_is_admin()`. Use this exact shape rather than inventing a new one — even though this story seeds `meeting_resources` directly via migration rather than through the app, the RLS should still exist for consistency and future-proofing (e.g. if a management UI gets added later).
* A Postgres `EXCLUDE` constraint (via `btree_gist`) is the correct, race-condition-free way to enforce "no two events reserve the same resource for overlapping time" — this must be a genuine DB constraint, not an app-layer "check then insert" race.
* The exclusion constraint should be a partial constraint (`WHERE online_meeting_resource_id IS NOT NULL AND status != 'CANCELLED'`) so events without an online-meeting reservation, and cancelled events, never participate in the check.
* Conflict error must show the conflicting event's details, confirmed with the user: name, date/time, and who booked it (`created_by_member_id`, an existing column on `events` per FP-114 — resolve to a member name via a join). Postgres's `EXCLUDE` constraint violation (SQLSTATE `23P01`) doesn't identify which row it conflicted with — the constraint alone can't produce a detailed message. The detailed error has to come from a proactive pre-check query, run before attempting the write, not parsed out of the constraint failure. The DB constraint remains the real enforcement (protects against a race between two simultaneous submissions); the pre-check is what makes the normal case give a genuinely useful message rather than a generic rejection.
* No Section 4 invariant rules touched; no changes to RSVP/self-report/attendance — explicitly confirmed out of scope per the user's own reversal on attendance-mode tracking.
Implementation Plan

1. Migration: enable `btree_gist` (`CREATE EXTENSION IF NOT EXISTS btree_gist;`).
2. Migration: `meeting_resources` table — `id uuid pk default gen_random_uuid()`, `tenant_id uuid not null references tenants(id)`, `name text not null`, `join_url text not null`, `created_at timestamptz not null default now()`. RLS: three policies mirroring `event_types` exactly (see Grounding Check).
3. Migration: seed two rows for the OWGC tenant (`ccdd0d62-ba0c-40fe-9ff6-b65eaa282a42`) — Joseph needs to supply the two real Zoom join URLs; use clearly-marked placeholders if not provided (`'REPLACE_ME_ZOOM_ACCOUNT_A'`) and flag this explicitly in your completion report.
4. Migration: `ALTER TABLE events ADD COLUMN online_meeting_resource_id uuid REFERENCES meeting_resources(id), ADD COLUMN online_meeting_url text, ADD COLUMN online_meeting_platform_label text;` — `online_meeting_resource_id` is the tracked-Zoom path; the other two together are the freeform "other platform" path. Treat as mutually exclusive at the app layer only — not worth a DB-level XOR constraint, this isn't a scarce-resource conflict the way Zoom accounts are.
5. Migration: `BEFORE INSERT OR UPDATE` trigger on `events` validating `online_meeting_resource_id` (when set) belongs to the same `tenant_id` as the event.
6. Migration: the `EXCLUDE` constraint from Grounding Check, wrapped in the standing `DO $$ ... pg_constraint ... $$` idempotency guard.
7. Update `insert_event_with_audit()` — `DROP FUNCTION IF EXISTS` then `CREATE OR REPLACE` with the three new params.
8. `updateEvent()`'s write path — resolve per the Grounding Check's live-verify item above; either just add the three keys to the TS `patch` object, or also update `update_event_with_audit()`'s SQL body with the same idempotent-function-replace treatment.
9. `POST /api/events` and `PATCH /api/events/[id]` — destructure and pass through `onlineMeetingResourceId`, `onlineMeetingUrl`, `onlineMeetingPlatformLabel`.
10. New repository function `findMeetingResourceConflict(tenantId, resourceId, startDatetime, endDatetime, excludeEventId?)` — queries `events` for the same tenant, same `online_meeting_resource_id`, `status != 'CANCELLED'`, overlapping time range (`start_datetime < newEnd AND end_datetime > newStart`), excluding `excludeEventId` (so an event being edited never conflicts with its own prior reservation). Joins to `members` via `created_by_member_id` to resolve the booker's name.
   * Called from both `createEvent()` and `updateEvent()`, whenever `onlineMeetingResourceId` is set, before the actual insert/update RPC call.
   * If a conflict is found, throw a structured error (new code `MEETING_RESOURCE_CONFLICT` — verify Engineering Spec §6 first per the canonical-code rule) carrying the conflicting event's `id`, `name`, `start_datetime`, `end_datetime`, and the booker's name (or `"Unknown"` if `created_by_member_id` is unset).
   * Route handlers (`POST /api/events`, `PATCH /api/events/[id]`) map this to a 409 response including that structured detail, not just a bare message string — the client needs the actual fields to render "This account is already booked for [Event Name] on [date/time] by [Name]."
   * Separately, still handle a raw `23P01` from the DB constraint itself (the rare race-condition path) with a generic fallback message ("This account was just booked by someone else — please try again") — there's no conflicting-event detail available at that point, and that's expected, not a bug to chase.
11. `EventForm.tsx` — add an "Online Meeting" section: dropdown of `meeting_resources` (fetch via new `GET /api/meeting-resources`), or a freeform "Other platform" name + link toggle. Existing location fields untouched, still required. On a `MEETING_RESOURCE_CONFLICT` response, show the structured conflict detail inline.
12. `EventDetail.tsx` — show the resolved online-meeting link as a tappable link, labeled with the resource name or the freeform platform label.
13. New `GET /api/meeting-resources` route — tenant-scoped list, any authenticated member can read it, no role restriction (needed for the dropdown).
Files to Create/Modify

```
supabase/migrations/[timestamp]_online_meeting_support.sql   (new)
src/features/events/service.ts                                (modified)
app/api/events/route.ts                                       (modified)
app/api/events/[id]/route.ts                                  (modified)
app/api/meeting-resources/route.ts                             (new)
app/admin/(shell)/events/EventForm.tsx                         (modified)
app/admin/(shell)/events/[id]/EventDetail.tsx                  (modified)
```

Migration Files
As detailed in Implementation Plan steps 1–6 — full SQL to be written by you, verified against the actual current schema and the `update_event_with_audit()` live-verify item before finalizing.
Branch Name
`feature/FP-120-web-online-meeting-support`
Commit Message
`FP-120-web: add meeting_resources table, DB-level Zoom conflict detection with detailed conflict info, online meeting fields on events`
Pull Request Description
Maps to FP-120's web-side ACs: `meeting_resources` table seeded with the two Zoom accounts; events optionally carry a tracked Zoom reservation or a freeform other-platform link, additive to the still-required physical location; double-booking a Zoom account for overlapping times is rejected with a detailed error (conflicting event name, time, and booker) via a pre-check, backed by a database-level `EXCLUDE` constraint as the real enforcement against race conditions.
Jira Linkage

* PDEEpicID: FP-11
* PDEStoryID: FP-120
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-120-web.md`. Open the PR against `dev` and stop — do not merge. Full diffs required in your completion report.
