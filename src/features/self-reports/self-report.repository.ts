import { createClient } from '@supabase/supabase-js';
import type { SelfReportRow } from './self-report.types';

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

export async function getEventStatus(
  tenantId: string,
  eventId: string
): Promise<{ status: string } | null> {
  const { data } = await serviceClient()
    .from('events')
    .select('status')
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .single();

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
  const { data, error } = await serviceClient()
    .from('member_attendance_reports')
    .insert({
      tenant_id: tenantId,
      event_id: eventId,
      member_id: memberId,
      self_report_status: 'SELF_REPORTED_YES',
      reason: null,
      feedback,
      star_rating: starRating,
      confirmation_status: 'PENDING_CONFIRMATION',
    })
    .select(
      'id, tenant_id, event_id, member_id, self_report_status, reason, feedback, star_rating, confirmation_status, submitted_at, created_at, updated_at'
    )
    .single();

  if (error) throw error;

  // TODO(EPIC-10): write audit_logs entry for self-report create once audit_logs table and
  // audit.service exist — see Engineering Spec §6.

  return data as SelfReportRow;
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
