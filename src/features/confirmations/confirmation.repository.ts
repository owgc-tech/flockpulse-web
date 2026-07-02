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
      members!member_id ( first_name, last_name ),
      rsvps ( rsvp_status, rsvp_reason )
    `)
    .eq('tenant_id', tenantId)
    .eq('confirmation_status', 'PENDING_CONFIRMATION');

  if (memberIdFilter !== null) {
    if (memberIdFilter.length === 0) return [];
    query = query.in('member_id', memberIdFilter);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => {
    const member = row['members'] as { first_name: string; last_name: string } | null;
    const rsvp = Array.isArray(row['rsvps'])
      ? (row['rsvps'][0] as { rsvp_status: string; rsvp_reason: string | null } | undefined)
      : (row['rsvps'] as { rsvp_status: string; rsvp_reason: string | null } | null);

    return {
      self_report_id: row['id'] as string,
      event_id: row['event_id'] as string,
      member_id: row['member_id'] as string,
      member_first_name: member?.first_name ?? '',
      member_last_name: member?.last_name ?? '',
      self_report_status: row['self_report_status'] as string,
      feedback: row['feedback'] as string | null,
      star_rating: row['star_rating'] as number | null,
      submitted_at: row['submitted_at'] as string,
      rsvp_status: rsvp?.rsvp_status ?? null,
      rsvp_reason: rsvp?.rsvp_reason ?? null,
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
