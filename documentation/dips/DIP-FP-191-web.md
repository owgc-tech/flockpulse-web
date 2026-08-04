DIP-FP-191-web
Story Summary

Adds Announcements as a system-managed event type (mirroring FP-181's Everyone system group exactly): a fixed, non-editable event_types entry auto-provisioned per tenant, with a new announcement body field, automatic Everyone-group targeting, an auto-computed +1-day end date, and a genuinely separate acknowledgement mechanism that never touches the real attendance/formation pipeline.

Repo Target

Web (Next.js), owgc-tech/flockpulse-web.

Grounding Check
event_types confirmed live: id, tenant_id, name, code, deleted_at — no system_key yet. Adding one mirrors groups.system_key from FP-181 exactly: nullable, CHECK (system_key IS NULL OR system_key = 'ANNOUNCEMENT'), partial unique index for one-per-tenant.
events.end_datetime > events.start_datetime is a real, confirmed CHECK constraint — the RPC must compute end_datetime = start_datetime + interval '1 day' server-side for Announcement-type events, not trust whatever the client sends, so this can never be violated regardless of what the UI does.
insert_event_with_audit's current full signature confirmed live (17 params ending in p_rsvp_closure_days, p_actor_member_id) — extending it follows the exact same DROP FUNCTION + CREATE OR REPLACE pattern already used for every prior extension of this RPC (rsvp_closure_days, online meeting fields, etc.).
Target auto-defaulting to Everyone and the +1-day end date are both enforced inside the RPC itself, not left to the web form to get right — if p_event_type_id resolves to the tenant's Announcement system type, the RPC overrides whatever p_target/p_end_datetime were passed, rather than trusting the client. Matches the "server-side enforcement, not just UI" standard applied throughout every guard built this session.
Acknowledgement is deliberately a new, separate table (announcement_acknowledgements), never a write to member_attendance_reports/attendance — this is the one non-negotiable design constraint from the story itself, since Talk completion is keyed strictly off attendance_status = ATTENDED elsewhere in this codebase, and acknowledgement must structurally be unable to reach that.
GET /api/self-reports/pending (backing PendingSelfReportRow[]) confirmed live and is exactly what Joseph's "combine the badge with self-report" decision should extend, rather than a new parallel endpoint — mobile already polls this one endpoint for its Check-In badge count.
/api/events/mine's current MyEvent shape confirmed live — has event_type_id only, no type name/system_key. This must be extended so mobile can tell an Announcement apart from a real event without a second round-trip.
This DIP does not attempt to exclude the Announcement system type from FP-180's auto-assign or FP-182's Dashboard event-type dropdowns — that ripple-effect work is real but is being tracked and built as part of those features' own follow-up, not duplicated here.
Implementation Plan
Migration — schema: event_types.system_key (nullable, CHECK, partial unique index, mirrors groups exactly). events.announcement_body TEXT (nullable). New announcement_acknowledgements(id, tenant_id, event_id, member_id, acknowledged_at, created_at) with a unique index on (event_id, member_id).
Migration — backfill + auto-provisioning: insert one Announcement event_types row per existing tenant (idempotent, WHERE NOT EXISTS). New AFTER INSERT ON tenants trigger creating the Announcement type for any new tenant — same shape as FP-181's create_everyone_group_for_new_tenant().
Migration — guard trigger: BEFORE UPDATE ON event_types blocking any rename or soft-delete where OLD.system_key IS NOT NULL — same pattern and same SYSTEM_MANAGED_GROUP-style error-message convention as FP-181's group guard (reusing SYSTEM_MANAGED_GROUP as the error code here too, for consistency, even though it's technically event_types not groups — same protection class).
Migration — extend insert_event_with_audit/update_event_with_audit: DROP FUNCTION IF EXISTS with the exact current 17-arg signature, CREATE OR REPLACE with a new p_announcement_body TEXT parameter appended before p_actor_member_id. Inside the function body: if p_event_type_id matches the tenant's Announcement system type (looked up by system_key = 'ANNOUNCEMENT'), force p_end_datetime := p_start_datetime + interval '1 day' and p_target := jsonb_build_object('group_id', <tenant's Everyone group id>) regardless of what was passed in.
Repository/service: createAnnouncementAcknowledgement(tenantId, eventId, memberId) — INSERT ... ON CONFLICT (event_id, member_id) DO NOTHING, making repeated taps harmless. Extend getPendingSelfReports (backing /api/self-reports/pending) to also union in any Announcement-type events this member is expected at (event_attendees) whose effective status is COMPLETED/LOCKED and who haven't yet acknowledged — returned in the same array, each row tagged kind: 'self_report' | 'announcement'.
API routes: extend the existing event-creation route to accept announcement_body in its body. New POST /api/announcements/:eventId/acknowledge — withAuth, no role restriction (any member acknowledges for themselves, mirrors the existing self-report POST's own "not restricted above MEMBER" precedent). GET /api/self-reports/pending — no route change, just returns the extended repository result.
Extend /api/events/mine and /api/events/:id: each event row gains a nested event_type: { id: string; name: string; system_key: string | null }, so mobile can detect an Announcement without a second call.
Web admin UI: event creation form's type dropdown includes "Announcement" as an always-present, non-editable option (sourced from the live event_types list, same as any other type — no special-casing needed there since it's just a normal row with system_key set). Selecting it hides location/online-meeting/task-picker fields, shows the new Announcement body textarea, and shows the computed end date read-only (not a separate editable field).
Files to Create/Modify
supabase/migrations/[next]_announcement_system_type.sql (new)
src/features/events/event.repository.ts (modify — insert_event_with_audit/update_event_with_audit callers pass announcement_body; event_type nested object added to the mine/detail queries)
src/features/self-reports/self-report.repository.ts (modify — getPendingSelfReports extended)
src/features/announcements/announcement.repository.ts (new — createAnnouncementAcknowledgement)
app/api/announcements/[eventId]/acknowledge/route.ts (new)
app/admin/(shell)/events/EventForm.tsx (modify — Announcement type-conditional simplified fields)
Migration Files

