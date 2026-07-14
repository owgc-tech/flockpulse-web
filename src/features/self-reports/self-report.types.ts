export type SelfReportStatus = 'SELF_REPORTED_YES' | 'SELF_REPORTED_NO';
export type ConfirmationStatus = 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'REJECTED' | 'NOT_REQUIRED';

export interface SelfReportRow {
  id: string;
  tenant_id: string;
  event_id: string;
  member_id: string;
  self_report_status: SelfReportStatus;
  reason: string | null;
  feedback: string | null;
  star_rating: number | null;
  confirmation_status: ConfirmationStatus;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}

export interface SubmitSelfReportInput {
  eventId: string;
  selfReportStatus: SelfReportStatus;
  reason?: string;
  feedback?: string;
  starRating?: number;
}

export interface SelfReportResponse {
  id: string;
  event_id: string;
  member_id: string;
  self_report_status: SelfReportStatus;
  reason: string | null;
  feedback: string | null;
  star_rating: number | null;
  confirmation_status: ConfirmationStatus;
  submitted_at: string;
}

// DIP-FP-119-web: shape for GET /api/self-reports/pending.
export interface PendingSelfReportRow {
  event_id: string;
  event_name: string;
  event_start_datetime: string;
  event_end_datetime: string;
  event_location_name: string;
}
