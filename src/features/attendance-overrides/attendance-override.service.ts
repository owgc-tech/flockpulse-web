import { createClient } from '@supabase/supabase-js';
import type { SubmitAttendanceOverrideInput, AttendanceOverrideResult } from './attendance-override.types';
import {
  isExpectedAttendee,
  getEventExistsForTenant,
  callAdminOverrideAttendance,
} from './attendance-override.repository';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function serviceError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

async function checkBlockedByGuard(eventId: string): Promise<boolean> {
  const { data } = await serviceClient().rpc('block_actions_on_cancelled_or_locked', {
    p_event_id: eventId,
  });
  return data === true;
}

export async function submitAttendanceOverride(
  tenantId: string,
  adminMemberId: string,
  input: SubmitAttendanceOverrideInput
): Promise<AttendanceOverrideResult> {
  const { eventId, memberId, attendanceStatus, reason } = input;

  // Step 1: Confirm event belongs to this tenant.
  const eventExists = await getEventExistsForTenant(tenantId, eventId);
  if (!eventExists) {
    throw serviceError('NOT_FOUND', 'Event not found');
  }

  // Step 2: Target member must be an expected attendee.
  const attendee = await isExpectedAttendee(tenantId, eventId, memberId);
  if (!attendee) {
    throw serviceError('FORBIDDEN_SCOPE', 'Member is not an expected attendee of this event');
  }

  // Step 3: FP-27 lock/cancel guard.
  const blocked = await checkBlockedByGuard(eventId);
  if (blocked) {
    throw serviceError('ATTENDANCE_NOT_OPEN', 'Override is not permitted for cancelled or locked events');
  }

  // Step 4: Upsert via SECURITY DEFINER function — supersedes any prior state.
  return callAdminOverrideAttendance(tenantId, eventId, memberId, attendanceStatus, adminMemberId, reason);
}
