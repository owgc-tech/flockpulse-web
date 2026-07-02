import {
  isExpectedAttendee,
  getEventForRsvp,
  checkBlockedByGuard,
  upsertRsvp,
} from './rsvp.repository';
import type { RsvpResponse, SubmitRsvpInput } from './rsvp.types';

function serviceError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

export async function submitRsvp(
  tenantId: string,
  memberId: string,
  input: SubmitRsvpInput
): Promise<RsvpResponse> {
  const { eventId, rsvpStatus, rsvpReason } = input;

  // Step 1: Member must be an expected attendee — no RSVP on events they weren't targeted for.
  const attendee = await isExpectedAttendee(tenantId, eventId, memberId);
  if (!attendee) {
    throw serviceError('NOT_AN_ATTENDEE', 'Member is not an expected attendee of this event');
  }

  // Step 2: Call the FP-13 guard — blocks if event is CANCELLED or LOCKED.
  const blocked = await checkBlockedByGuard(eventId);
  if (blocked) {
    throw serviceError('INVALID_STATE', 'RSVP is not permitted for cancelled or locked events');
  }

  // Step 3: Event must be SCHEDULED or ACTIVE, and the window must still be open (before start).
  const event = await getEventForRsvp(tenantId, eventId);
  if (!event) {
    throw serviceError('NOT_FOUND', 'Event not found');
  }

  const isOpenStatus = event.status === 'SCHEDULED' || event.status === 'ACTIVE';
  const isBeforeStart = new Date() < new Date(event.start_datetime);

  if (!isOpenStatus || !isBeforeStart) {
    throw serviceError('RSVP_CLOSED', 'RSVP window is closed for this event');
  }

  // Step 4: 'NO' requires a non-empty reason. 'YES' must never require one.
  if (rsvpStatus === 'NO' && (!rsvpReason || rsvpReason.trim() === '')) {
    throw serviceError('RSVP_REASON_REQUIRED', 'A reason is required when declining (rsvp_status = NO)');
  }

  const row = await upsertRsvp(
    tenantId,
    eventId,
    memberId,
    rsvpStatus,
    rsvpStatus === 'YES' ? null : (rsvpReason ?? null)
  );

  return {
    id: row.id,
    event_id: row.event_id,
    member_id: row.member_id,
    rsvp_status: row.rsvp_status,
    rsvp_reason: row.rsvp_reason,
    responded_at: row.responded_at,
    is_late: false, // No lateness semantics defined in FP-16/FP-17 ACs — assumption documented in PR
  };
}
