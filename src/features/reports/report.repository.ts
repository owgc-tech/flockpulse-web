import { createClient } from '@supabase/supabase-js';
import { getGroupMembers } from '@/src/features/assignments/service';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// Intersects every provided member-id filter (group membership, RBAC leader
// scope, direct member selection) down to one effective allow-list. Returns
// null when no member-level filter applies (no restriction); returns [] when
// the intersection is empty (caller should short-circuit to no results).
async function resolveMemberIdFilter(
  tenantId: string,
  groupId: string | undefined,
  memberId: string | undefined,
  leaderScopedMemberIds: string[] | null | undefined
): Promise<string[] | null> {
  let filter: string[] | null = leaderScopedMemberIds ?? null;

  if (groupId) {
    const groupMembers = await getGroupMembers(groupId, tenantId);
    const groupMemberIds = groupMembers.map((m) => (m as unknown as { id: string }).id);
    filter = filter === null ? groupMemberIds : filter.filter((id) => groupMemberIds.includes(id));
  }

  if (memberId) {
    filter = filter === null ? [memberId] : filter.filter((id) => id === memberId);
  }

  return filter;
}

// ── RSVP report ──────────────────────────────────────────────────────────

export interface RsvpReportFilters {
  eventId?: string;
  groupId?: string;
  memberId?: string;
  leaderScopedMemberIds?: string[] | null;
}

export interface RsvpReportRow {
  event_id: string;
  event_name: string;
  event_start_datetime: string;
  member_id: string;
  first_name: string;
  last_name: string;
  rsvp_status: 'YES' | 'NO' | 'TENTATIVE' | 'NO_RESPONSE';
  rsvp_reason: string | null;
}

export async function getRsvpReport(
  tenantId: string,
  filters: RsvpReportFilters
): Promise<RsvpReportRow[]> {
  const memberIdFilter = await resolveMemberIdFilter(
    tenantId, filters.groupId, filters.memberId, filters.leaderScopedMemberIds
  );
  if (memberIdFilter !== null && memberIdFilter.length === 0) return [];

  const db = serviceClient();

  let attendeeQuery = db
    .from('event_attendees')
    .select('event_id, member_id, members(first_name, last_name), events(name, start_datetime)')
    .eq('tenant_id', tenantId);

  if (filters.eventId) attendeeQuery = attendeeQuery.eq('event_id', filters.eventId);
  if (memberIdFilter !== null) attendeeQuery = attendeeQuery.in('member_id', memberIdFilter);

  const { data: attendees, error: attendeeError } = await attendeeQuery;
  if (attendeeError) throw attendeeError;
  if (!attendees || attendees.length === 0) return [];

  const rows = attendees as Record<string, unknown>[];
  const eventIds = [...new Set(rows.map((r) => r.event_id as string))];
  const memberIds = [...new Set(rows.map((r) => r.member_id as string))];

  const { data: rsvps, error: rsvpError } = await db
    .from('rsvps')
    .select('event_id, member_id, rsvp_status, rsvp_reason')
    .eq('tenant_id', tenantId)
    .in('event_id', eventIds)
    .in('member_id', memberIds);

  if (rsvpError) throw rsvpError;

  const rsvpMap = new Map<string, { rsvp_status: string; rsvp_reason: string | null }>();
  for (const r of (rsvps ?? []) as { event_id: string; member_id: string; rsvp_status: string; rsvp_reason: string | null }[]) {
    rsvpMap.set(`${r.event_id}:${r.member_id}`, { rsvp_status: r.rsvp_status, rsvp_reason: r.rsvp_reason });
  }

  return rows.map((row) => {
    const member = (Array.isArray(row.members) ? row.members[0] : row.members) as { first_name: string; last_name: string } | null;
    const event = (Array.isArray(row.events) ? row.events[0] : row.events) as { name: string; start_datetime: string } | null;
    const eventId = row.event_id as string;
    const memberId = row.member_id as string;
    const rsvp = rsvpMap.get(`${eventId}:${memberId}`);

    return {
      event_id: eventId,
      event_name: event?.name ?? '',
      event_start_datetime: event?.start_datetime ?? '',
      member_id: memberId,
      first_name: member?.first_name ?? '',
      last_name: member?.last_name ?? '',
      rsvp_status: (rsvp?.rsvp_status as 'YES' | 'NO' | 'TENTATIVE' | undefined) ?? 'NO_RESPONSE',
      rsvp_reason: rsvp?.rsvp_status === 'NO' ? (rsvp?.rsvp_reason ?? null) : null,
    };
  });
}

