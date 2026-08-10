import { createClient } from '@supabase/supabase-js';
import { getGroupMembers } from '@/src/features/assignments/service';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';

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
  // DIP-FP-189-web: sum of guest_count across this event's Yes/Tentative rows
  // in the current result set — a clearly separate field, never blended into
  // the member counts above.
  total_guests: number;
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
    .select('event_id, member_id, rsvp_status, guest_count')
    .eq('tenant_id', tenantId)
    .in('event_id', eventIds)
    .in('member_id', memberIds);

  if (rsvpError) throw rsvpError;

  const rsvpMap = new Map<string, { rsvp_status: string; guest_count: number | null }>();
  for (const r of (rsvps ?? []) as { event_id: string; member_id: string; rsvp_status: string; guest_count: number | null }[]) {
    rsvpMap.set(`${r.event_id}:${r.member_id}`, { rsvp_status: r.rsvp_status, guest_count: r.guest_count });
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
        total_guests: 0,
      };
      summaryByEvent.set(eventId, summary);
    }

    const rsvp = rsvpMap.get(`${eventId}:${memberId}`);
    const status = rsvp?.rsvp_status;
    if (status === 'YES') summary.yes_count += 1;
    else if (status === 'NO') summary.no_count += 1;
    else if (status === 'TENTATIVE') summary.tentative_count += 1;
    else summary.no_response_count += 1;

    if ((status === 'YES' || status === 'TENTATIVE') && rsvp?.guest_count) {
      summary.total_guests += rsvp.guest_count;
    }
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

// ── Shared attendance-percentage fetcher (FP-129 / FP-130) ──────────────

interface EligibleAttendanceFilters {
  eventTypeIds?: string[];
  dateFrom?: string;
  dateTo?: string;
  memberIdFilter?: string[] | null;
}

interface EligibleAttendanceRow {
  event_id: string;
  member_id: string;
  start_datetime: string;
  attendance_status: 'ATTENDED' | 'DID_NOT_ATTEND' | null;
}

