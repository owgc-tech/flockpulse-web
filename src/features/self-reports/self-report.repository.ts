import { createClient } from '@supabase/supabase-js';
import { attachEffectiveStatus } from '@/src/features/events/service';
import type { SelfReportRow, PendingSelfReportRow } from './self-report.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function isExpectedAttendee(
  tenantId: string,
  eventId: string,
  memberId: string
): Promise<boolean> {
  const { count } = await serviceClient()
    .from('event_attendees')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('event_id', eventId)
    .eq('member_id', memberId);

  return (count ?? 0) > 0;
}

export async function checkBlockedByGuard(eventId: string): Promise<boolean> {
  const { data } = await serviceClient().rpc('block_actions_on_cancelled_or_locked', {
    p_event_id: eventId,
  });

  return data === true;
}

export async function getEventExistsForTenant(
  tenantId: string,
  eventId: string
): Promise<boolean> {
  const { count } = await serviceClient()
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('id', eventId)
    .eq('tenant_id', tenantId);

  return (count ?? 0) > 0;
}

export async function getEventEffectiveStatus(eventId: string): Promise<string | null> {
  const { data } = await serviceClient().rpc('get_event_effective_status', {
    p_event_id: eventId,
  });

  return data ?? null;
}

export async function getExistingSelfReport(
  tenantId: string,
  eventId: string,
  memberId: string
): Promise<boolean> {
  const { count } = await serviceClient()
    .from('member_attendance_reports')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('event_id', eventId)
    .eq('member_id', memberId);

  return (count ?? 0) > 0;
}

export async function insertSelfReportYes(
  tenantId: string,
  eventId: string,
  memberId: string,
  feedback: string | null,
  starRating: number | null
): Promise<SelfReportRow> {
  const { data, error } = await serviceClient().rpc('insert_self_report_yes_with_audit', {
    p_tenant_id: tenantId,
    p_event_id: eventId,
    p_member_id: memberId,
    p_feedback: feedback,
    p_star_rating: starRating,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return row as SelfReportRow;
}

export async function callSubmitSelfReportNo(
  tenantId: string,
  eventId: string,
  memberId: string,
  reason: string
): Promise<{ self_report_id: string; attendance_id: string; submitted_at: string }> {
  const { data, error } = await serviceClient().rpc('submit_self_report_no', {
    p_tenant_id: tenantId,
    p_event_id: eventId,
    p_member_id: memberId,
    p_reason: reason,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return row as { self_report_id: string; attendance_id: string; submitted_at: string };
}

// DIP-FP-119-web: mirrors listEventsForMember()'s event_attendees -> events ->
// attachEffectiveStatus() pattern (events/service.ts), then narrows to
// COMPLETED (excludes CANCELLED for free — see DIP Grounding Check) and
// bulk-excludes events this member has already self-reported for.
//
// DIP-FP-191-web: additionally unions in Announcement-type events (identified
// by the tenant's event_types row with system_key = 'ANNOUNCEMENT' — there is
// at most one) this member is an expected attendee of, whose effective status
// is COMPLETED or LOCKED (unlike the self-report half, LOCKED is included —
// acknowledging isn't gated by the same window self-reports are), and that
// this member hasn't already acknowledged (announcement_acknowledgements is a
// wholly separate table from member_attendance_reports — see migration
// 20260803000062's header comment for why that separation is non-negotiable).
export async function getPendingSelfReports(
  tenantId: string,
  memberId: string
): Promise<PendingSelfReportRow[]> {
  const db = serviceClient();

  const { data: attendeeRows, error: attendeeError } = await db
    .from('event_attendees')
    .select('event_id')
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId);

  if (attendeeError) throw attendeeError;

  const eventIds = (attendeeRows ?? []).map((r: { event_id: string }) => r.event_id);
  if (eventIds.length === 0) return [];

  const [{ data: events, error: eventsError }, { data: announcementType }] = await Promise.all([
    db
      .from('events')
      .select('id, name, status, start_datetime, end_datetime, location_name, event_type_id')
      .eq('tenant_id', tenantId)
      .in('id', eventIds),
    db
      .from('event_types')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('system_key', 'ANNOUNCEMENT')
      .maybeSingle(),
  ]);

  if (eventsError) throw eventsError;

  const announcementTypeId = announcementType?.id ?? null;
  const withEffectiveStatus = await attachEffectiveStatus(events ?? []);

  const completed = withEffectiveStatus.filter(
    (e) => e.effective_status === 'COMPLETED' && e.event_type_id !== announcementTypeId
  );
  const announcementCandidates = announcementTypeId
    ? withEffectiveStatus.filter(
        (e) => e.event_type_id === announcementTypeId && ['COMPLETED', 'LOCKED'].includes(e.effective_status)
      )
    : [];

  if (completed.length === 0 && announcementCandidates.length === 0) return [];

  let reportedEventIds = new Set<string>();
  if (completed.length > 0) {
    const { data: existingReports, error: reportsError } = await db
      .from('member_attendance_reports')
      .select('event_id')
      .eq('tenant_id', tenantId)
      .eq('member_id', memberId)
      .in('event_id', completed.map((e) => e.id));

    if (reportsError) throw reportsError;
    reportedEventIds = new Set((existingReports ?? []).map((r: { event_id: string }) => r.event_id));
  }

  let acknowledgedEventIds = new Set<string>();
  if (announcementCandidates.length > 0) {
    const { data: existingAcks, error: acksError } = await db
      .from('announcement_acknowledgements')
      .select('event_id')
      .eq('tenant_id', tenantId)
      .eq('member_id', memberId)
      .in('event_id', announcementCandidates.map((e) => e.id));

    if (acksError) throw acksError;
    acknowledgedEventIds = new Set((existingAcks ?? []).map((r: { event_id: string }) => r.event_id));
  }

  const selfReportRows: PendingSelfReportRow[] = completed
    .filter((e) => !reportedEventIds.has(e.id))
    .map((e) => ({
      kind: 'self_report',
      event_id: e.id,
      event_name: e.name,
      event_start_datetime: e.start_datetime,
      event_end_datetime: e.end_datetime,
      event_location_name: e.location_name,
    }));

  const announcementRows: PendingSelfReportRow[] = announcementCandidates
    .filter((e) => !acknowledgedEventIds.has(e.id))
    .map((e) => ({
      kind: 'announcement',
      event_id: e.id,
      event_name: e.name,
      event_start_datetime: e.start_datetime,
      event_end_datetime: e.end_datetime,
      event_location_name: e.location_name,
    }));

  return [...selfReportRows, ...announcementRows];
}

export async function getSelfReportById(id: string): Promise<SelfReportRow> {
  const { data, error } = await serviceClient()
    .from('member_attendance_reports')
    .select(
      'id, tenant_id, event_id, member_id, self_report_status, reason, feedback, star_rating, confirmation_status, submitted_at, created_at, updated_at'
    )
    .eq('id', id)
    .single();

  if (error) throw error;
  return data as SelfReportRow;
}
