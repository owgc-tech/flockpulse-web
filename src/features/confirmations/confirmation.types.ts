export type ConfirmationDecision = 'CONFIRM' | 'REJECT';

export interface PendingConfirmationRow {
  self_report_id: string;
  event_id: string;
  member_id: string;
  member_first_name: string;
  member_last_name: string;
  self_report_status: string;
  feedback: string | null;
  star_rating: number | null;
  submitted_at: string;
  rsvp_status: string | null;
  rsvp_reason: string | null;
}

export interface SubmitConfirmationInput {
  decision: ConfirmationDecision;
  leaderNote?: string;
}

export interface ConfirmationResult {
  attendance_id: string;
  confirmation_status: string;
  confirmed_at: string;
}
