export type EventStatus = 'DRAFT' | 'SCHEDULED' | 'CANCELLED';
export type EffectiveStatus = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'COMPLETED' | 'LOCKED' | 'CANCELLED';

export interface EventTarget {
  group_ids?: string[];
  member_ids?: string[];
}

export interface EventListRow {
  id: string;
  name: string;
  status: EventStatus;
  effective_status: EffectiveStatus;
  start_datetime: string;
  end_datetime: string;
  location_name: string;
  location_address: string;
  location_url: string | null;
  target: EventTarget;
  event_type_id: string;
  // Always-optional, no event-type gating (FP-107) — purely informational assignment metadata.
  prayer_leader_member_id: string | null;
  food_assignment: EventTarget | null;
  // DIP-FP-120-web: online_meeting_resource_id (tracked Zoom account) and
  // online_meeting_url/online_meeting_platform_label (freeform "other
  // platform") are mutually exclusive at the app layer only — additive to
  // the still-required physical location above, never a replacement for it.
  online_meeting_resource_id: string | null;
  online_meeting_url: string | null;
  online_meeting_platform_label: string | null;
  // FP-133: nullable per-event override of the tenant's rsvp_closure_days_default —
  // null means "use the tenant default."
  rsvp_closure_days: number | null;
  // FP-134: server-computed cutoff (start_datetime − effective rsvp_closure_days), not a
  // persisted column — see rsvp-window.ts's computeRsvpClosureAt().
  rsvp_closure_at: string;
  created_at: string;
}

export interface EventDetailRow extends EventListRow {
  talk_id: string | null;
  version: number;
  updated_at: string;
  recurrence_series_id: string | null;
  // DIP-FP-114-web: null for events created before this column existed —
  // no Leader-tier account can edit/cancel those, only Admin-tier can.
  created_by_member_id: string | null;
}

export interface EventTypeOption {
  id: string;
  name: string;
  code: string;
}

// Matches flockpulse-web's GET /api/meeting-resources response exactly.
export interface MeetingResourceOption {
  id: string;
  name: string;
  join_url: string;
}

// DIP-FP-120-web: shape of the { error: { code, message, conflict } } body
// a 409 MEETING_RESOURCE_CONFLICT response carries — conflict is null for
// the rare race-condition path (see events/service.ts's
// meetingResourceRaceError()), populated for the normal pre-check path.
export interface MeetingResourceConflictDetail {
  eventId: string;
  eventName: string;
  startDatetime: string;
  endDatetime: string;
  bookedByName: string;
}

export interface GroupOption {
  id: string;
  name: string;
}

export interface MemberOption {
  id: string;
  first_name: string;
  last_name: string;
}

export interface CourseOption {
  id: string;
  name: string;
}

export interface ModuleOption {
  id: string;
  name: string;
}

export interface TalkOption {
  id: string;
  name: string;
}

export type RosterResponse = 'ACCEPTED' | 'DECLINED' | 'NOT_RESPONDED';

export interface RosterEntry {
  member_id: string;
  first_name: string;
  last_name: string;
  response: RosterResponse;
  rsvp_reason: string | null;
}

// One-tap navigation link (FP-61): use location_url directly when the admin set an
// explicit override; otherwise fall back to a universal Google Maps query link built
// from location_address — opens the native app on mobile and Google Maps on the web.
export function getMapsUrl(locationAddress: string, locationUrl: string | null): string {
  if (locationUrl) return locationUrl;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationAddress)}`;
}

// ── FP-63: recurring series ──────────────────────────────────────────────────

export type SeriesFrequency = 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY';

// Cap is a ceiling the admin can choose up to, never a forced default (DIP-FP-63-FP-68
// Grounding Check). Enforced both client-side (live estimate) and server-side (authoritative).
export const SERIES_FREQUENCY_CAPS: Record<SeriesFrequency, number> = {
  WEEKLY: 52,
  FORTNIGHTLY: 26,
  MONTHLY: 12,
};

export interface OccurrenceDates {
  start: Date;
  end: Date;
}

// Advances firstStart by `occurrenceIndex` intervals of the given frequency. Weekly/Fortnightly
// use fixed 7/14-day steps. Monthly advances by calendar month on the same day-of-month as
// firstStart, clamped to the last day of the target month where it doesn't exist
// (e.g. Jan 31 -> Feb 28) — per the DIP's explicit assumption about day-of-month handling.
function addOccurrenceInterval(firstStart: Date, frequency: SeriesFrequency, occurrenceIndex: number): Date {
  if (frequency === 'WEEKLY') {
    const d = new Date(firstStart);
    d.setDate(d.getDate() + 7 * occurrenceIndex);
    return d;
  }
  if (frequency === 'FORTNIGHTLY') {
    const d = new Date(firstStart);
    d.setDate(d.getDate() + 14 * occurrenceIndex);
    return d;
  }
  // MONTHLY — reset to the 1st before adding months to avoid intermediate-month rollover
  // artifacts, then clamp the day-of-month to whatever the target month actually has.
  const day = firstStart.getDate();
  const target = new Date(firstStart);
  target.setDate(1);
  target.setMonth(target.getMonth() + occurrenceIndex);
  const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, daysInTargetMonth));
  target.setHours(firstStart.getHours(), firstStart.getMinutes(), firstStart.getSeconds(), firstStart.getMilliseconds());
  return target;
}

// Single-sourced occurrence-date computation (DIP-FP-63-FP-68 Grounding Check: the cap-validation
// math and the actual generation must be the same code path). Used identically by EventForm.tsx's
// live "ends on date" estimate and event-series.service.ts's authoritative payload construction —
// same function, two runtime contexts, never two implementations.
export function computeOccurrenceDates(
  firstStart: Date,
  firstEnd: Date,
  frequency: SeriesFrequency,
  mode: 'COUNT' | 'UNTIL',
  countOrUntil: number | Date
): OccurrenceDates[] {
  const durationMs = firstEnd.getTime() - firstStart.getTime();
  const occurrences: OccurrenceDates[] = [];
  const hardSafetyCap = 1000; // guards against runaway loops on bad input (e.g. untilDate far in the future)

  if (mode === 'COUNT') {
    const count = countOrUntil as number;
    for (let i = 0; i < count; i++) {
      const start = addOccurrenceInterval(firstStart, frequency, i);
      occurrences.push({ start, end: new Date(start.getTime() + durationMs) });
    }
  } else {
    const untilDate = countOrUntil as Date;
    for (let i = 0; i < hardSafetyCap; i++) {
      const start = addOccurrenceInterval(firstStart, frequency, i);
      if (start.getTime() > untilDate.getTime()) break;
      occurrences.push({ start, end: new Date(start.getTime() + durationMs) });
    }
  }

  return occurrences;
}

export interface EventSeriesRow {
  id: string;
  tenant_id: string;
  frequency: SeriesFrequency;
  occurrence_count: number;
  day_of_week: number | null;
  created_by: string | null;
  name: string;
  event_type_id: string;
  location_name: string;
  location_address: string;
  location_url: string | null;
  target: EventTarget;
  talk_id: string | null;
  created_at: string;
}

export interface CancelRemainingResult {
  cancelled: number;
  skipped: number;
  failures: Array<{ event_id: string; message: string }>;
}
