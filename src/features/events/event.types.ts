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
  created_at: string;
}

export interface EventDetailRow extends EventListRow {
  talk_id: string | null;
  version: number;
  updated_at: string;
}

export interface EventTypeOption {
  id: string;
  name: string;
  code: string;
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
