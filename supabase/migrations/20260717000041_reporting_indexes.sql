-- DIP-FP-37-FP-38-web: reporting-supporting indexes for RSVP and Attendance
-- reports (STORY-9.1/STORY-9.2). Both reports scan across event/member/group
-- joins at read time (event_attendees left-joined to rsvps, or to
-- member_attendance_reports + attendance), so this adds real indexes rather
-- than relying on the existing PK/FK/unique indexes alone.

CREATE INDEX IF NOT EXISTS idx_rsvps_event_id ON rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_rsvps_member_id ON rsvps(member_id);

CREATE INDEX IF NOT EXISTS idx_attendance_event_id ON attendance(event_id);
CREATE INDEX IF NOT EXISTS idx_attendance_member_id ON attendance(member_id);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(attendance_status);

CREATE INDEX IF NOT EXISTS idx_member_attendance_reports_event_id ON member_attendance_reports(event_id);
CREATE INDEX IF NOT EXISTS idx_member_attendance_reports_member_id ON member_attendance_reports(member_id);
CREATE INDEX IF NOT EXISTS idx_member_attendance_reports_self_report_status ON member_attendance_reports(self_report_status);

-- Attendance report's date-range filter.
CREATE INDEX IF NOT EXISTS idx_events_start_datetime ON events(start_datetime);

-- DIP-FP-37-FP-38-web correction: the DIP's own Implementation Plan specifies
-- `assignments(assignment_type, target_id)`, but `target_id` was dropped and
-- replaced by typed `group_id`/`leader_member_id` columns in migration
-- 20260629000003_remediate_rbac_and_assignments.sql — there is no `target_id`
-- column left to index. Indexing the two current typed columns instead,
-- scoped exactly to the query shape getAssignedMemberIds()
-- (confirmation.repository.ts) and getGroupMembers() (assignments/service.ts)
-- already use — tenant_id + the typed target column, filtered to the
-- matching assignment_type and active (non-deleted) rows.
CREATE INDEX IF NOT EXISTS idx_assignments_leader_lookup
    ON assignments(tenant_id, leader_member_id)
    WHERE assignment_type = 'LEADER' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_assignments_group_lookup
    ON assignments(tenant_id, group_id)
    WHERE assignment_type = 'GROUP' AND deleted_at IS NULL;