// Shared raw fetcher behind FP-129's yearly matrix and FP-130's date-range
// percentage report — both need the same official-attendance-only numerator
// (attendance.attendance_status) against the event_attendees expected-slot
// denominator, restricted to events that have actually concluded. Uses the
// bulk get_events_effective_statuses() RPC (service_role-only) rather than
// N calls to the per-event get_event_effective_status().
//
// A member-event slot with no attendance row yet — COMPLETED but not yet
// LOCKED, member not yet confirmed — comes back with attendance_status:
// null. Per the DIP's Grounding Check, this is a genuine "pending" state:
// callers must exclude it from both numerator and denominator rather than
// forcing it into either bucket. It self-corrects once the event reaches
// LOCKED, where no_self_report_auto has already resolved every remaining
// slot to DID_NOT_ATTEND.
async function getEligibleAttendanceRows(
  tenantId: string,
  filters: EligibleAttendanceFilters
): Promise<EligibleAttendanceRow[]> {
  const db = serviceClient();

  let eventQuery = db
    .from('events')
    .select('id, start_datetime')
    .eq('tenant_id', tenantId);

  if (filters.eventTypeIds && filters.eventTypeIds.length > 0) {
    eventQuery = eventQuery.in('event_type_id', filters.eventTypeIds);
  }
  if (filters.dateFrom) eventQuery = eventQuery.gte('start_datetime', filters.dateFrom);
  if (filters.dateTo) eventQuery = eventQuery.lte('start_datetime', filters.dateTo);

  const { data: eventRows, error: eventError } = await eventQuery;
  if (eventError) throw eventError;
  if (!eventRows || eventRows.length === 0) return [];

  const candidateEvents = eventRows as { id: string; start_datetime: string }[];
  const candidateEventIds = candidateEvents.map((e) => e.id);

  const { data: statusRows, error: statusError } = await db.rpc('get_events_effective_statuses', {
    p_tenant_id: tenantId,
    p_event_ids: candidateEventIds,
  });
  if (statusError) throw statusError;

  const eligibleEventIds = ((statusRows ?? []) as { event_id: string; effective_status: string }[])
    .filter((r) => r.effective_status === 'COMPLETED' || r.effective_status === 'LOCKED')
    .map((r) => r.event_id);
  if (eligibleEventIds.length === 0) return [];

  const startDatetimeByEvent = new Map<string, string>();
  for (const e of candidateEvents) startDatetimeByEvent.set(e.id, e.start_datetime);

  let attendeeQuery = db
    .from('event_attendees')
    .select('event_id, member_id')
    .eq('tenant_id', tenantId)
    .in('event_id', eligibleEventIds);

  if (filters.memberIdFilter) attendeeQuery = attendeeQuery.in('member_id', filters.memberIdFilter);

  const { data: attendeeRows, error: attendeeError } = await attendeeQuery;
  if (attendeeError) throw attendeeError;
  if (!attendeeRows || attendeeRows.length === 0) return [];

  const slots = attendeeRows as { event_id: string; member_id: string }[];
  const slotEventIds = [...new Set(slots.map((s) => s.event_id))];
  const slotMemberIds = [...new Set(slots.map((s) => s.member_id))];

  const { data: attendanceRows, error: attendanceError } = await db
    .from('attendance')
    .select('event_id, member_id, attendance_status')
    .eq('tenant_id', tenantId)
    .in('event_id', slotEventIds)
    .in('member_id', slotMemberIds);
  if (attendanceError) throw attendanceError;

  const attendanceMap = new Map<string, 'ATTENDED' | 'DID_NOT_ATTEND'>();
  for (const r of (attendanceRows ?? []) as { event_id: string; member_id: string; attendance_status: 'ATTENDED' | 'DID_NOT_ATTEND' }[]) {
    attendanceMap.set(`${r.event_id}:${r.member_id}`, r.attendance_status);
  }

  return slots.map((slot) => ({
    event_id: slot.event_id,
    member_id: slot.member_id,
    start_datetime: startDatetimeByEvent.get(slot.event_id) ?? '',
    attendance_status: attendanceMap.get(`${slot.event_id}:${slot.member_id}`) ?? null,
  }));
}

function roundToOneDecimal(present: number, absent: number): number | null {
  const total = present + absent;
  if (total === 0) return null;
  return Math.round((present / total) * 1000) / 10;
}

// ── FP-129: yearly attendance matrix by event type ───────────────────────

export interface AttendanceMatrixFilters {
  eventTypeIds: string[];
  leaderScopedMemberIds?: string[] | null;
}

export interface AttendanceMatrixCell {
  year: number;
  present: number;
  absent: number;
  percent: number | null;
}

export interface AttendanceMatrixRow {
  member_id: string;
  first_name: string;
  last_name: string;
  years: AttendanceMatrixCell[];
}

export interface AttendanceMatrixResult {
  years: number[];
  rows: AttendanceMatrixRow[];
}

