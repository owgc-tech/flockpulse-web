export interface SubmitAttendanceOverrideInput {
  eventId: string;
  memberId: string;
  attendanceStatus: 'ATTENDED' | 'DID_NOT_ATTEND';
  reason: string;
}

export interface AttendanceOverrideResult {
  attendance_id: string;
  version: number;
  confirmed_at: string;
}