export interface RsvpReportSummaryRow {
  event_id: string;
  event_name: string;
  event_start_datetime: string;
  yes_count: number;
  no_count: number;
  tentative_count: number;
  no_response_count: number;
}

// Per-event aggregate counts (FP-128) — same event_attendees ⋈ rsvps join as
// getRsvpReport, grouped by event instead of emitted as per-member detail rows.
// Counts reconcile to the event's event_attendees total (FP-128 AC).
export async function getRsvpReportSummary(
  tenantId: string,
  filters: RsvpReportFilters
): Promise<RsvpReportSummaryRow[]> {
  const memberIdFilter = await resolveMemberIdFilter(
    tenantId, filters.groupId, filters.memberId, filters.leaderScopedMemberIds
  );
  if (memberIdFilter !== null && memberIdFilter.length === 0) return [];

  const db = serviceClient();

  let attendeeQuery = db
    .from('event_attendees')
    .select('event_id, member_id, events(name, start_datetime)')
    .eq('tenant_id', tenantId);

  if (filters.eventId) attendeeQuery = attendeeQuery.eq('event_id', filters.eventId);
  if (memberIdFilter !== null) attendeeQuery = attendeeQuery.in('member_id', memberIdFilter);

  const { data: attendees, error: attendeeError } = await attendeeQuery;
  if (attendeeError) throw attendeeError;
  if (!attendees || attendees.length === 0) return [];

  const rows = attendees as Record<string, unknown>[];
  const eventIds = [...new Set(rows.map((r) => r.event_id as string))];
  const memberIds = [...new Set(rows.map((r) => r.member_id as string))];

  const { data: rsvps, error: rsvpError } = await db
    .from('rsvps')
    .select('event_id, member_id, rsvp_status')
    .eq('tenant_id', tenantId)
    .in('event_id', eventIds)
    .in('member_id', memberIds);

  if (rsvpError) throw rsvpError;

  const rsvpMap = new Map<string, string>();
  for (const r of (rsvps ?? []) as { event_id: string; member_id: string; rsvp_status: string }[]) {
    rsvpMap.set(`${r.event_id}:${r.member_id}`, r.rsvp_status);
  }

  const summaryByEvent = new Map<string, RsvpReportSummaryRow>();
  for (const row of rows) {
    const eventId = row.event_id as string;
    const memberId = row.member_id as string;
    const event = (Array.isArray(row.events) ? row.events[0] : row.events) as { name: string; start_datetime: string } | null;

    let summary = summaryByEvent.get(eventId);
    if (!summary) {
      summary = {
        event_id: eventId,
        event_name: event?.name ?? '',
        event_start_datetime: event?.start_datetime ?? '',
        yes_count: 0,
        no_count: 0,
        tentative_count: 0,
        no_response_count: 0,
      };
      summaryByEvent.set(eventId, summary);
    }

    const status = rsvpMap.get(`${eventId}:${memberId}`);
    if (status === 'YES') summary.yes_count += 1;
    else if (status === 'NO') summary.no_count += 1;
    else if (status === 'TENTATIVE') summary.tentative_count += 1;
    else summary.no_response_count += 1;
  }

  return [...summaryByEvent.values()];
}

// ── Attendance report ────────────────────────────────────────────────────

export interface AttendanceReportFilters {
  eventId?: string;
  groupId?: string;
  memberId?: string;
  dateFrom?: string;
  dateTo?: string;
  leaderScopedMemberIds?: string[] | null;
}

export type AttendanceReportStatus = 'ATTENDED' | 'DID_NOT_ATTEND' | 'PENDING_CONFIRMATION' | 'UNRESPONDED';

export interface AttendanceReportRow {
  event_id: string;
  event_name: string;
  event_start_datetime: string;
  member_id: string;
  first_name: string;
  last_name: string;
  self_report_status: 'SELF_REPORTED_YES' | 'SELF_REPORTED_NO' | null;
  attendance_status: 'ATTENDED' | 'DID_NOT_ATTEND' | null;
  status: AttendanceReportStatus;
}

