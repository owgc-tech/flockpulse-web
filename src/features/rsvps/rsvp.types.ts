export type RsvpStatus = 'YES' | 'NO' | 'TENTATIVE';

export interface RsvpRow {
  id: string;
  tenant_id: string;
  event_id: string;
  member_id: string;
  rsvp_status: RsvpStatus;
  rsvp_reason: string | null;
  // DIP-FP-189-web: null unless rsvp_status is YES or TENTATIVE — enforced by
  // rsvps_guest_count_status_check at the database layer, not just here.
  guest_count: number | null;
  responded_at: string;
  created_at: string;
  updated_at: string;
}

export interface SubmitRsvpInput {
  eventId: string;
  rsvpStatus: RsvpStatus;
  rsvpReason?: string;
  guestCount?: number;
}

export interface RsvpResponse {
  id: string;
  event_id: string;
  member_id: string;
  rsvp_status: RsvpStatus;
  rsvp_reason: string | null;
  guest_count: number | null;
  responded_at: string;
  is_late: false; // No lateness semantics defined in FP-16/FP-17 ACs — hardcoded per DIP
}
