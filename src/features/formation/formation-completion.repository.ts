import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface ActiveTalkRow {
  id: string;
  module_id: string;
  name: string;
  sequence_order: number;
}

export interface ActiveModuleRow {
  id: string;
  course_id: string;
  name: string;
  sequence_order: number;
}

export interface AttendedRow {
  event_id: string;
  confirmed_at: string;
}

export interface EventTalkRow {
  id: string;
  talk_id: string;
}

export async function fetchActiveModulesForCourse(
  courseId: string, tenantId: string
): Promise<ActiveModuleRow[]> {
  const { data, error } = await serviceClient()
    .from('modules')
    .select('id, course_id, name, sequence_order')
    .eq('course_id', courseId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('sequence_order', { ascending: true });

  if (error) throw error;
  return (data ?? []) as ActiveModuleRow[];
}

export async function fetchActiveTalksForModules(
  moduleIds: string[], tenantId: string
): Promise<ActiveTalkRow[]> {
  if (moduleIds.length === 0) return [];
  const { data, error } = await serviceClient()
    .from('talks')
    .select('id, module_id, name, sequence_order')
    .in('module_id', moduleIds)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('sequence_order', { ascending: true });

  if (error) throw error;
  return (data ?? []) as ActiveTalkRow[];
}

export async function fetchEventsForTalks(
  talkIds: string[], tenantId: string
): Promise<EventTalkRow[]> {
  if (talkIds.length === 0) return [];
  const { data, error } = await serviceClient()
    .from('events')
    .select('id, talk_id')
    .in('talk_id', talkIds)
    .eq('tenant_id', tenantId)
    .neq('status', 'CANCELLED');

  if (error) throw error;
  return (data ?? []) as EventTalkRow[];
}

export async function fetchAttendedRows(
  memberId: string, eventIds: string[], tenantId: string
): Promise<AttendedRow[]> {
  // INVARIANT (Rule 4): only attendance_status = 'ATTENDED' completes a talk.
  // rsvps and member_attendance_reports are deliberately NOT read here.
  if (eventIds.length === 0) return [];
  const { data, error } = await serviceClient()
    .from('attendance')
    .select('event_id, confirmed_at')
    .eq('member_id', memberId)
    .eq('tenant_id', tenantId)
    .eq('attendance_status', 'ATTENDED')
    .in('event_id', eventIds);

  if (error) throw error;
  return (data ?? []) as AttendedRow[];
}