// Whole-history fetch (no date bounds) grouped by member x
// EXTRACT(year FROM start_datetime), computed in JS. Years are whatever's
// actually present in the data, not a hardcoded range — pre-adoption years
// are simply absent from the result, not synthesized as empty columns.
export async function getAttendanceMatrixByEventType(
  tenantId: string,
  filters: AttendanceMatrixFilters
): Promise<AttendanceMatrixResult> {
  const memberIdFilter = await resolveMemberIdFilter(
    tenantId, undefined, undefined, filters.leaderScopedMemberIds
  );
  if (memberIdFilter !== null && memberIdFilter.length === 0) return { years: [], rows: [] };

  const eligibleRows = await getEligibleAttendanceRows(tenantId, {
    eventTypeIds: filters.eventTypeIds,
    memberIdFilter,
  });
  if (eligibleRows.length === 0) return { years: [], rows: [] };

  const memberIds = [...new Set(eligibleRows.map((r) => r.member_id))];

  const db = serviceClient();
  const { data: memberRows, error: memberError } = await db
    .from('members')
    .select('id, first_name, last_name')
    .eq('tenant_id', tenantId)
    .in('id', memberIds);
  if (memberError) throw memberError;

  const memberInfo = new Map<string, { first_name: string; last_name: string }>();
  for (const m of (memberRows ?? []) as { id: string; first_name: string; last_name: string }[]) {
    memberInfo.set(m.id, { first_name: m.first_name, last_name: m.last_name });
  }

  const yearsSet = new Set<number>();
  const cellMap = new Map<string, Map<number, { present: number; absent: number }>>();

  for (const row of eligibleRows) {
    if (row.attendance_status === null) continue; // pending slot — excluded per Grounding Check
    const year = new Date(row.start_datetime).getFullYear();
    yearsSet.add(year);

    let memberYears = cellMap.get(row.member_id);
    if (!memberYears) {
      memberYears = new Map();
      cellMap.set(row.member_id, memberYears);
    }
    let cell = memberYears.get(year);
    if (!cell) {
      cell = { present: 0, absent: 0 };
      memberYears.set(year, cell);
    }
    if (row.attendance_status === 'ATTENDED') cell.present += 1;
    else cell.absent += 1;
  }

  const years = [...yearsSet].sort((a, b) => a - b);

  const rows: AttendanceMatrixRow[] = memberIds.map((memberId) => {
    const info = memberInfo.get(memberId);
    const memberYears = cellMap.get(memberId);
    return {
      member_id: memberId,
      first_name: info?.first_name ?? '',
      last_name: info?.last_name ?? '',
      years: years.map((year) => {
        const cell = memberYears?.get(year);
        return {
          year,
          present: cell?.present ?? 0,
          absent: cell?.absent ?? 0,
          percent: cell ? roundToOneDecimal(cell.present, cell.absent) : null,
        };
      }),
    };
  });

  return { years, rows };
}

// ── FP-130: date-range attendance percentage ─────────────────────────────

export type AttendanceGranularity = 'MEMBER' | 'GROUP' | 'COMMUNITY';

export interface AttendancePercentageFilters {
  eventTypeIds?: string[];
  dateFrom: string;
  dateTo: string;
  granularity: AttendanceGranularity;
  leaderScopedMemberIds?: string[] | null;
  groups?: { id: string; name: string }[];
  communityName?: string;
}

export interface AttendancePercentageRow {
  key: string;
  label: string;
  present: number;
  absent: number;
  percent: number | null;
}

// MEMBER: one row per member. GROUP: sums present/absent across each
// group's members first, then computes percent from the sums (weighted,
// not averaged, per FP-130's explicit AC). COMMUNITY: single aggregate row
// across every scoped member. Leader-tier callers never reach the COMMUNITY
// branch — report.service.ts rejects it before this function is called.
export async function getAttendancePercentage(
  tenantId: string,
  filters: AttendancePercentageFilters
): Promise<AttendancePercentageRow[]> {
  const memberIdFilter = await resolveMemberIdFilter(
    tenantId, undefined, undefined, filters.leaderScopedMemberIds
  );
  if (memberIdFilter !== null && memberIdFilter.length === 0) return [];

  const eligibleRows = await getEligibleAttendanceRows(tenantId, {
    eventTypeIds: filters.eventTypeIds,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    memberIdFilter,
  });

  const resolvedRows = eligibleRows.filter((r) => r.attendance_status !== null);

  if (filters.granularity === 'MEMBER') {
    if (resolvedRows.length === 0) return [];

    const memberIds = [...new Set(resolvedRows.map((r) => r.member_id))];
    const db = serviceClient();
    const { data: memberRows, error: memberError } = await db
      .from('members')
      .select('id, first_name, last_name')
      .eq('tenant_id', tenantId)
      .in('id', memberIds);
    if (memberError) throw memberError;

    const nameMap = new Map<string, string>();
    for (const m of (memberRows ?? []) as { id: string; first_name: string; last_name: string }[]) {
      nameMap.set(m.id, `${m.first_name} ${m.last_name}`.trim());
    }

    const byMember = new Map<string, { present: number; absent: number }>();
    for (const r of resolvedRows) {
      let c = byMember.get(r.member_id);
      if (!c) {
        c = { present: 0, absent: 0 };
        byMember.set(r.member_id, c);
      }
      if (r.attendance_status === 'ATTENDED') c.present += 1;
      else c.absent += 1;
    }

    return [...byMember.entries()].map(([memberId, c]) => ({
      key: memberId,
      label: nameMap.get(memberId) ?? '',
      present: c.present,
      absent: c.absent,
      percent: roundToOneDecimal(c.present, c.absent),
    }));
  }

  if (filters.granularity === 'GROUP') {
    const groups = filters.groups ?? [];
    const rows: AttendancePercentageRow[] = [];

    for (const group of groups) {
      const groupMembers = await getGroupMembers(group.id, tenantId);
      const groupMemberIds = new Set(groupMembers.map((m) => (m as unknown as { id: string }).id));

      let present = 0;
      let absent = 0;
      for (const r of resolvedRows) {
        if (!groupMemberIds.has(r.member_id)) continue;
        if (r.attendance_status === 'ATTENDED') present += 1;
        else absent += 1;
      }

      rows.push({
        key: group.id,
        label: group.name,
        present,
        absent,
        percent: roundToOneDecimal(present, absent),
      });
    }

    return rows;
  }

  // COMMUNITY
  let present = 0;
  let absent = 0;
  for (const r of resolvedRows) {
    if (r.attendance_status === 'ATTENDED') present += 1;
    else absent += 1;
  }

  return [{
    key: 'community',
    label: filters.communityName ?? 'Community',
    present,
    absent,
    percent: roundToOneDecimal(present, absent),
  }];
}

