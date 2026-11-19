import {
  isExpectedAttendee,
  getEventExistsForTenant,
  getEventEffectiveStatus,
  getEventClosureInfo,
  getTenantRsvpClosureDaysDefault,
  checkBlockedByGuard,
  upsertRsvp,
} from './rsvp.repository';
import { computeRsvpClosureAt } from './rsvp-window';
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
  const { eventId, rsvpStatus, rsvpReason, guestCount } = input;

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

  // Step 3: Confirm event belongs to this tenant, then derive effective status.
  const eventExists = await getEventExistsForTenant(tenantId, eventId);
  if (!eventExists) {
    throw serviceError('NOT_FOUND', 'Event not found');
  }

  const effectiveStatus = await getEventEffectiveStatus(eventId);

  // RSVP is only open before start_datetime — i.e. while the derived status is SCHEDULED.
  // The separate now() < start_datetime check from FP-16/17 is removed: SCHEDULED is itself
  // defined as "before start_datetime" by the derivation function, so both conditions were
  // always equivalent and keeping both would be dead logic.
  if (effectiveStatus !== 'SCHEDULED') {
    throw serviceError('RSVP_CLOSED', 'RSVP window is closed for this event');
  }

  // FP-133: closure cutoff = start_datetime − COALESCE(event override, tenant default) days.
  // With the tenant default at 0 and no per-event override, cutoff === start_datetime, which
  // the SCHEDULED check above already guarantees now is before — a byte-identical no-op on
  // today's behavior until an Admin actually sets a non-zero value.
  const [closureInfo, tenantDefaultDays] = await Promise.all([
    getEventClosureInfo(eventId),
    getTenantRsvpClosureDaysDefault(tenantId),
  ]);
  if (closureInfo) {
    const closureAt = computeRsvpClosureAt(closureInfo.start_datetime, closureInfo.rsvp_closure_days, tenantDefaultDays);
    if (Date.now() >= new Date(closureAt).getTime()) {
      throw serviceError('RSVP_CLOSED', 'RSVP window is closed for this event');
    }
  }

  // Step 4: 'NO' requires a non-empty reason. 'YES' must never require one.
  if (rsvpStatus === 'NO' && (!rsvpReason || rsvpReason.trim() === '')) {
    throw serviceError('RSVP_REASON_REQUIRED', 'A reason is required when declining (rsvp_status = NO)');
  }

  // Step 5: DIP-FP-189-web-adj-1 — guest_count is now Yes-only (reversed from
  // the original FP-189-web DIP's Yes/Tentative allowance; see the tightened
  // rsvps_guest_count_status_check, migration 20260805000064). This app-layer
  // check gives a clean error instead of a raw 23514 for the common client
  // mistake; the database constraint remains the real enforcement. The
  // guests_allowed gate below is not explicitly asked for by the original
  // DIP's Implementation Plan, but required for the "Guests Allowed toggle
  // ... no effect on any existing event" story goal to actually hold —
  // without it, guest_count would be acceptable on any event regardless of
  // whether it allows guests, making the toggle meaningless. See PR
  // description for this judgment call.
  if (guestCount !== undefined) {
    if (rsvpStatus !== 'YES') {
      throw serviceError('GUEST_COUNT_NOT_ALLOWED', 'guest_count is only allowed when accepting (rsvp_status = YES)');
    }
    if (!Number.isInteger(guestCount) || guestCount < 0) {
      throw serviceError('VALIDATION_ERROR', 'guest_count must be a non-negative integer');
    }
    if (closureInfo && !closureInfo.guests_allowed) {
      throw serviceError('GUEST_COUNT_NOT_ALLOWED', 'This event does not allow guests');
    }
  }

  let row;
  try {
    row = await upsertRsvp(
      tenantId,
      eventId,
      memberId,
      rsvpStatus,
      rsvpStatus === 'YES' ? null : (rsvpReason ?? null),
      guestCount ?? null
    );
  } catch (error: unknown) {
    // DIP-FP-189-web: trigger_enforce_rsvp_guest_count_max is the real,
    // authoritative enforcement of the tenant max (a CHECK constraint can't
    // reference another table) — mapped here the same P0001 + message-
    // substring convention used for every other guard trigger in this
    // codebase (e.g. FP-191's SYSTEM_MANAGED_GROUP/ANNOUNCEMENT_MISSING_EVERYONE_GROUP).
    const err = error as { code?: string; message?: string };
    if (err.code === 'P0001' && (err.message ?? '').includes('GUEST_COUNT_EXCEEDS_MAX')) {
      throw serviceError('GUEST_COUNT_EXCEEDS_MAX', err.message ?? 'guest_count exceeds this community\'s max');
    }
    throw error;
  }

  return {
    id: row.id,
    event_id: row.event_id,
    member_id: row.member_id,
    rsvp_status: row.rsvp_status,
    rsvp_reason: row.rsvp_reason,
    guest_count: row.guest_count,
    responded_at: row.responded_at,
    is_late: false, // No lateness semantics defined in FP-16/FP-17 ACs — assumption documented in PR
  };
}
