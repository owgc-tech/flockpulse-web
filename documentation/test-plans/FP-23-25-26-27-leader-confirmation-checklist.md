# FP-23/25/26/27 Test Checklist — Leader Confirmation and Admin Override

## Migration

### 1. attendance_non_auto_requires_confirmer_check active

```sql
-- leader_confirm without confirmed_by → rejected
INSERT INTO attendance (..., confirmation_type, confirmed_by) VALUES (..., 'leader_confirm', NULL);
-- Expected: ERROR — check constraint attendance_non_auto_requires_confirmer_check violated
```

### 2. validate_attendance_tenant_scope() extended for confirmed_by

```sql
-- confirmed_by from wrong tenant → rejected
INSERT INTO attendance (..., confirmed_by) VALUES (..., '<member_id_from_other_tenant>');
-- Expected: ERROR — attendance.confirmed_by does not belong to tenant
```

## FP-26 — GET /api/confirmations/pending

### 3. MEMBER → 403 FORBIDDEN_ROLE

### 4. LEADER → sees only pending reports for their assigned members, not others

### 5. ADMIN → sees all pending reports for the tenant

### 6. Response includes member name, feedback, star_rating, submitted_at, rsvp_status, rsvp_reason

## FP-23 — POST /api/confirmations/:selfReportId

### 7. MEMBER → 403 FORBIDDEN_ROLE

### 8. LEADER confirming unassigned member's self-report → 403 FORBIDDEN_SCOPE

**Tested via `scripts/test-fp23-25-gaps.ts` TEST A — PASSED.**
`submitConfirmation()` called as LEADER for a member not in their `assignments` set.
Threw `FORBIDDEN_SCOPE: "This member is not assigned to you"` as expected.

### 9. ADMIN confirming any member's self-report → succeeds (no assignment check)

### 10. Non-existent selfReportId → 404 NOT_FOUND

### 11. self-report with confirmation_status = NOT_REQUIRED → 422 CONFIRMATION_NOT_ALLOWED

### 12. CONFIRM decision → attendance row with attendance_status = ATTENDED, confirmation_type = leader_confirm

### 13. REJECT decision → attendance row with attendance_status = DID_NOT_ATTEND, confirmation_type = leader_reject

### 14. confirmed_by set to caller's memberId, confirmed_at populated

### 15. member_attendance_reports.confirmation_status updated to CONFIRMED / REJECTED

### 16. Double-confirm attempt (race guard) — second call → error raised by resolve_leader_confirmation() inside the function

### 17. FP-27: LOCKED event → 422 ATTENDANCE_NOT_OPEN

### 18. FP-27: CANCELLED event → 422 ATTENDANCE_NOT_OPEN

**Tested via `scripts/test-fp23-25-gaps.ts` TEST B — PASSED.**
`submitConfirmation()` called as LEADER (assigned member) on a CANCELLED event's self-report.
Scope check passed; cancel guard fired and threw `ATTENDANCE_NOT_OPEN: "Confirmation is not permitted for cancelled or locked events"`.

## FP-25 — POST /api/attendance/override

### 19. Non-ADMIN → 403 FORBIDDEN_ROLE

### 20. Unknown event_id → 404 NOT_FOUND

### 21. Member not in event_attendees → 403 FORBIDDEN_SCOPE

### 22. attendance_status = ATTENDED → attendance row with confirmation_type = admin_override, attendance_status = ATTENDED

### 23. attendance_status = DID_NOT_ATTEND → same, DID_NOT_ATTEND

### 24. Repeat override → version increments, self_report_id preserved from prior row

### 25. FP-27: LOCKED event → 422 ATTENDANCE_NOT_OPEN

### 26. FP-27: CANCELLED event → 422 ATTENDANCE_NOT_OPEN

**Tested via `scripts/test-fp23-25-gaps.ts` TEST C — PASSED.**
`submitAttendanceOverride()` called as ADMIN on a CANCELLED event.
Threw `ATTENDANCE_NOT_OPEN: "Override is not permitted for cancelled or locked events"`.

## Regression

### 27. no_self_report_auto rows untouched — neither function targets them

```sql
SELECT confirmation_type FROM attendance WHERE confirmation_type = 'no_self_report_auto';
-- Must be unchanged after any confirm/reject/override calls on other rows.
```

### 28. member_attendance_reports.self_report_status never written by either new function

```sql
-- Only confirmation_status changes. self_report_status (SELF_REPORTED_YES/NO) is immutable after insert.
SELECT self_report_status FROM member_attendance_reports WHERE id = '<confirmed_self_report_id>';
-- Must equal original value (SELF_REPORTED_YES).
```

### 29. No attendance row with attendance_status = ATTENDED produced by any path other than leader_confirm or admin_override

```sql
SELECT DISTINCT confirmation_type FROM attendance WHERE attendance_status = 'ATTENDED';
-- Must only contain 'leader_confirm' and 'admin_override'.
```