// ── DIP-FP-182-web: mobile Dashboard tab ─────────────────────────────────
//
// Visibility is Admin-tier vs. everyone-else, not Admin/Leader/Member —
// "invited to an event" (event_attendees) is a personal fact, not something
// Leader-tier inherently has more of. getVisibleEventIds() mirrors
// resolveMemberIdFilter()'s null = "unrestricted" / array = "intersect with
// this" convention, keyed on event_id membership instead of member_id
// membership.

// null for Admin-tier (unrestricted); otherwise the caller's own
// event_attendees.event_id list — the same "invited to" pattern
// events/service.ts's listEventsForMember() already uses for the mobile "My
// Events" tab.
export async function getVisibleEventIds(tenantId: string, memberId: string, role: Role): Promise<string[] | null> {
  if (isAdminTier(role)) return null;

  const db = serviceClient();
  const { data, error } = await db
    .from('event_attendees')
    .select('event_id')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId);

  if (error) throw error;
  return [...new Set((data ?? []).map((r: { event_id: string }) => r.event_id))];
}

export interface DashboardEventType {
  id: string;
  name: string;
}

// Admin-tier: every active event type tenant-wide. Everyone else: only
// types with at least one event in the caller's visible-event-id set —
// avoids a dropdown entry with nothing selectable behind it.
export async function getDashboardEventTypes(
  tenantId: string, memberId: string, role: Role
): Promise<DashboardEventType[]> {
  const db = serviceClient();

  if (isAdminTier(role)) {
    const { data, error } = await db
      .from('event_types')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []) as DashboardEventType[];
  }

  const visibleEventIds = await getVisibleEventIds(tenantId, memberId, role);
  if (!visibleEventIds || visibleEventIds.length === 0) return [];

  const { data: eventRows, error: eventError } = await db
    .from('events')
    .select('event_type_id')
    .eq('tenant_id', tenantId)
    .in('id', visibleEventIds);
  if (eventError) throw eventError;

  const typeIds = [...new Set((eventRows ?? []).map((r: { event_type_id: string }) => r.event_type_id))];
  if (typeIds.length === 0) return [];

  const { data: typeRows, error: typeError } = await db
    .from('event_types')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .in('id', typeIds)
    .order('name', { ascending: true });
  if (typeError) throw typeError;
  return (typeRows ?? []) as DashboardEventType[];
}

export interface DashboardEventOption {
  id: string;
  name: string;
  start_datetime: string;
}

