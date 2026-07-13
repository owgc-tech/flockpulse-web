import { createClient } from '@supabase/supabase-js';
import type { PendingConfirmationRow, ConfirmationResult } from './confirmation.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function getAssignedMemberIds(
  tenantId: string,
  leaderMemberId: string
): Promise<string[]> {
  const { data } = await serviceClient()
    .from('assignments')
    .select('member_id')
    .eq('tenant_id', tenantId)
    .eq('leader_member_id', leaderMemberId)
    .eq('assignment_type', 'LEADER')
    .is('deleted_at', null);

  return (data ?? []).map((row: { member_id: string }) => row.member_id);
}

export async function getPendingConfirmations(
  tenantId: string,
  memberIdFilter: string[] | null
): Promise<PendingConfirmationRow[]> {
  if (memberIdFilter !== null && memberIdFilter.length === 0) return [];

  // Fetch self-reports with member name via FK embed (members!member_id resolves correctly).
  // rsvps cannot be embedded here — PostgREST requires a direct FK between the two tables,
  // and none exists between member_attendance_reports and rsvps. Fetched separately below.
  let query = serviceClient()
    .from('member_attendance_reports')
    .select(`
      id,
      event_id,
      member_id,
      self_report_status,
      feedback,
      star_rating,
      submitted_at,
      members!member_id ( first_name, last_name )
    `)
    .eq('tenant_id', tenantId)
    .eq('confirmation_status', 'PENDING_CONFIRMATION');

  if (memberIdFilter !== null) {
    query = query.in('member_id', memberIdFilter);
  }

  const { data, error } = await query;
  if (error) throw error;
  if (!data || data.length === 0) return [];

  // Collect the (event_id, member_id) pairs we need RSVPs for and fetch in one query.
  const rows = data as Record<string, unknown>[];
  const memberIds = rows.map(r => r['member_id'] as string);
  const eventIds  = [...new Set(rows.map(r => r['event_id'] as string))];

  const { data: rsvpData, error: rsvpError } = await serviceClient()
    .from('rsvps')
    .select('event_id, member_id, rsvp_status, rsvp_reason')
    .eq('tenant_id', tenantId)
    .in('event_id', eventIds)
    .in('member_id', memberIds);

  if (rsvpError) throw rsvpError;

  // Index RSVPs by "eventId:memberId" for O(1) lookup.
  const rsvpMap = new Map<string, { rsvp_status: string; rsvp_reason: string | null }>();
  for (const r of (rsvpData ?? []) as { event_id: string; member_id: string; rsvp_status: string; rsvp_reason: string | null }[]) {
    rsvpMap.set(`${r.event_id}:${r.member_id}`, { rsvp_status: r.rsvp_status, rsvp_reason: r.rsvp_reason });
  }

  // DIP-FP-99-adj-1: PendingConfirmationRow never carried event info before
  // this — only event_id — even though eventIds (above) was already
  // collected for the RSVP fetch. Joined in here the same tenant-scoped way
  // as every other query in this function.
  const { data: eventData, error: eventError } = await serviceClient()
    .from('events')
    .select('id, name, start_datetime, end_datetime, location_name')
    .eq('tenant_id', tenantId)
    .in('id', eventIds);

  if (eventError) throw eventError;

  const eventMap = new Map<string, { name: string; start_datetime: string; end_datetime: string; location_name: string }>();
  for (const e of (eventData ?? []) as { id: string; name: string; start_datetime: string; end_datetime: string; location_name: string }[]) {
    eventMap.set(e.id, e);
  }

  return rows.map(row => {
    const member = row['members'] as { first_name: string; last_name: string } | null;
    const rsvp   = rsvpMap.get(`${row['event_id']}:${row['member_id']}`);
    const event  = eventMap.get(row['event_id'] as string);

    return {
      self_report_id:    row['id'] as string,
      event_id:          row['event_id'] as string,
      event_name:            event?.name ?? '',
      event_start_datetime:  event?.start_datetime ?? '',
      event_end_datetime:    event?.end_datetime ?? '',
      event_location_name:   event?.location_name ?? '',
      member_id:         row['member_id'] as string,
      member_first_name: member?.first_name ?? '',
      member_last_name:  member?.last_name  ?? '',
      self_report_status: row['self_report_status'] as string,
      feedback:          row['feedback']   as string | null,
      star_rating:       row['star_rating'] as number | null,
      submitted_at:      row['submitted_at'] as string,
      rsvp_status:       rsvp?.rsvp_status  ?? null,
      rsvp_reason:       rsvp?.rsvp_reason  ?? null,
    };
  });
}

export async function getSelfReportForConfirmation(
  tenantId: string,
  selfReportId: string
): Promise<{ event_id: string; member_id: string; confirmation_status: string } | null> {
  const { data } = await serviceClient()
    .from('member_attendance_reports')
    .select('event_id, member_id, confirmation_status')
    .eq('id', selfReportId)
    .eq('tenant_id', tenantId)
    .single();

  return data ?? null;
}

export async function callResolveLeaderConfirmation(
  tenantId: string,
  selfReportId: string,
  leaderMemberId: string,
  decision: 'CONFIRM' | 'REJECT',
  leaderNote: string | null
): Promise<ConfirmationResult> {
  const { data, error } = await serviceClient().rpc('resolve_leader_confirmation', {
    p_tenant_id: tenantId,
    p_self_report_id: selfReportId,
    p_leader_member_id: leaderMemberId,
    p_decision: decision,
    p_leader_note: leaderNote,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    attendance_id: row.attendance_id,
    confirmation_status: row.confirmation_status,
    confirmed_at: row.confirmed_at,
  };
}
