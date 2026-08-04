import { createClient } from '@supabase/supabase-js';
import { validateTalkIdForEvent } from '@/src/features/formation/talk.service';
import { getMembersAssignedToLeader } from '@/src/features/assignments/service';
import { getTalk } from '@/src/features/formation/talk.repository';
import { getModule } from '@/src/features/formation/module.repository';
import { getCourse } from '@/src/features/formation/course.repository';
import { getTenantRsvpClosureDaysDefault } from '@/src/features/rsvps/rsvp.repository';
import { computeRsvpClosureAt } from '@/src/features/rsvps/rsvp-window';
import { getAcknowledgedAt } from '@/src/features/announcements/announcement.repository';
import type { EventListItemRow } from './event.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function validateEventTypeId(eventTypeId: string, tenantId: string): Promise<void> {
  const { data } = await serviceClient()
    .from('event_types')
    .select('id, deleted_at')
    .eq('id', eventTypeId)
    .eq('tenant_id', tenantId)
    .single();
  if (!data || data.deleted_at !== null) {
    const err = new Error(`event_type_id ${eventTypeId} is invalid, soft-deleted, or belongs to a different tenant`) as Error & { code: string };
    err.code = 'INVALID_TARGET';
    throw err;
  }
}

export interface MeetingResourceOption {
  id: string;
  name: string;
  join_url: string;
}

// DIP-FP-120-web: tenant-scoped list for the "Online Meeting" dropdown —
// any authenticated member can read it (GET /api/meeting-resources has no
// role restriction), so this returns every meeting_resources row for the
// tenant, no filtering.
export async function listMeetingResources(tenantId: string): Promise<MeetingResourceOption[]> {
  const { data, error } = await serviceClient()
    .from('meeting_resources')
    .select('id, name, join_url')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export interface CreateEventInput {
  tenantId: string;
  eventTypeId: string;
  name: string;
  startDatetime: string;
  endDatetime: string;
  locationName: string;
  locationAddress: string;
  locationUrl?: string | null;
  target: { group_ids?: string[]; member_ids?: string[] };
  talkId?: string | null;
  onlineMeetingResourceId?: string | null;
  onlineMeetingUrl?: string | null;
  onlineMeetingPlatformLabel?: string | null;
  rsvpClosureDays?: number | null;
  // DIP-FP-191-web: only meaningful for the Announcement system type — passed
  // through as-is; insert_event_with_audit ignores it for every other type.
  announcementBody?: string | null;
  actorMemberId?: string | null;
}

function validateRsvpClosureDays(value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > 90) {
    const err = new Error('rsvp_closure_days must be an integer between 0 and 90') as Error & { code: string };
    err.code = 'INVALID_VALUE';
    throw err;
  }
}

// DIP-FP-120-web: the pre-check that gives a normal double-booking attempt a
// genuinely useful message (conflicting event name/time/booker) — the
// EXCLUDE constraint itself remains the real, race-condition-free
// enforcement (see migration 20260717000040), but a raw 23P01 from that
// constraint carries no row detail, only a SQLSTATE.
export interface MeetingResourceConflict {
  eventId: string;
  eventName: string;
  startDatetime: string;
  endDatetime: string;
  bookedByName: string;
}

export async function findMeetingResourceConflict(
  tenantId: string,
  resourceId: string,
  startDatetime: string,
  endDatetime: string,
  excludeEventId?: string
): Promise<MeetingResourceConflict | null> {
  const db = serviceClient();

  let query = db
    .from('events')
    .select('id, name, start_datetime, end_datetime, members!created_by_member_id(first_name, last_name)')
    .eq('tenant_id', tenantId)
    .eq('online_meeting_resource_id', resourceId)
    .neq('status', 'CANCELLED')
    .lt('start_datetime', endDatetime)
    .gt('end_datetime', startDatetime);

  if (excludeEventId) {
    query = query.neq('id', excludeEventId);
  }

  const { data, error } = await query.limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return null;

  const row = data[0] as {
    id: string;
    name: string;
    start_datetime: string;
    end_datetime: string;
    members: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
  };
  const member = Array.isArray(row.members) ? row.members[0] : row.members;

  return {
    eventId: row.id,
    eventName: row.name,
    startDatetime: row.start_datetime,
    endDatetime: row.end_datetime,
    bookedByName: member ? `${member.first_name} ${member.last_name}` : 'Unknown',
  };
}

function meetingResourceConflictError(conflict: MeetingResourceConflict): Error & { code: string; conflict: MeetingResourceConflict } {
  const err = new Error(
    `This account is already booked for ${conflict.eventName} on ${conflict.startDatetime} by ${conflict.bookedByName}`
  ) as Error & { code: string; conflict: MeetingResourceConflict };
  err.code = 'MEETING_RESOURCE_CONFLICT';
  err.conflict = conflict;
  return err;
}

