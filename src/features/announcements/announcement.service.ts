import { isExpectedAttendee, getEventExistsForTenant } from '@/src/features/self-reports/self-report.repository';
import { createAnnouncementAcknowledgement, isAnnouncementEvent, getAnnouncementRoster } from './announcement.repository';
import type { AnnouncementAcknowledgementRow, AnnouncementRosterEntry } from './announcement.repository';

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

// DIP-FP-191-web-adj-4: same two checks and order as acknowledgeAnnouncement()
// above (event exists → NOT_FOUND, is actually an Announcement → INVALID_TARGET),
// minus the per-member isExpectedAttendee check — this is an Admin/Leader
// viewing everyone's status, not a member acting on their own behalf.
export async function getAnnouncementAcknowledgementRoster(
  tenantId: string,
  eventId: string,
  scopeToLeaderMemberId?: string
): Promise<AnnouncementRosterEntry[]> {
  const eventExists = await getEventExistsForTenant(tenantId, eventId);
  if (!eventExists) {
    throw serviceError('NOT_FOUND', 'Event not found');
  }

  const isAnnouncement = await isAnnouncementEvent(tenantId, eventId);
  if (!isAnnouncement) {
    throw serviceError('INVALID_TARGET', 'This endpoint only accepts Announcement-type events');
  }

  return getAnnouncementRoster(eventId, tenantId, scopeToLeaderMemberId);
}
