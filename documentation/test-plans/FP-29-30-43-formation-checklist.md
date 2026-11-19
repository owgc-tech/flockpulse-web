# FP-29 / FP-30 / FP-43 — Formation Structure, Event Linkage, and Completion Computation
## Test Checklist

Branch: `feature/FP-29-30-43-formation-structure`
Migration: `20260629000015_formation_structure_and_completion.sql`
Date: 2026-07-03
Tester: CC (automated script: `scripts/test-fp29-30-43-formation.ts`)

---

### Group 1 — DB Constraints

| # | Test | Result |
|---|------|--------|
| 1.1 | Duplicate `sequence_order` within same course → unique constraint violation | PASS |
| 1.2 | Module with `tenant_id` that doesn't match its `course_id`'s tenant → trigger rejection | PASS |
| 1.3 | Talk with `tenant_id` that doesn't match its `module_id`'s tenant → trigger rejection | PASS |

### Group 2 — Talk Deletion Guard

| # | Test | Result |
|---|------|--------|
| 2.1 | Soft-delete a talk referenced by an event (any status) → trigger blocks update | PASS |
| 2.2 | Soft-delete a talk with no referencing events → succeeds | PASS |

### Group 3 — events.talk_id Validation (DB layer, closes FP-43)

| # | Test | Result |
|---|------|--------|
| 3.1 | Insert event with non-existent `talk_id` → FK violation | PASS |
| 3.2 | Insert event with soft-deleted `talk_id` → trigger blocks insert | PASS |

### Group 4 — Formation Completion Invariant (Rule 4)

| # | Test | Expected | Result |
|---|------|----------|--------|
| 4.1 | `attendance_status = 'ATTENDED'` on linked event | talk complete = true | PASS |
| 4.2 | RSVP YES only, no attendance row | talk complete = false | PASS |
| 4.3 | Pending self-report (`SELF_REPORTED_YES / PENDING_CONFIRMATION`) | talk complete = false | PASS |
| 4.4 | `attendance_status = 'DID_NOT_ATTEND'` | talk complete = false | PASS |
| 4.5 | `ATTENDED` on module 2 talk (cross-module coverage) | talk complete = true | PASS |

**Regression guard**: Tests 4.2, 4.3, 4.4 confirm that `rsvps` and `member_attendance_reports`
are never read by the completion computation. Only `attendance.attendance_status = 'ATTENDED'` counts.

### Group 5 — Module and Course Aggregation

| # | Test | Expected | Result |
|---|------|----------|--------|
| 5.1 | Module 1 has 4 talks, 3 are incomplete | `module_completed = false` | PASS |
| 5.2 | Module 2 has 1 talk, that talk is ATTENDED | `module_completed = true` | PASS |
| 5.3 | Course has 2 modules, module 1 is incomplete | `course_completed = false` | PASS |
| 5.4 | 2 of 5 talks completed via ATTENDED | `completed_talk_count = 2` | PASS |
| 5.5 | 5 total talks in course | `total_talk_count = 5` | PASS |

---

### Total: 17 / 17 PASS

---

### Flagged Assumptions (not tested, carried into PR)

- Empty module (zero active talks) is vacuously complete — judgment call, consistent with
  "all-of-empty-set is true." Surfaced to user; confirmed safe because `events.talk_id` only
  ever links to a Talk, never a Module, so an empty Module cannot appear in any member's
  completion history regardless.
- `INVALID_STATE_TRANSITION` used for soft-delete blocked by reference — no exact canonical
  match; closest available fit.
- `INVALID_FORMATION_LINK` used for invalid/soft-deleted/cross-tenant `talk_id` on event —
  canonical code, confirmed by re-read of Engineering Spec §6.
- Existing `INVALID_TRANSITION` string in `publishEvent()` (non-canonical, pre-existing) not
  renamed — out of scope for this DIP, flagged for future cleanup.