Full SQL to be written at implementation time per the Implementation Plan above — schema, backfill, tenant-provisioning trigger, rename/delete guard, and the extended insert_event_with_audit/update_event_with_audit DROP+CREATE OR REPLACE.

Branch Name

feature/FP-191-web-announcements

Commit Message

FP-191-web: system-managed Announcement event type, acknowledgement mechanism separate from attendance

Pull Request Description
Confirm the Announcement system type is auto-provisioned and cannot be renamed/deleted by any role — same test shape as FP-181's Everyone group.
Confirm creating an Announcement always produces end_datetime = start_datetime + 1 day and target = the tenant's Everyone group, even if the client tried to send something else — test by attempting to override both from a raw API call.
Confirm announcement_acknowledgements has zero foreign-key or code path connecting it to member_attendance_reports/attendance.
Confirm /api/self-reports/pending now returns both kinds in one array, each tagged with kind.
Confirm /api/events/mine now includes event_type.system_key on every row.
Jira Linkage
PDEEpicID: FP-188
PDEStoryID: FP-191
Stop Point

Save this DIP verbatim to documentation/dips/DIP-FP-191-web.md. Branch off current dev. Open a PR against dev and stop. Do not merge.

Include full diffs for every file in the completion report, no elisions.

---

## Implementation Notes (added post-implementation, not part of the original DIP text above)

The Grounding Check above contains several claims that did not hold up against the live codebase/database and were corrected during implementation rather than followed literally:

- **FP-181 dependency**: at the time this DIP was received, FP-181 (Everyone system group) existed only as a complete, unmerged commit on `feature/FP-181-everyone-system-group` — not in `dev`, and not applied to the live `fpdb-dev` database. This was a hard blocker (the Announcement auto-target RPC needs a real Everyone group to look up) and was resolved before implementation began: PR #143 merged FP-181 into `dev`, and the migration was applied to `fpdb-dev` (verified live: `groups.system_key = 'EVERYONE'` rows exist for all 4 tenants) before this branch was cut.
- **insert_event_with_audit's signature**: the DIP claims 17 params. The live signature (confirmed by reading the current `CREATE OR REPLACE` directly) is 15 params. The migration uses the real 15-param signature in its `DROP FUNCTION`.
- **update_event_with_audit's shape**: the DIP implies it shares insert's positional-argument shape ("append p_announcement_body before p_actor_member_id"). It does not — it has been patch-based, `(UUID, UUID, JSONB, UUID)`, since introduction. `announcement_body` is instead handled as a `CASE WHEN p_patch ? 'announcement_body'` branch, matching every other nullable patchable column in that function.
- **Target shape**: the DIP's literal override, `jsonb_build_object('group_id', ...)` (singular), does not match the real `target` shape read by `handle_event_scheduling()` and the update RPC's own resync block — both read `target->'group_ids'` (plural, JSONB array). Using the DIP's literal key would have silently targeted nobody. Corrected to `jsonb_build_object('group_ids', jsonb_build_array(<id>), 'member_ids', '[]')`.
- **location_name/location_address NOT NULL**: not addressed anywhere in the DIP's Grounding Check. Both are `TEXT NOT NULL` on `events`. Both RPCs force fixed placeholder values (`'Announcement'` / `'N/A'`) for Announcement rows server-side, same override treatment as `end_datetime`/`target`.
- **File paths**: the DIP names `src/features/events/event.repository.ts`, which does not exist — the real file is `src/features/events/service.ts` (repository and service logic are combined there). Changes were made to the real file.
- Beyond the DIP's literal file list, `src/features/event-types/event-type.service.ts` and `app/api/event-types/[id]/route.ts` were also updated to map the new guard trigger's `P0001`/`SYSTEM_MANAGED_GROUP` error to a clean 409 (mirroring FP-181's own equivalent step for `groups.service.ts`) — otherwise the guard trigger would produce an unhandled 500 instead of the intended UX.
