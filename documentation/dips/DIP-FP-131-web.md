DIP-FP-131-web.md
Story Summary
FP-131 was filed assuming Admin CRUD for event types didn't exist at all. Live grounding found otherwise: the full backend (schema, RLS, service, repository, and both GET/POST /api/event-types + PATCH /api/event-types/:id routes, including soft-delete via deleted_at) already exists, and both the web and mobile Create Event forms already have working type pickers. What's actually missing — and what this DIP covers — is narrower but includes one real, previously-undiagnosed bug: (1) no admin-facing screen to manage event types (list/create/rename/archive), and (2) the web Edit Event form's type picker is a silent no-op — it renders, the value is sent in the PATCH payload, but the API route never reads that field and the underlying update_event_with_audit() RPC has no column mapping for it at all. Confirmed end-to-end by tracing the request from EventForm.tsx through the API route into the RPC's actual SQL. This directly matches the story's own AC ("verify... whether event_type_id has any immutability constraints; none are known") — there's no deliberate constraint, just an accidental gap.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web. Owns the only backend change (migration) and the new admin screen; the mobile Edit form fix is a companion DIP (DIP-FP-131-mobile.md) that depends on this one shipping first.
Grounding Check
Confirmed live against dev:

Schema/RLS/service/repository/API routes for event_types already fully exist (migration 20260629000016, src/features/event-types/{types,service,repository}.ts, app/api/event-types/route.ts + [id]/route.ts). PATCH /api/event-types/:id already supports soft-delete via deleted_at in its body — no new endpoint needed for archive/restore.
Both web and mobile Create Event forms already have working type pickers consuming GET /api/event-types — EventForm.tsx and mobile's create.tsx both fetch and render a full picker today. AC #3 is already satisfied for create; this DIP does not touch either create picker.
The web Edit form's type change is a confirmed silent no-op, traced end-to-end: EventForm.tsx includes eventTypeId in its PATCH payload on edit (line ~192) → app/api/events/[id]/route.ts's PATCH handler destructures the request body but never extracts eventTypeId → UpdateEventInput (in service.ts) has no eventTypeId field at all → updateEvent()'s patch-building block never sets patch.event_type_id → the underlying update_event_with_audit() RPC (latest definition, migration 20260717000044) has an explicit, hardcoded, non-dynamic column mapping (CASE WHEN p_patch ? 'x' THEN ... ELSE events.x END per column) with no clause for event_type_id at all. This is a real migration-level gap, not just an app-code oversight — the RPC itself has no path to ever write this column via patch, regardless of what the app layer sends.
A prior mobile session already independently discovered this exact gap and left a comment in edit.tsx stating the field is "immutable once the event is created" — this is a reasonable-looking but incorrect conclusion; there's no actual DB constraint or business rule preventing the change, just this RPC's incomplete column mapping. This DIP corrects the underlying gap; the mobile companion DIP removes the now-inaccurate comment and adds the picker.
Standing rule applies: update_event_with_audit()'s RETURNS TABLE column set changes (adding event_type_id), so per Section 5 rule 3, the migration must DROP FUNCTION IF EXISTS (exact signature) before CREATE OR REPLACE.
No admin UI page for event types exists anywhere — confirmed via directory scan. Groups' admin page (app/admin/(shell)/groups/) is the closest UI precedent: Admin-tier-only page, list table, status badge for soft-deleted rows.
Destructive-action confirmation convention: this codebase uses plain window.confirm() for destructive actions (InvitationsTable.tsx's Revoke, EventDetail.tsx's Cancel) — followed here for archiving an in-use type, rather than introducing a new UI pattern.
Soft-delete-in-use policy decision (per the story's explicit "decide at DIP time"): warn, don't block. Archiving a type currently referenced by existing events doesn't corrupt those events (the FK trigger only validates on events INSERT/UPDATE, not retroactively) — it only removes the type from future selection. The admin page shows each type's current usage count and, if archiving a type with count > 0, confirms via the same window.confirm() pattern with the count stated explicitly (e.g. "12 events currently use this type..."). No new blocking mechanism.
Usage counts: no existing endpoint returns this. Added as a new repository function (listEventTypesWithUsageCounts) used only by the new admin page's server component — a two-query-plus-JS-reduce pattern, matching the existing precedent in report.repository.ts's getRsvpReportSummary rather than a single complex SQL aggregate. The existing GET /api/event-types endpoint (consumed by both platforms' pickers) is left completely untouched to avoid any risk to already-working picker code.
Domain rules: no conflict. Purely event-configuration and admin tooling — doesn't touch RSVP, self-report, attendance, or formation invariants.

Implementation Plan

Migration: DROP FUNCTION IF EXISTS update_event_with_audit(UUID, UUID, JSONB, UUID); then CREATE OR REPLACE FUNCTION with event_type_id added to RETURNS TABLE, a new CASE WHEN p_patch ? 'event_type_id' THEN (p_patch->>'event_type_id')::UUID ELSE events.event_type_id END clause in the UPDATE, and v_row.event_type_id added to the final RETURN QUERY SELECT. Every other column/clause carried forward unchanged from the current live definition.
event-type.repository.ts: add listEventTypesWithUsageCounts(tenantId) — fetch all types (including soft-deleted, so archived ones still show with a status badge) via listEventTypes(tenantId, true), separately fetch event_type_id for every event in the tenant, reduce to a Map<type_id, count> in JS, merge, return (EventTypeRow & { event_count: number })[].
New admin page app/admin/(shell)/event-types/page.tsx: server component, Admin-tier only (redirect otherwise, matching Groups' pattern exactly), fetches via listEventTypesWithUsageCounts, renders EventTypesTable.
New client component app/admin/(shell)/event-types/EventTypesTable.tsx: inline create form (name + code inputs, POST /api/event-types), list of types below (name, code, status badge Active/Archived, usage count), inline rename (click name/code to edit, PATCH /api/event-types/:id), archive/restore toggle button (PATCH with deleted_at set/cleared) — window.confirm() before archiving, message includes the usage count when > 0.
AdminSidebar.tsx: add { href: '/admin/event-types', label: 'Event Types', adminOnly: true } immediately after the Events entry.
UpdateEventInput (service.ts): add eventTypeId?: string.
updateEvent() (service.ts): when input.eventTypeId !== undefined, call validateEventTypeId(input.eventTypeId, tenantId) (already exists, currently only called from createEvent — reused here, same defense-in-depth pattern already used for prayerLeaderMemberId), then add patch.event_type_id = input.eventTypeId to the patch-building block.
app/api/events/[id]/route.ts: add eventTypeId to the PATCH handler's body destructuring and pass it through to updateEvent().
No change needed to EventForm.tsx — confirmed it already sends eventTypeId correctly on both create and edit; the bug was entirely downstream of it.

Files to Create/Modify

supabase/migrations/20260718000048_event_type_id_patchable.sql (new)
src/features/event-types/event-type.repository.ts
app/admin/(shell)/event-types/page.tsx (new)
app/admin/(shell)/event-types/EventTypesTable.tsx (new)
src/components/admin/AdminSidebar.tsx
src/features/events/service.ts
app/api/events/[id]/route.ts

Migration Files
sql-- DIP-FP-131-web: event_type_id was never patchable via update_event_with_audit()
-- despite the app layer (EventForm.tsx) already sending it on edit — the RPC's
-- column mapping simply never included it. Confirmed end-to-end trace, not
-- assumed. RETURNS TABLE column set changes, so DROP FUNCTION IF EXISTS first,
-- per standing house rule.

DROP FUNCTION IF EXISTS update_event_with_audit(UUID, UUID, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.update_event_with_audit(
    p_event_id UUID,
    p_tenant_id UUID,
    p_patch JSONB,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, version INT,
    start_datetime TIMESTAMPTZ, end_datetime TIMESTAMPTZ,
    location_name TEXT, location_address TEXT, location_url TEXT,
    target JSONB, talk_id UUID, prayer_leader_member_id UUID, food_assignment JSONB,
    online_meeting_resource_id UUID, online_meeting_url TEXT, online_meeting_platform_label TEXT,
    rsvp_closure_days INTEGER, event_type_id UUID, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_before JSONB;
  v_row events%ROWTYPE;
BEGIN
  SELECT to_jsonb(e) INTO v_before FROM events e WHERE e.id = p_event_id AND e.tenant_id = p_tenant_id;

  UPDATE events SET
    name                     = COALESCE(p_patch->>'name',                    events.name),
    start_datetime           = COALESCE((p_patch->>'start_datetime')::TIMESTAMPTZ, events.start_datetime),
    end_datetime             = COALESCE((p_patch->>'end_datetime')::TIMESTAMPTZ,   events.end_datetime),
    location_name            = COALESCE(p_patch->>'location_name',          events.location_name),
    location_address         = COALESCE(p_patch->>'location_address',       events.location_address),
    location_url             = CASE WHEN p_patch ? 'location_url' THEN p_patch->>'location_url' ELSE events.location_url END,
    target                   = COALESCE(p_patch->'target',                  events.target),
    talk_id                  = CASE WHEN p_patch ? 'talk_id' THEN (p_patch->>'talk_id')::UUID ELSE events.talk_id END,
    prayer_leader_member_id  = CASE WHEN p_patch ? 'prayer_leader_member_id' THEN (p_patch->>'prayer_leader_member_id')::UUID ELSE events.prayer_leader_member_id END,
    food_assignment          = CASE WHEN p_patch ? 'food_assignment' THEN p_patch->'food_assignment' ELSE events.food_assignment END,
    online_meeting_resource_id = CASE WHEN p_patch ? 'online_meeting_resource_id' THEN (p_patch->>'online_meeting_resource_id')::UUID ELSE events.online_meeting_resource_id END,
    online_meeting_url         = CASE WHEN p_patch ? 'online_meeting_url' THEN p_patch->>'online_meeting_url' ELSE events.online_meeting_url END,
    online_meeting_platform_label = CASE WHEN p_patch ? 'online_meeting_platform_label' THEN p_patch->>'online_meeting_platform_label' ELSE events.online_meeting_platform_label END,
    rsvp_closure_days        = CASE WHEN p_patch ? 'rsvp_closure_days' THEN (p_patch->>'rsvp_closure_days')::INTEGER ELSE events.rsvp_closure_days END,
    event_type_id            = CASE WHEN p_patch ? 'event_type_id' THEN (p_patch->>'event_type_id')::UUID ELSE events.event_type_id END,
    version                  = events.version + 1,
    updated_at               = now()
  WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'update', p_actor_member_id, v_before, to_jsonb(v_row));

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.version, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.location_address, v_row.location_url,
    v_row.target, v_row.talk_id, v_row.prayer_leader_member_id, v_row.food_assignment,
    v_row.online_meeting_resource_id, v_row.online_meeting_url, v_row.online_meeting_platform_label,
    v_row.rsvp_closure_days, v_row.event_type_id, v_row.updated_at;
END;
$$;

-- Note: this RPC does NOT re-validate event_type_id against event_types
-- (active/same-tenant) at the SQL layer — that check is app-layer only
-- (validateEventTypeId(), called from updateEvent() before this RPC runs),
-- matching the existing precedent for prayer_leader_member_id and talk_id
-- on this same function. The cross-tenant/soft-delete trigger on `events`
-- (trigger_validate_event_event_type_id, from migration 000016) still fires
-- on this UPDATE regardless, as defense-in-depth underneath the app check.
Branch Name
feature/FP-131-event-types-admin
Commit Message
FP-131: event type admin CRUD + fix event_type_id not persisting on edit
Pull Request Description
Maps to acceptance criteria:

"Web admin screen to list, create, rename, and soft-delete event types" → new /admin/event-types page + table, reusing the already-existing POST/PATCH /api/event-types endpoints.
"Soft-deleting a type in use is blocked or clearly warned about — decide at DIP time" → warn via window.confirm() with usage count, not blocked; documented reasoning in Grounding Check.
"Event Create/Edit forms present the tenant's active event types instead of silently using the default" → Create was already correct on both platforms (no change needed); Edit was silently broken — this DIP fixes the actual root cause (RPC column mapping), not just app code.
"General type remains valid, no deletion required" → untouched, no migration changes its row.
"Tenants created after migration 000016 have no default type" → the new admin page has no dependency on a pre-seeded row; an admin can create the first type for such a tenant through this UI, closing that gap as a side effect (not a special-cased fix).

Jira Linkage

PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
PDEStoryID: FP-131

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-131-web.md, frozen after save. npm run build must pass cleanly. Validate the migration locally via supabase db reset before opening the PR. Open PR against dev, do not merge. Flag the manual remote-migration-apply step explicitly in the PR description, same as every prior migration DIP.
Include full diffs for every file in the completion report — not a summary.