// Four-state derivation per the DIP's Grounding Check: an `attendance` row
// (if any) always wins — it covers both leader-confirmed states and the
// auto-resolved-No path, which already writes `attendance` atomically at
// self-report time (see 20260629000008_self_reports_and_attendance.sql). A
// SELF_REPORTED_YES with no `attendance` row yet is awaiting leader
// confirmation. Anything else — no self-report and no attendance row — is a
// no-show-on-record, not just "no self-report yet".
export async function getAttendanceReport(
  tenantId: string,
  filters: AttendanceReportFilters
): Promise<AttendanceReportRow[]> {
  const memberIdFilter = await resolveMemberIdFilter(
    tenantId, filters.groupId, filters.memberId, filters.leaderScopedMemberIds
  );
  if (memberIdFilter !== null && memberIdFilter.length === 0) return [];

  const db = serviceClient();

  let eventIds: string[] | null = null;
  if (filters.eventId) {
    eventIds = [filters.eventId];
  } else if (filters.dateFrom || filters.dateTo) {
    let eventQuery = db.from('events').select('id').eq('tenant_id', tenantId);
    if (filters.dateFrom) eventQuery = eventQuery.gte('start_datetime', filters.dateFrom);
    if (filters.dateTo) eventQuery = eventQuery.lte('start_datetime', filters.dateTo);

    const { data: eventRows, error: eventError } = await eventQuery;
    if (eventError) throw eventError;
    eventIds = (eventRows ?? []).map((e: { id: string }) => e.id);
    if (eventIds.length === 0) return [];
  }

  let attendeeQuery = db
    .from('event_attendees')
    .select('event_id, member_id, members(first_name, last_name), events(name, start_datetime)')
    .eq('tenant_id', tenantId);

  if (eventIds !== null) attendeeQuery = attendeeQuery.in('event_id', eventIds);
  if (memberIdFilter !== null) attendeeQuery = attendeeQuery.in('member_id', memberIdFilter);

  const { data: attendees, error: attendeeError } = await attendeeQuery;
  if (attendeeError) throw attendeeError;
  if (!attendees || attendees.length === 0) return [];

  const rows = attendees as Record<string, unknown>[];
  const scopedEventIds = [...new Set(rows.map((r) => r.event_id as string))];
  const scopedMemberIds = [...new Set(rows.map((r) => r.member_id as string))];

  const [{ data: selfReports, error: selfReportError }, { data: attendanceRows, error: attendanceError }] = await Promise.all([
    db.from('member_attendance_reports')
      .select('event_id, member_id, self_report_status')
      .eq('tenant_id', tenantId)
      .in('event_id', scopedEventIds)
      .in('member_id', scopedMemberIds),
    db.from('attendance')
      .select('event_id, member_id, attendance_status')
      .eq('tenant_id', tenantId)
      .in('event_id', scopedEventIds)
      .in('member_id', scopedMemberIds),
  ]);

  if (selfReportError) throw selfReportError;
  if (attendanceError) throw attendanceError;

  const selfReportMap = new Map<string, string>();
  for (const r of (selfReports ?? []) as { event_id: string; member_id: string; self_report_status: string }[]) {
    selfReportMap.set(`${r.event_id}:${r.member_id}`, r.self_report_status);
  }

  const attendanceMap = new Map<string, string>();
  for (const r of (attendanceRows ?? []) as { event_id: string; member_id: string; attendance_status: string }[]) {
    attendanceMap.set(`${r.event_id}:${r.member_id}`, r.attendance_status);
  }

  return rows.map((row) => {
    const member = (Array.isArray(row.members) ? row.members[0] : row.members) as { first_name: string; last_name: string } | null;
    const event = (Array.isArray(row.events) ? row.events[0] : row.events) as { name: string; start_datetime: string } | null;
    const eventId = row.event_id as string;
    const memberId = row.member_id as string;
    const key = `${eventId}:${memberId}`;

    const attendanceStatus = attendanceMap.get(key) as 'ATTENDED' | 'DID_NOT_ATTEND' | undefined;
    const selfReportStatus = selfReportMap.get(key) as 'SELF_REPORTED_YES' | 'SELF_REPORTED_NO' | undefined;

    let status: AttendanceReportStatus;
    if (attendanceStatus) {
      status = attendanceStatus;
    } else if (selfReportStatus === 'SELF_REPORTED_YES') {
      status = 'PENDING_CONFIRMATION';
    } else {
      status = 'UNRESPONDED';
    }

    return {
      event_id: eventId,
      event_name: event?.name ?? '',
      event_start_datetime: event?.start_datetime ?? '',
      member_id: memberId,
      first_name: member?.first_name ?? '',
      last_name: member?.last_name ?? '',
      self_report_status: selfReportStatus ?? null,
      attendance_status: attendanceStatus ?? null,
      status,
    };
  });
}