// The rare race-condition path: two simultaneous submissions both pass the
// pre-check, and the DB's EXCLUDE constraint (the real enforcement) rejects
// the second one at write time. No conflicting-event detail is available
// here — that's expected, not a bug to chase (see DIP Grounding Check).
function isMeetingResourceExclusionViolation(error: { code?: string }): boolean {
  return error.code === '23P01';
}

function meetingResourceRaceError(): Error & { code: string } {
  const err = new Error('This account was just booked by someone else — please try again') as Error & { code: string };
  err.code = 'MEETING_RESOURCE_CONFLICT';
  return err;
}

export async function createEvent(input: CreateEventInput) {
  if (new Date(input.endDatetime) <= new Date(input.startDatetime)) {
    const err = new Error('end_datetime must be after start_datetime') as Error & { code: string };
    err.code = 'INVALID_DATETIME';
    throw err;
  }
  validateRsvpClosureDays(input.rsvpClosureDays);

  // App-layer validation — defense-in-depth on top of DB triggers.
  await validateEventTypeId(input.eventTypeId, input.tenantId);
  if (input.talkId) {
    await validateTalkIdForEvent(input.talkId, input.tenantId);
  }

  // DIP-FP-120-web: pre-check gives a genuinely useful conflict message in
  // the normal case; the EXCLUDE constraint (Section 7 below) is the real,
  // race-condition-free enforcement.
  if (input.onlineMeetingResourceId) {
    const conflict = await findMeetingResourceConflict(
      input.tenantId, input.onlineMeetingResourceId, input.startDatetime, input.endDatetime
    );
    if (conflict) throw meetingResourceConflictError(conflict);
  }

  const { data, error } = await serviceClient().rpc('insert_event_with_audit', {
    p_tenant_id: input.tenantId,
    p_event_type_id: input.eventTypeId,
    p_name: input.name,
    p_start_datetime: input.startDatetime,
    p_end_datetime: input.endDatetime,
    p_location_name: input.locationName,
    p_location_address: input.locationAddress,
    p_location_url: input.locationUrl ?? null,
    p_target: input.target,
    p_talk_id: input.talkId ?? null,
    p_online_meeting_resource_id: input.onlineMeetingResourceId ?? null,
    p_online_meeting_url: input.onlineMeetingUrl ?? null,
    p_online_meeting_platform_label: input.onlineMeetingPlatformLabel ?? null,
    p_rsvp_closure_days: input.rsvpClosureDays ?? null,
    p_announcement_body: input.announcementBody ?? null,
    p_actor_member_id: input.actorMemberId ?? null,
  });

  if (error) {
    if (isMeetingResourceExclusionViolation(error)) throw meetingResourceRaceError();
    if ((error.message ?? '').includes('ANNOUNCEMENT_MISSING_EVERYONE_GROUP')) {
      const err = new Error('This tenant has no Everyone system group to target — FP-181 must be provisioned first') as Error & { code: string };
      err.code = 'ANNOUNCEMENT_MISSING_EVERYONE_GROUP';
      throw err;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;

  // DIP-FP-114-web: creator tracking, set via a follow-up UPDATE rather than
  // threading a new param through insert_event_with_audit() — changing that
  // RPC's RETURNS TABLE shape would require a DROP FUNCTION (Postgres doesn't
  // allow CREATE OR REPLACE to change a function's return shape), which is a
  // needlessly bigger and riskier change than one extra scoped UPDATE. Known
  // tradeoff: the RPC's own audit-log "create" snapshot (already captured
  // before this UPDATE runs) won't include created_by_member_id — acceptable
  // since no web UI surfaces audit logs today, and ownership isn't really
  // "what changed" in the event's own data anyway.
  if (input.actorMemberId) {
    // FP-161-2: owner_member_id is set alongside created_by_member_id in this same
    // follow-up UPDATE, not a second round trip — the creator is the initial owner,
    // exactly matching how create_group_with_audit() sets both created_by and
    // owner_member_id to the same actor at creation time.
    const { data: withCreator, error: creatorError } = await serviceClient()
      .from('events')
      .update({ created_by_member_id: input.actorMemberId, owner_member_id: input.actorMemberId })
      .eq('id', row.id)
      .eq('tenant_id', input.tenantId)
      .select('id, name, status, start_datetime, end_datetime, location_name, location_address, location_url, target, talk_id, online_meeting_resource_id, online_meeting_url, online_meeting_platform_label, rsvp_closure_days, announcement_body, created_at, created_by_member_id, owner_member_id')
      .single();
    if (creatorError) throw creatorError;
    return withCreator;
  }

  return row;
}

// DIP-FP-114-web: scopeToOwnerMemberId mirrors updateEvent()/cancelEvent()'s
// ownership check — Leader-tier can only publish drafts they own; otherwise
// create() would be pointless (a draft only Admin-tier could ever publish).
// FP-161-2: gated on owner_member_id (transferable), not created_by_member_id
// (permanent audit history only, no longer read for permission checks).
export async function publishEvent(id: string, tenantId: string, scopeToOwnerMemberId?: string) {
  // Fetch current state to validate transition.
  const { data: event, error: fetchError } = await serviceClient()
    .from('events')
    .select('id, status, name, start_datetime, end_datetime, location_name, event_type_id, target, owner_member_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (fetchError || !event) {
    const err = new Error('Event not found') as Error & { code: string };
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (scopeToOwnerMemberId && event.owner_member_id !== scopeToOwnerMemberId) {
    const err = new Error('You may only publish events you own') as Error & { code: string };
    err.code = 'FORBIDDEN_SCOPE';
    throw err;
  }

  if (event.status !== 'DRAFT') {
    const err = new Error(`Cannot publish event with status ${event.status}`) as Error & { code: string };
    err.code = 'INVALID_TRANSITION';
    throw err;
  }

  const requiredFields = ['name', 'start_datetime', 'end_datetime', 'location_name', 'event_type_id'] as const;
  for (const field of requiredFields) {
    if (!event[field]) {
      const err = new Error(`Missing required field: ${field}`) as Error & { code: string };
      err.code = 'MISSING_FIELD';
      throw err;
    }
  }

  if (new Date(event.end_datetime) <= new Date(event.start_datetime)) {
    const err = new Error('end_datetime must be after start_datetime') as Error & { code: string };
    err.code = 'INVALID_DATETIME';
    throw err;
  }

  // Transition to SCHEDULED — triggers handle_event_scheduling() for roster + notifications.
  const { data, error } = await serviceClient()
    .from('events')
    .update({ status: 'SCHEDULED', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, name, status, start_datetime, end_datetime')
    .single();

  if (error) throw error;
  return data;
}

export interface UpdateEventInput {
  name?: string;
  startDatetime?: string;
  endDatetime?: string;
  locationName?: string;
  locationAddress?: string;
  locationUrl?: string | null;
  target?: { group_ids?: string[]; member_ids?: string[] };
  eventTypeId?: string;
  talkId?: string | null;
  onlineMeetingResourceId?: string | null;
  onlineMeetingUrl?: string | null;
  onlineMeetingPlatformLabel?: string | null;
  rsvpClosureDays?: number | null;
  // DIP-FP-191-web: see CreateEventInput.announcementBody.
  announcementBody?: string | null;
  actorMemberId?: string | null;
}

// DIP-FP-114-web: scopeToOwnerMemberId, when provided (non-Admin-tier callers),
// enforces ownership — mirrors the scopeToLeaderMemberId opt-in pattern already
// established on getEventRoster() below. Omitted (Admin-tier callers) preserves
// unrestricted behavior.
// FP-161-2: gated on owner_member_id (transferable), not created_by_member_id
// (permanent audit history only, no longer read for permission checks).
export async function updateEvent(id: string, tenantId: string, input: UpdateEventInput, scopeToOwnerMemberId?: string) {
  const db = serviceClient();
  validateRsvpClosureDays(input.rsvpClosureDays);

  // Fetch current event state.
  const { data: event, error: fetchError } = await db
    .from('events')
    .select('id, status, version, talk_id, start_datetime, end_datetime, name, location_name, target, owner_member_id, online_meeting_resource_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (fetchError || !event) {
    const err = new Error('Event not found') as Error & { code: string };
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (scopeToOwnerMemberId && event.owner_member_id !== scopeToOwnerMemberId) {
    const err = new Error('You may only edit events you own') as Error & { code: string };
    err.code = 'FORBIDDEN_SCOPE';
    throw err;
  }

  if (event.status === 'LOCKED' || event.status === 'CANCELLED') {
    const err = new Error(`Cannot update event with status ${event.status}`) as Error & { code: string };
    err.code = 'INVALID_STATE';
    throw err;
  }

  // talk_id is immutable once any notification has been dispatched (status != PENDING).
  if (input.talkId !== undefined && input.talkId !== event.talk_id) {
    const { count, error: notifError } = await db
      .from('event_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', id)
      .neq('status', 'PENDING');

    if (notifError) throw notifError;

    if ((count ?? 0) > 0) {
      const err = new Error('talk_id is immutable after notifications have been dispatched') as Error & { code: string };
      err.code = 'IMMUTABLE_FIELD';
      throw err;
    }

    // App-layer validation for talk_id — defense-in-depth on top of DB trigger.
    if (input.talkId) {
      await validateTalkIdForEvent(input.talkId, tenantId);
    }
  }

  // DIP-FP-131-web: reuses validateEventTypeId() as-is (previously only called
  // from createEvent). No immutability rule — there was never a deliberate
  // constraint here, just an accidental gap in update_event_with_audit()'s
  // column mapping.
  if (input.eventTypeId !== undefined) {
    await validateEventTypeId(input.eventTypeId, tenantId);
  }

  // Validate datetime ordering if either end is being changed.
  const newStart = input.startDatetime ?? event.start_datetime;
  const newEnd = input.endDatetime ?? event.end_datetime;
  if (new Date(newEnd) <= new Date(newStart)) {
    const err = new Error('end_datetime must be after start_datetime') as Error & { code: string };
    err.code = 'INVALID_DATETIME';
    throw err;
  }

  // DIP-FP-120-web: pre-check runs against the *effective* resource
  // (whichever this update leaves in place, whether or not this specific
  // request touched onlineMeetingResourceId) and the effective new
  // start/end computed above — update_event_with_audit()'s UPDATE rewrites
  // every constraint-relevant column on every call regardless of which
  // patch keys were provided, so the EXCLUDE constraint always re-validates
  // the full row; this pre-check mirrors that so a time-only edit that now
  // collides with another event's reservation still gets the detailed
  // message instead of falling through to the generic race fallback.
  const effectiveOnlineMeetingResourceId =
    input.onlineMeetingResourceId !== undefined ? input.onlineMeetingResourceId : event.online_meeting_resource_id;
  if (effectiveOnlineMeetingResourceId) {
    const conflict = await findMeetingResourceConflict(
      tenantId, effectiveOnlineMeetingResourceId, newStart, newEnd, id
    );
    if (conflict) throw meetingResourceConflictError(conflict);
  }

  // Build the patch payload for update_event_with_audit().
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.startDatetime !== undefined) patch.start_datetime = input.startDatetime;
  if (input.endDatetime !== undefined) patch.end_datetime = input.endDatetime;
  if (input.locationName !== undefined) patch.location_name = input.locationName;
  if (input.locationAddress !== undefined) patch.location_address = input.locationAddress;
  if (input.locationUrl !== undefined) patch.location_url = input.locationUrl;
  if (input.target !== undefined) patch.target = input.target;
  if (input.talkId !== undefined) patch.talk_id = input.talkId;
  if (input.onlineMeetingResourceId !== undefined) patch.online_meeting_resource_id = input.onlineMeetingResourceId;
  if (input.onlineMeetingUrl !== undefined) patch.online_meeting_url = input.onlineMeetingUrl;
  if (input.onlineMeetingPlatformLabel !== undefined) patch.online_meeting_platform_label = input.onlineMeetingPlatformLabel;
  if (input.rsvpClosureDays !== undefined) patch.rsvp_closure_days = input.rsvpClosureDays;
  if (input.eventTypeId !== undefined) patch.event_type_id = input.eventTypeId;
  if (input.announcementBody !== undefined) patch.announcement_body = input.announcementBody;

  const { data: updateRows, error: updateError } = await db.rpc('update_event_with_audit', {
    p_event_id: id,
    p_tenant_id: tenantId,
    p_patch: patch,
    p_actor_member_id: input.actorMemberId ?? null,
  });

  if (updateError) {
    if (isMeetingResourceExclusionViolation(updateError)) throw meetingResourceRaceError();
    if ((updateError.message ?? '').includes('ANNOUNCEMENT_MISSING_EVERYONE_GROUP')) {
      const err = new Error('This tenant has no Everyone system group to target — FP-181 must be provisioned first') as Error & { code: string };
      err.code = 'ANNOUNCEMENT_MISSING_EVERYONE_GROUP';
      throw err;
    }
    throw updateError;
  }

  const updated = Array.isArray(updateRows) ? updateRows[0] : updateRows;

  // Recalculate unsent notification scheduled_for values when timing changes.
  // Each purpose has a fixed offset relative to a reference time; recompute
  // from the new reference rather than preserving the old absolute timestamp.
  const timingChanged = input.startDatetime !== undefined || input.endDatetime !== undefined;
  if (timingChanged) {
    const start = new Date(newStart);
    const end = new Date(newEnd);

    const rescheduleMap: Record<string, Date> = {
      PRE_EVENT_REMINDER:     new Date(start.getTime() - 24 * 60 * 60 * 1000),
      POST_EVENT_SELF_REPORT: new Date(end.getTime()),
      LEADER_CONFIRMATION:    new Date(end.getTime() + 2 * 60 * 60 * 1000),
    };

    const { data: unsent, error: unsentError } = await db
      .from('event_notifications')
      .select('id, purpose')
      .eq('event_id', id)
      .in('status', ['PENDING', 'RETRYING'])
      .in('purpose', ['PRE_EVENT_REMINDER', 'POST_EVENT_SELF_REPORT', 'LEADER_CONFIRMATION']);

    if (unsentError) throw unsentError;

    for (const row of unsent ?? []) {
      const newScheduledFor = rescheduleMap[row.purpose as string];
      if (!newScheduledFor) continue;
      const { error: reschedErr } = await db
        .from('event_notifications')
        .update({ scheduled_for: newScheduledFor.toISOString() })
        .eq('id', row.id);
      if (reschedErr) throw reschedErr;
    }
  }

  // Insert EVENT_UPDATE notification for every expected attendee.
  // scheduled_for = now (immediate; dispatch is handled by a separate worker).
  const { data: attendees, error: attendeesError } = await db
    .from('event_attendees')
    .select('member_id')
    .eq('event_id', id)
    .eq('tenant_id', tenantId);

  if (attendeesError) throw attendeesError;

  if ((attendees ?? []).length > 0) {
    const now = new Date().toISOString();
    const notifRows = (attendees ?? []).map((a: { member_id: string }) => ({
      tenant_id: tenantId,
      event_id: id,
      purpose: 'EVENT_UPDATE',
      scheduled_for: now,
      status: 'PENDING',
    }));

    const { error: notifInsertError } = await db
      .from('event_notifications')
      .insert(notifRows);

    if (notifInsertError) throw notifInsertError;
  }

  return updated;
}

// Reuse get_event_effective_status() per row rather than reimplementing the
// DRAFT/SCHEDULED/ACTIVE/COMPLETED/LOCKED derivation logic in TypeScript.
// DIP-FP-119-web: exported so self-report.repository.ts can reuse it rather
// than duplicating status-derivation logic.
export async function attachEffectiveStatus<T extends { id: string }>(events: T[]): Promise<(T & { effective_status: string })[]> {
  const db = serviceClient();
  return Promise.all(
    events.map(async (e) => {
      const { data: effectiveStatus, error: statusError } = await db.rpc('get_event_effective_status', {
        p_event_id: e.id,
      });
      if (statusError) throw statusError;
      return { ...e, effective_status: effectiveStatus as string };
    })
  );
}

const LIST_EVENTS_COLS = 'id, name, status, start_datetime, end_datetime, location_name, location_address, location_url, target, event_type_id, online_meeting_resource_id, online_meeting_url, online_meeting_platform_label, rsvp_closure_days, created_at';

export interface ListEventsOptions {
  limit?: number;
  offset?: number;
  eventTypeIds?: string[];
  // 'YYYY-MM' — matches an <input type="month"> value. Parsed as UTC month
  // boundaries; this app doesn't do per-user timezone handling anywhere else,
  // so this doesn't invent a new precedent.
  month?: string;
  // Effective status values (DRAFT/SCHEDULED/ACTIVE/COMPLETED/LOCKED/CANCELLED).
  status?: string[];
}

export interface ListEventsResult<T> {
  data: T[];
  hasMore: boolean;
}

function monthRange(month: string): { start: string; end: string } {
  const [year, monthNum] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthNum - 1, 1));
  const end = new Date(Date.UTC(year, monthNum, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

// FP-167-1: real backend pagination + filtering for the admin Events page's
// infinite scroll, not a client-side wrapper around a full unconditional fetch.
//
// event_type_id and start_datetime (via the month filter) are real columns, so
// those are applied at the query level in all cases. effective_status is NOT a
// stored column — get_event_effective_status() derives it per-row at query time
// (DRAFT/CANCELLED pass through as-is; SCHEDULED/ACTIVE/COMPLETED/LOCKED are
// time-windowed against now() and the tenant's attendance_window_hours) — so it
// can't be filtered with a plain PostgREST .eq()/.in(). Two paths:
//   - No status filter (the common case): true DB-level LIMIT/OFFSET via
//     .range(), with an exact count so hasMore is accurate. attachEffectiveStatus
//     then only needs to compute status for the one page just fetched.
//   - Status filter present: fetch the full type/month-filtered candidate set
//     (still bounded by those query-level filters, not the whole tenant
//     unconditionally) and bulk-resolve every candidate's status in one round
//     trip via get_events_effective_statuses() (FP-121's canonical SQL
//     function — reused as-is, not a hand-rolled JS reimplementation of the
//     time-window logic that could silently drift from it), then filter and
//     slice the page window server-side. The client still only ever receives
//     one page's worth of rows, regardless of which path served it.
export async function listEvents(
  tenantId: string, options: ListEventsOptions = {}
): Promise<ListEventsResult<EventListItemRow>> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const db = serviceClient();

  let query = db
    .from('events')
    .select(LIST_EVENTS_COLS, { count: 'exact' })
    .eq('tenant_id', tenantId);

  if (options.eventTypeIds && options.eventTypeIds.length > 0) {
    query = query.in('event_type_id', options.eventTypeIds);
  }
  if (options.month) {
    const { start, end } = monthRange(options.month);
    query = query.gte('start_datetime', start).lt('start_datetime', end);
  }
  query = query.order('start_datetime', { ascending: true });

  if (!options.status || options.status.length === 0) {
    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;
    const withStatus = await attachEffectiveStatus(data ?? []);
    return { data: withStatus as unknown as EventListItemRow[], hasMore: offset + withStatus.length < (count ?? 0) };
  }

  const { data: candidates, error } = await query;
  if (error) throw error;
  if (!candidates || candidates.length === 0) return { data: [], hasMore: false };

  const { data: statuses, error: statusError } = await db.rpc('get_events_effective_statuses', {
    p_tenant_id: tenantId,
    p_event_ids: candidates.map((e: { id: string }) => e.id),
  });
  if (statusError) throw statusError;

  const statusById = new Map<string, string>();
  for (const s of (statuses ?? []) as { event_id: string; effective_status: string }[]) {
    statusById.set(s.event_id, s.effective_status);
  }
  const withStatus = candidates.map((e: { id: string }) => ({ ...e, effective_status: statusById.get(e.id) ?? 'DRAFT' }));
  const matching = withStatus.filter((e: { effective_status: string }) => options.status!.includes(e.effective_status));
  const page = matching.slice(offset, offset + limit);

  return { data: page as unknown as EventListItemRow[], hasMore: offset + page.length < matching.length };
}

// FP-167-1: found live while changing listEvents()'s contract, not in the DIP's
// own file list — the RSVP and Attendance report pages both called
// listEvents(tenantId) with no options, for an unconditional "every event, id/
// name/start_datetime only" filter-dropdown source, unrelated to the admin
// Events page's new pagination. Splitting this out preserves their exact prior
// behavior (all events, no cap) without contorting the new paginated
// listEvents() into serving two genuinely different call shapes, and without
// the arbitrary "just pass a big limit" hack that would silently cap out for a
// tenant with enough historical events.
export async function listEventOptions(tenantId: string): Promise<{ id: string; name: string; start_datetime: string }[]> {
  const { data, error } = await serviceClient()
    .from('events')
    .select('id, name, start_datetime')
    .eq('tenant_id', tenantId)
    .order('start_datetime', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

// FP-94/FP-66: member-scoped "my events" — event_attendees is the materialized
// invite list (populated by handle_event_scheduling() on publish), so this is
// the source of truth for "what's this member invited to" with zero manual
// target-matching. DRAFT events never get an event_attendees row, so they're
// excluded automatically. CANCELLED is deliberately not filtered out (FP-66 AC).
export async function listEventsForMember(tenantId: string, memberId: string) {
  const db = serviceClient();

  const { data: attendeeRows, error: attendeeError } = await db
    .from('event_attendees')
    .select('event_id')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId);

  if (attendeeError) throw attendeeError;

  const eventIds = (attendeeRows ?? []).map((r: { event_id: string }) => r.event_id);
  if (eventIds.length === 0) return [];

  const { data: events, error: eventsError } = await db
    .from('events')
    .select('id, name, status, start_datetime, end_datetime, location_name, location_address, location_url, target, event_type_id, online_meeting_resource_id, online_meeting_url, online_meeting_platform_label, rsvp_closure_days, announcement_body, created_at, created_by_member_id, event_type:event_types(id, name, system_key), created_by_member:members!created_by_member_id(id, first_name, last_name)')
    .eq('tenant_id', tenantId)
    .in('id', eventIds)
    .order('start_datetime', { ascending: true });

  if (eventsError) throw eventsError;

  // DIP-FP-191-web: event_type embed comes back as either an object or a
  // single-element array depending on how PostgREST infers the relationship
  // cardinality — normalized here rather than at every call site, same
  // defensive pattern as getEventRoster()'s members embed below.
  // DIP-FP-191-web-adj-1: created_by_member gets the same normalization —
  // additionally null (not just possibly-array) for events that predate
  // FP-114-web's created_by_member_id column.
  const normalizedEvents = (events ?? []).map((e) => ({
    ...e,
    event_type: Array.isArray(e.event_type) ? e.event_type[0] : e.event_type,
    created_by_member: Array.isArray(e.created_by_member) ? (e.created_by_member[0] ?? null) : e.created_by_member,
  }));

  const withEffectiveStatus = await attachEffectiveStatus(normalizedEvents);

  // FP-166: reverses FP-94/FP-66's original decision to let CANCELLED events pass
  // through regardless of timing — Joseph now wants them filtered out of My Events
  // entirely, matching how COMPLETED/LOCKED are already excluded.
  const upcoming = withEffectiveStatus.filter(
    (e) => !['COMPLETED', 'LOCKED', 'CANCELLED'].includes(e.effective_status)
  );
  if (upcoming.length === 0) return [];

  const [{ data: rsvps, error: rsvpError }, tenantDefaultDays] = await Promise.all([
    db
      .from('rsvps')
      .select('event_id, rsvp_status, rsvp_reason')
      .eq('tenant_id', tenantId)
      .eq('member_id', memberId)
      .in('event_id', upcoming.map((e) => e.id)),
    getTenantRsvpClosureDaysDefault(tenantId),
  ]);

  if (rsvpError) throw rsvpError;

  const rsvpByEvent = new Map(
    (rsvps ?? []).map((r: { event_id: string; rsvp_status: string; rsvp_reason: string | null }) => [r.event_id, r])
  );

  return upcoming.map((e) => {
    const rsvp = rsvpByEvent.get(e.id);
    return {
      ...e,
      rsvp_status: (rsvp?.rsvp_status as 'YES' | 'NO' | undefined) ?? null,
      rsvp_reason: rsvp?.rsvp_reason ?? null,
      rsvp_closure_at: computeRsvpClosureAt(e.start_datetime, e.rsvp_closure_days, tenantDefaultDays),
    };
  });
}

// DIP-FP-191-web-adj-1: callerMemberId is optional and additive — existing
// callers (getEventRoster, cancelEvent, getEventReminderContext) pass only
// (id, tenantId) and get acknowledged_at: null with no extra query, since
// none of them need per-caller state. Only GET /api/events/:id passes it.
export async function getEventById(id: string, tenantId: string, callerMemberId?: string) {
  const { data: event, error } = await serviceClient()
    .from('events')
    .select('id, name, status, start_datetime, end_datetime, location_name, location_address, location_url, target, event_type_id, talk_id, version, created_at, updated_at, recurrence_series_id, online_meeting_resource_id, online_meeting_url, online_meeting_platform_label, rsvp_closure_days, announcement_body, created_by_member_id, owner_member_id, event_type:event_types(id, name, system_key), created_by_member:members!created_by_member_id(id, first_name, last_name)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error || !event) {
    const err = new Error('Event not found') as Error & { code: string };
    err.code = 'NOT_FOUND';
    throw err;
  }

  const [{ data: effectiveStatus, error: statusError }, tenantDefaultDays, acknowledgedAt] = await Promise.all([
    serviceClient().rpc('get_event_effective_status', { p_event_id: id }),
    getTenantRsvpClosureDaysDefault(tenantId),
    callerMemberId ? getAcknowledgedAt(tenantId, id, callerMemberId) : Promise.resolve(null),
  ]);
  if (statusError) throw statusError;

  // DIP-FP-191-web: same embed-cardinality normalization as listEventsForMember.
  const eventType = Array.isArray(event.event_type) ? event.event_type[0] : event.event_type;
  const createdByMember = Array.isArray(event.created_by_member) ? (event.created_by_member[0] ?? null) : event.created_by_member;

  return {
    ...event,
    event_type: eventType,
    created_by_member: createdByMember,
    acknowledged_at: acknowledgedAt,
    effective_status: effectiveStatus as string,
    rsvp_closure_at: computeRsvpClosureAt(event.start_datetime, event.rsvp_closure_days, tenantDefaultDays),
  };
}

export interface EventReminderFormation {
  course_name: string;
  module_name: string;
  talk_name: string;
  talk_description: string | null;
}

// FP-96: resolves the Course/Module/Talk chain server-side so the mobile reminder
// notification never needs to chain three calls at fire time. Name resolution is
// alias-or-name at each level; only the Talk contributes its description.
// Any missing/soft-deleted link in the chain is treated the same as no talk_id —
// formation is omitted cleanly, no error (matches FP-96's own "no Talk assigned" AC).
export async function getEventReminderContext(eventId: string, tenantId: string) {
  const event = await getEventById(eventId, tenantId); // NOT_FOUND if missing/cross-tenant

  if (!event.talk_id) {
    return { ...event, formation: null };
  }

  const talk = await getTalk(event.talk_id, tenantId);
  if (!talk) return { ...event, formation: null };

  const talkModule = await getModule(talk.module_id, tenantId);
  if (!talkModule) return { ...event, formation: null };

  const course = await getCourse(talkModule.course_id, tenantId);
  if (!course) return { ...event, formation: null };

  const formation: EventReminderFormation = {
    course_name: course.alias || course.name,
    module_name: talkModule.alias || talkModule.name,
    talk_name: talk.alias || talk.name,
    talk_description: talk.description,
  };

  return { ...event, formation };
}

// DIP-FP-114-web: scopeToOwnerMemberId mirrors updateEvent()'s ownership check —
// requires a pre-fetch (getEventById) only when provided, since the RPC itself
// has no notion of caller identity to enforce this against.
// FP-161-2: gated on owner_member_id (transferable), not created_by_member_id
// (permanent audit history only, no longer read for permission checks).
export async function cancelEvent(id: string, tenantId: string, actorMemberId?: string | null, scopeToOwnerMemberId?: string) {
  if (scopeToOwnerMemberId) {
    const event = await getEventById(id, tenantId); // throws NOT_FOUND if missing/cross-tenant
    if (event.owner_member_id !== scopeToOwnerMemberId) {
      const err = new Error('You may only cancel events you own') as Error & { code: string };
      err.code = 'FORBIDDEN_SCOPE';
      throw err;
    }
  }

  const { data, error } = await serviceClient().rpc('cancel_event_with_audit', {
    p_event_id: id,
    p_tenant_id: tenantId,
    p_actor_member_id: actorMemberId ?? null,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('not found for tenant')) {
      const err = new Error('Event not found') as Error & { code: string };
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (msg.includes('cannot be cancelled from status')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'INVALID_STATE_TRANSITION';
      throw err;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row;
}

// FP-161-2: single-event owner reassignment, Admin-only. Mirrors reassignGroupOwner's
// NOT_FOUND_IN_TENANT mapping, plus VALIDATION_ERROR for an inactive/foreign-tenant new
// owner (matches bulkReassignLeaderMembers's/reassignGroupOwner's error-mapping convention).
export async function reassignEventOwner(
  eventId: string, tenantId: string, newOwnerMemberId: string, actorMemberId: string
) {
  const { data, error } = await serviceClient().rpc('reassign_event_owner_with_audit', {
    p_event_id: eventId,
    p_tenant_id: tenantId,
    p_new_owner_member_id: newOwnerMemberId,
    p_actor_member_id: actorMemberId,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('NOT_FOUND_IN_TENANT')) {
      const err = new Error('Event not found') as Error & { code: string };
      err.code = 'NOT_FOUND_IN_TENANT';
      throw err;
    }
    if (msg.includes('VALIDATION_ERROR')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row;
}

// FP-161-2: atomic bulk reassignment — thin wrapper over
// bulk_reassign_event_owner_with_audit(), which reuses reassign_event_owner_with_audit()
// per affected event inside one transaction (mirrors bulkReassignGroupOwner's shape).
export async function bulkReassignEventOwner(
  outgoingOwnerId: string, incomingOwnerId: string, tenantId: string, actorMemberId: string
) {
  const { data, error } = await serviceClient().rpc('bulk_reassign_event_owner_with_audit', {
    p_outgoing_owner_id: outgoingOwnerId,
    p_incoming_owner_id: incomingOwnerId,
    p_tenant_id: tenantId,
    p_actor_member_id: actorMemberId,
  });

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('VALIDATION_ERROR')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    if (msg.includes('CROSS_TENANT_ACCESS')) {
      const err = new Error(msg) as Error & { code: string };
      err.code = 'CROSS_TENANT_ACCESS';
      throw err;
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row;
}

export interface RosterEntry {
  member_id: string;
  first_name: string;
  last_name: string;
  response: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NOT_RESPONDED';
  rsvp_reason: string | null;
}

// Strictly RSVP-scoped (FP-67 Design Decision) — does not pull in self-report or
// official attendance data. event_attendees is the full invited roster; rsvps is
// each member's response, if any. Both sides tenant-scoped.
//
// FP-95: scopeToLeaderMemberId, when provided, filters the roster down to members
// assigned to that leader via getMembersAssignedToLeader() — reused as-is, not
// reimplemented. Omitted (Admin callers) preserves FP-67's full-roster behavior.
export async function getEventRoster(eventId: string, tenantId: string, scopeToLeaderMemberId?: string): Promise<RosterEntry[]> {
  const db = serviceClient();

  const event = await getEventById(eventId, tenantId); // NOT_FOUND if missing/cross-tenant
  void event;

  const { data: attendees, error: attendeesError } = await db
    .from('event_attendees')
    .select('member_id, members(first_name, last_name)')
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId);

  if (attendeesError) throw attendeesError;

  let scopedAttendees = attendees ?? [];
  if (scopeToLeaderMemberId) {
    const assignedMembers = await getMembersAssignedToLeader(scopeToLeaderMemberId, tenantId);
    const assignedIds = new Set(assignedMembers.map((m) => (m as { id: string }).id));
    scopedAttendees = scopedAttendees.filter((a: { member_id: string }) => assignedIds.has(a.member_id));
  }

  const { data: rsvps, error: rsvpError } = await db
    .from('rsvps')
    .select('member_id, rsvp_status, rsvp_reason')
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId);

  if (rsvpError) throw rsvpError;

  const rsvpByMember = new Map(
    (rsvps ?? []).map(r => [r.member_id as string, r as { rsvp_status: string; rsvp_reason: string | null }])
  );

  return scopedAttendees.map((a: { member_id: string; members: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null }) => {
    const member = Array.isArray(a.members) ? a.members[0] : a.members;
    const rsvp = rsvpByMember.get(a.member_id);
    const response: RosterEntry['response'] =
      !rsvp
        ? 'NOT_RESPONDED'
        : rsvp.rsvp_status === 'YES'
        ? 'ACCEPTED'
        : rsvp.rsvp_status === 'TENTATIVE'
        ? 'TENTATIVE'
        : 'DECLINED';

    return {
      member_id: a.member_id,
      first_name: member?.first_name ?? '',
      last_name: member?.last_name ?? '',
      response,
      rsvp_reason: rsvp?.rsvp_reason ?? null,
    };
  });
}
