import {
  isExpectedAttendee,
  checkBlockedByGuard,
  getEventExistsForTenant,
  getEventEffectiveStatus,
  getExistingSelfReport,
  insertSelfReportYes,
  callSubmitSelfReportNo,
  getSelfReportById,
} from './self-report.repository';
import type { SubmitSelfReportInput, SelfReportResponse } from './self-report.types';

function serviceError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

export async function submitSelfReport(
  tenantId: string,
  memberId: string,
  input: SubmitSelfReportInput
): Promise<SelfReportResponse> {
  const { eventId, selfReportStatus, reason, feedback, starRating } = input;

  // Step 1: Member must be an expected attendee.
  const attendee = await isExpectedAttendee(tenantId, eventId, memberId);
  if (!attendee) {
    throw serviceError('FORBIDDEN_SCOPE', 'Member is not an expected attendee of this event');
  }

  // Step 2: Guard against CANCELLED or LOCKED events (consistent with FP-16/FP-17 precedent).
  const blocked = await checkBlockedByGuard(eventId);
  if (blocked) {
    throw serviceError('ATTENDANCE_NOT_OPEN', 'Self-report is not permitted for cancelled or locked events');
  }

  // Step 3: Confirm event belongs to this tenant, then derive effective status.
  // This is the fix for the staleness bug: status is now computed from timestamps at
  // query time, so the up-to-5-minute window between end_datetime and the old cron tick
  // that could incorrectly reject a legitimate self-report is eliminated.
  const eventExists = await getEventExistsForTenant(tenantId, eventId);
  if (!eventExists) {
    throw serviceError('NOT_FOUND', 'Event not found');
  }

  const effectiveStatus = await getEventEffectiveStatus(eventId);
  if (effectiveStatus !== 'COMPLETED') {
    throw serviceError('SELF_REPORT_NOT_OPEN', 'Self-report window is only open when the event is COMPLETED');
  }

  // Step 4: One report per member per event — no re-submission.
  const alreadySubmitted = await getExistingSelfReport(tenantId, eventId, memberId);
  if (alreadySubmitted) {
    throw serviceError('SELF_REPORT_ALREADY_SUBMITTED', 'A self-report has already been submitted for this event');
  }

  if (selfReportStatus === 'SELF_REPORTED_NO') {
    // Step 5a: No requires a non-empty reason.
    if (!reason || reason.trim() === '') {
      throw serviceError('SELF_REPORT_REASON_REQUIRED', 'A reason is required when self-reporting No');
    }
    // feedback and star_rating are Yes-only fields — reject explicitly to avoid silent data loss.
    if (feedback !== undefined || starRating !== undefined) {
      throw serviceError('VALIDATION_ERROR', 'feedback and star_rating are only valid for SELF_REPORTED_YES');
    }

    // Atomic dual-write via SECURITY DEFINER function (see Grounding Check item 5).
    const result = await callSubmitSelfReportNo(tenantId, eventId, memberId, reason);
    const row = await getSelfReportById(result.self_report_id);

    return {
      id: row.id,
      event_id: row.event_id,
      member_id: row.member_id,
      self_report_status: row.self_report_status,
      reason: row.reason,
      feedback: row.feedback,
      star_rating: row.star_rating,
      confirmation_status: row.confirmation_status,
      submitted_at: row.submitted_at,
    };
  }

  // Step 5b: SELF_REPORTED_YES path.
  if (feedback !== undefined && feedback.length > 1000) {
    throw serviceError('VALIDATION_ERROR', 'feedback must be 1000 characters or fewer');
  }
  if (starRating !== undefined && (!Number.isInteger(starRating) || starRating < 1 || starRating > 5)) {
    throw serviceError('VALIDATION_ERROR', 'star_rating must be an integer between 1 and 5');
  }

  // reason on a Yes report is silently ignored — lower-stakes than Yes-only fields on No.
  const row = await insertSelfReportYes(
    tenantId,
    eventId,
    memberId,
    feedback ?? null,
    starRating ?? null
  );

  // TODO(EPIC-8/WP-8): a LEADER_CONFIRMATION notification should be created here, dynamically
  // per member, when they submit a Yes self-report. The current handle_event_scheduling()
  // (migration 20260629000003) inserts this notification unconditionally at scheduling time,
  // which is architecturally incorrect — but it's inert until a notification worker is built.
  // Do NOT insert a competing notification row here; let EPIC-8 decide the correct dispatch
  // mechanism before touching this. See DIP-FP-19-FP-20 Grounding Check item 3.

  return {
    id: row.id,
    event_id: row.event_id,
    member_id: row.member_id,
    self_report_status: row.self_report_status,
    reason: row.reason,
    feedback: row.feedback,
    star_rating: row.star_rating,
    confirmation_status: row.confirmation_status,
    submitted_at: row.submitted_at,
  };
}
