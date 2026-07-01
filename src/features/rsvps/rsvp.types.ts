export type RsvpStatus = 'YES' | 'NO';

export interface RsvpRow {
  id: string;
  tenant_id: string;
  event_id: string;
  member_id: string;
  rsvp_status: RsvpStatus;
  rsvp_reason: string | null;
  responded_at: string;
  created_at: string;
  updated_at: string;
}

export interface SubmitRsvpInput {
  eventId: string;
  rsvpStatus: RsvpStatus;
  rsvpReason?: string;
}

export interface RsvpResponse {
  id: string;
  event_id: string;
  member_id: string;
  rsvp_status: RsvpStatus;
  rsvp_reason: string | null;
  responded_at: string;
  is_late: false; // No lateness semantics defined in FP-16/FP-17 ACs — hardcoded per DIP
}