// Every event of the given type, current calendar year, already started
// (start_datetime <= now — "all [X] of the current year", generalized off
// the original story's literal wording), intersected with visibility for
// non-Admin, most recent first.
export async function getDashboardEventsForType(
  tenantId: string, memberId: string, role: Role, eventTypeId: string
): Promise<DashboardEventOption[]> {
  const visibleEventIds = await getVisibleEventIds(tenantId, memberId, role);
  if (visibleEventIds !== null && visibleEventIds.length === 0) return [];

  const now = new Date();
  const yearStart = new Date(Date.UTC(now.getFullYear(), 0, 1)).toISOString();

  const db = serviceClient();
  let q = db
    .from('events')
    .select('id, name, start_datetime')
    .eq('tenant_id', tenantId)
    .eq('event_type_id', eventTypeId)
    .gte('start_datetime', yearStart)
    .lte('start_datetime', now.toISOString())
    .order('start_datetime', { ascending: false });

  if (visibleEventIds !== null) q = q.in('id', visibleEventIds);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as DashboardEventOption[];
}

export interface DefaultDashboardEvent {
  event_type: { id: string; name: string };
  event: DashboardEventOption;
}

// The single most recent already-held event across every type, intersected
// with visibility — no year restriction (unlike getDashboardEventsForType;
// Joseph's own wording for the default was "the latest event the user is
// allowed to see," with no year qualifier). Backs the landing state before
// any manual type/event selection.
export async function getDefaultDashboardEvent(
  tenantId: string, memberId: string, role: Role
): Promise<DefaultDashboardEvent | null> {
  const visibleEventIds = await getVisibleEventIds(tenantId, memberId, role);
  if (visibleEventIds !== null && visibleEventIds.length === 0) return null;

  const db = serviceClient();
  let q = db
    .from('events')
    .select('id, name, start_datetime, event_type_id, event_types(id, name)')
    .eq('tenant_id', tenantId)
    .lte('start_datetime', new Date().toISOString())
    .order('start_datetime', { ascending: false })
    .limit(1);

  if (visibleEventIds !== null) q = q.in('id', visibleEventIds);

  const { data, error } = await q;
  if (error) throw error;
  if (!data || data.length === 0) return null;

  const row = data[0] as {
    id: string; name: string; start_datetime: string; event_type_id: string;
    event_types: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const eventType = Array.isArray(row.event_types) ? row.event_types[0] : row.event_types;

  return {
    event_type: { id: eventType?.id ?? row.event_type_id, name: eventType?.name ?? '' },
    event: { id: row.id, name: row.name, start_datetime: row.start_datetime },
  };
}

export interface DashboardStatsResult {
  attendance?: {
    expected_count: number;
    attended_count: number;
    did_not_attend_count: number;
    did_not_self_report_count: number;
    percent: number | null;
  };
  rsvp?: { yes_count: number; no_count: number; tentative_count: number; no_response_count: number };
  rating?: {
    average: number | null;
    rounded: number | null;
    rating_count: number;
    breakdown: { star: number; count: number }[];
    feedback: { star_rating: number | null; feedback: string }[];
  };
  // DIP-FP-197-web: Announcement-type events have no attendance/rsvp/rating
  // data (FP-191's design routes them through announcement_acknowledgements
  // instead) — present only for Announcement events, mirroring
  // getAnnouncementRoster()'s event_attendees + announcement_acknowledgements
  // join, aggregated to counts instead of a per-member roster.
  announcement?: {
    acknowledged_count: number;
    not_acknowledged_count: number;
    total_count: number;
    percent: number | null;
  };
}

// Scoped to a single event_id — once resolved, the three-card computation
// doesn't need to know or care what event type it is; only the dropdown-
// listing and default-resolution functions above are type/visibility-aware.
//
// Feedback anonymization: the feedback query's SELECT list below never
// includes member_id or any joined member field — feedback text comes back
// with no way to trace it to who submitted it.
//
// Round-half-up via Math.round() for rating.rounded, matching the
// convention used elsewhere in this file.
export async function getDashboardStats(
  tenantId: string, memberId: string, role: Role, eventId: string
): Promise<DashboardStatsResult> {
  const db = serviceClient();

  const { data: eventRow, error: eventError } = await db
    .from('events')
    .select('id, event_types(system_key)')
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (eventError) throw eventError;
  if (!eventRow) {
    const err = new Error('Event not found for this tenant') as Error & { code: string };
    err.code = 'NOT_FOUND_IN_TENANT';
    throw err;
  }

  // DIP-FP-197-web: same event_types.system_key === 'ANNOUNCEMENT' check
  // insert_event_with_audit()'s v_is_announcement uses server-side — reused
  // here for the branch decision below.
  const eventTypeRow = eventRow as { id: string; event_types: { system_key: string | null } | { system_key: string | null }[] | null };
  const eventTypeJoin = Array.isArray(eventTypeRow.event_types) ? eventTypeRow.event_types[0] : eventTypeRow.event_types;
  const isAnnouncement = eventTypeJoin?.system_key === 'ANNOUNCEMENT';

  if (!isAdminTier(role)) {
    const { data: attendeeRow, error: attendeeError } = await db
      .from('event_attendees')
      .select('id')
      .eq('event_id', eventId)
      .eq('member_id', memberId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (attendeeError) throw attendeeError;
    if (!attendeeRow) {
      const err = new Error('You are not invited to this event') as Error & { code: string };
      err.code = 'FORBIDDEN_SCOPE';
      throw err;
    }
  }

  // DIP-FP-197-web: Announcement events skip the attendance/rsvp/rating
  // queries entirely (both are always empty for them, per FP-191's design —
  // acknowledgement is a genuinely separate mechanism, never a write to
  // attendance/rsvps) and return early with the acknowledgement summary
  // instead, mirroring getAnnouncementRoster()'s exact event_attendees +
  // announcement_acknowledgements join, aggregated to counts.
  if (isAnnouncement) {
    const { data: announcementAttendeeRows, error: announcementAttendeeError } = await db
      .from('event_attendees')
      .select('member_id')
      .eq('event_id', eventId)
      .eq('tenant_id', tenantId);
    if (announcementAttendeeError) throw announcementAttendeeError;
    const targetedMemberIds = (announcementAttendeeRows ?? []).map((r: { member_id: string }) => r.member_id);

    const { data: ackRows, error: ackError } = await db
      .from('announcement_acknowledgements')
      .select('member_id, acknowledged_at')
      .eq('event_id', eventId)
      .eq('tenant_id', tenantId);
    if (ackError) throw ackError;
    const ackByMember = new Map(
      (ackRows ?? []).map((a: { member_id: string; acknowledged_at: string }) => [a.member_id, a.acknowledged_at])
    );

    const acknowledgedCount = targetedMemberIds.filter((id) => ackByMember.has(id)).length;
    const totalCount = targetedMemberIds.length;
    const notAcknowledgedCount = totalCount - acknowledgedCount;

    return {
      announcement: {
        acknowledged_count: acknowledgedCount,
        not_acknowledged_count: notAcknowledgedCount,
        total_count: totalCount,
        percent: roundToOneDecimal(acknowledgedCount, notAcknowledgedCount),
      },
    };
  }

  // Card 1: attendance — expected_count from the roster; attended_count/
  // did_not_attend_count from attendance.attendance_status;
  // did_not_self_report_count is every roster member with no attendance row
  // at all yet (attended or not) — DIP-FP-182-web-adj-1's addition of the two
  // missing buckets.
  const { data: attendeeRows, error: attendeeCountError } = await db
    .from('event_attendees')
    .select('member_id')
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId);
  if (attendeeCountError) throw attendeeCountError;
  const rosterMemberIds = (attendeeRows ?? []).map((r: { member_id: string }) => r.member_id);
  const expectedCount = rosterMemberIds.length;

  const { data: attendanceRows, error: attendanceError } = await db
    .from('attendance')
    .select('member_id, attendance_status')
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId);
  if (attendanceError) throw attendanceError;
  const typedAttendanceRows = (attendanceRows ?? []) as { member_id: string; attendance_status: string }[];
  const attendedCount = typedAttendanceRows.filter((r) => r.attendance_status === 'ATTENDED').length;
  const didNotAttendCount = typedAttendanceRows.filter((r) => r.attendance_status === 'DID_NOT_ATTEND').length;
  const respondedMemberIds = new Set(typedAttendanceRows.map((r) => r.member_id));
  const didNotSelfReportCount = rosterMemberIds.filter((id) => !respondedMemberIds.has(id)).length;

  // Card 2: RSVP — per-attendee join (not a subtraction), mirroring
  // getRsvpReportSummary()'s existing map+loop pattern exactly.
  // rsvps/attendance are "keyed independently" of event_attendees (per
  // 20260719000050_resync_event_attendees_on_target_edit.sql's own comment)
  // — a member removed from the roster during a resync keeps their old rsvp
  // row, which a subtraction-based count can't account for. Driving the
  // loop off the roster (not off the rsvps rows) means a stale rsvp for a
  // member no longer on the roster is simply never visited.
  const { data: rsvpRows, error: rsvpError } = await db
    .from('rsvps')
    .select('member_id, rsvp_status')
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId);
  if (rsvpError) throw rsvpError;

  const rsvpByMember = new Map<string, string>();
  for (const r of (rsvpRows ?? []) as { member_id: string; rsvp_status: string }[]) {
    rsvpByMember.set(r.member_id, r.rsvp_status);
  }

  let yesCount = 0, noCount = 0, tentativeCount = 0, noResponseCount = 0;
  for (const id of rosterMemberIds) {
    const status = rsvpByMember.get(id);
    if (status === 'YES') yesCount += 1;
    else if (status === 'NO') noCount += 1;
    else if (status === 'TENTATIVE') tentativeCount += 1;
    else noResponseCount += 1;
  }

  // Card 3: rating + feedback — anonymized (see doc comment above). SELECT
  // list is still exactly star_rating, feedback — no member_id, no join to
  // members. average is the raw mean; rounded is Math.round(average) —
  // split so mobile can choose which to display, per DIP-FP-182-web-adj-1.
  const { data: ratingRows, error: ratingError } = await db
    .from('member_attendance_reports')
    .select('star_rating, feedback')
    .eq('event_id', eventId)
    .eq('tenant_id', tenantId)
    .eq('self_report_status', 'SELF_REPORTED_YES');
  if (ratingError) throw ratingError;

  const typedRatingRows = (ratingRows ?? []) as { star_rating: number | null; feedback: string | null }[];
  const ratings = typedRatingRows.map((r) => r.star_rating).filter((r): r is number => r !== null);
  const averageRating = ratings.length > 0
    ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length
    : null;
  const roundedRating = averageRating !== null ? Math.round(averageRating) : null;
  // DIP-FP-182-web-adj-2: count-by-value over the same `ratings` array
  // already computed above — no new query. All five star values always
  // present, 5 down to 1, even at count 0 (needed for the bar-graph's
  // fixed five-row scale, not just the stars that got at least one rating).
  const breakdown = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: ratings.filter((r) => r === star).length,
  }));
  const feedback = typedRatingRows
    .filter((r): r is { star_rating: number | null; feedback: string } => !!r.feedback && r.feedback.trim().length > 0)
    .map((r) => ({ star_rating: r.star_rating, feedback: r.feedback }));

  return {
    attendance: {
      expected_count: expectedCount,
      attended_count: attendedCount,
      did_not_attend_count: didNotAttendCount,
      did_not_self_report_count: didNotSelfReportCount,
      percent: roundToOneDecimal(attendedCount, expectedCount - attendedCount),
    },
    rsvp: {
      yes_count: yesCount,
      no_count: noCount,
      tentative_count: tentativeCount,
      no_response_count: noResponseCount,
    },
    rating: {
      average: averageRating,
      rounded: roundedRating,
      rating_count: ratings.length,
      breakdown,
      feedback,
    },
  };
}
