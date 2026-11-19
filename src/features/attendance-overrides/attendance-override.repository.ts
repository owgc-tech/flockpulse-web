import { createClient } from '@supabase/supabase-js';
import type { AttendanceOverrideResult } from './attendance-override.types';

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

export async function callAdminOverrideAttendance(
  tenantId: string,
  eventId: string,
  memberId: string,
  attendanceStatus: 'ATTENDED' | 'DID_NOT_ATTEND',
  adminMemberId: string,
  reason: string
): Promise<AttendanceOverrideResult> {
  const { data, error } = await serviceClient().rpc('admin_override_attendance', {
    p_tenant_id: tenantId,
    p_event_id: eventId,
    p_member_id: memberId,
    p_attendance_status: attendanceStatus,
    p_admin_member_id: adminMemberId,
    p_reason: reason,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    attendance_id: row.attendance_id,
    version: row.version,
    confirmed_at: row.confirmed_at,
  };
}
