import { isExpectedAttendee, getEventExistsForTenant } from '@/src/features/self-reports/self-report.repository';
import { createAnnouncementAcknowledgement, isAnnouncementEvent } from './announcement.repository';
import type { AnnouncementAcknowledgementRow } from './announcement.repository';

function serviceError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

// DIP-FP-191-web: mirrors submitSelfReport()'s validation order (self-report.service.ts)
// — event exists for tenant, then the type-specific guard (there: effective status;
// here: this must actually be an Announcement), then the expected-attendee check.
export async function acknowledgeAnnouncement(
  tenantId: string,
  eventId: string,
  memberId: string
): Promise<AnnouncementAcknowledgementRow> {
  const eventExists = await getEventExistsForTenant(tenantId, eventId);
  if (!eventExists) {
    throw serviceError('NOT_FOUND', 'Event not found');
  }

  const isAnnouncement = await isAnnouncementEvent(tenantId, eventId);
  if (!isAnnouncement) {
    throw serviceError('INVALID_TARGET', 'This endpoint only accepts Announcement-type events');
  }

  const attendee = await isExpectedAttendee(tenantId, eventId, memberId);
  if (!attendee) {
    throw serviceError('FORBIDDEN_SCOPE', 'Member is not an expected attendee of this event');
  }

  return createAnnouncementAcknowledgement(tenantId, eventId, memberId);
}
