DIP-FP-19-FP-20 — Post-Event Self-Report Submission with Reason Enforcement
Covers: STORY-5.1 (FP-19) — Submit Post-Event Attendance Self-Report Covers: STORY-5.2 (FP-20) — Enforce Self-Report No Reason Requirement Epic: EPIC-5 — Self-Report Management (FP-18) Work Package: WP-6 (Developer Execution Packet)
Story Summary
After an event transitions to COMPLETED, members self-report whether they attended. A "Yes" self-report accepts optional feedback (≤1000 chars) and an optional star rating (1–5), and is stored as `PENDING_CONFIRMATION` — it does not create official attendance; that only happens via leader confirmation (EPIC-6, not in scope here). A "No" self-report requires a reason and, unlike Yes, immediately and automatically creates an official `attendance` row with `attendance_status = DID_NOT_ATTEND` — no leader step, no notification. A member may submit exactly once per event; re-submission is rejected.
This DIP creates the `attendance` table for the first time — it doesn't exist in any prior migration, but STORY-5.2's third acceptance criterion requires writing to it. See Grounding Check item 1.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Same reasoning as FP-16/FP-17: self-report is conceptually a mobile member action, but the mobile repo doesn't exist yet. This DIP builds the backend contract only (migration + Route Handler) in the shared web repo. No mobile UI is in scope.
Grounding Check
Checked against PDD/Engineering Spec (§3 Minimal Data Model, §4 Execution State Machine, §6 Error Codes) and the actual current schema (all prior migrations, uploaded and verified directly):

1. `attendance` table does not exist yet — being created now, complete, ahead of EPIC-6. FP-20's AC #3 requires an immediate official-attendance write, which structurally requires this table to exist. Rather than build a minimal stub that EPIC-6 would have to re-migrate, this DIP implements the full canonical schema from Engineering Spec §3 (`attendance_status`, `self_report_id`, `confirmed_by`, `confirmed_at`, `confirmation_type`, `leader_note`, `version`) now. EPIC-6 should `ALTER`, not recreate. Only the `no_self_report_auto` write path is implemented in this DIP; `leader_confirm` / `leader_reject` / `admin_override` paths remain EPIC-6 scope and are not touched here beyond the column existing.
2. Naming has already diverged from the Engineering Spec's literal table/column names in the actual codebase — this DIP follows what's real, not what the spec says verbatim:
   * `events.status` (spec's data model says `state`) — confirmed in migration `20260629000002`/`000003`.
   * `event_attendees` (spec says `event_expected_members`) — confirmed in migration `20260629000002`.
   * `event_notifications` (spec says `notification_schedules`) — confirmed in migration `20260629000002`. Do not "correct" these to match spec naming as part of this DIP — that's an unrelated, high-blast-radius rename with no story driving it.
3. Pre-existing architecture gap found, flagged, not fixed here: `handle_event_scheduling()` (migration `20260629000003`) inserts a `LEADER_CONFIRMATION` `event_notifications` row unconditionally, once per event, at scheduling time. Engineering Spec §7 (STORY-8.3) requires this notification to be created dynamically, per member, only when that member submits a Yes self-report — the current mechanism cannot satisfy that; it fires before any self-report exists. This is currently inert only because no notification worker consumes `event_notifications` rows yet (EPIC-8 not built). Do not build a second/competing mechanism in this DIP. The Yes self-report path below leaves an explicit TODO rather than inserting its own notification row — building the correct dynamic dispatch is EPIC-8/WP-8 scope. Recommend a tech-debt ticket alongside FP-43/FP-44.
4. Canonical error codes (Engineering Spec §6) must be used precisely — the merged FP-16/FP-17 PR used ad hoc `NOT_AN_ATTENDEE` and `INVALID_STATE`, which are not in the spec's Standard Error Code list. The canonical equivalents are `FORBIDDEN_SCOPE` (not an expected attendee) and `ATTENDANCE_NOT_OPEN` (event closed to member actions). This DIP uses the canonical codes: `FORBIDDEN_SCOPE`, `ATTENDANCE_NOT_OPEN`, `SELF_REPORT_NOT_OPEN`, `SELF_REPORT_ALREADY_SUBMITTED`, `SELF_REPORT_REASON_REQUIRED`, `VALIDATION_ERROR`. Not proposing to reopen FP-16/FP-17 for this — flagging the drift as a known gap, not fixing it retroactively.
5. Dual-write atomicity — `supabase-js` cannot transact across two `.from()` calls. The No self-report path writes to two tables (`member_attendance_reports` + `attendance`) and both must succeed or neither should. A naive two-step client-side write risks an orphaned self-report with no attendance row if the second call fails. This DIP implements that specific path as a single `SECURITY DEFINER` Postgres function (`submit_self_report_no`), so both inserts happen inside one true transaction. The Yes path is a single-table insert and does not need this.
6. Formation-completion invariant (Rule 4) respected structurally: `PENDING_CONFIRMATION` self-reports and `DID_NOT_ATTEND` attendance rows must never complete a Talk — only `attendance_status = ATTENDED` does, and nothing in this DIP writes `ATTENDED` (that's exclusively EPIC-6's leader-confirm/admin-override paths). No formation-table code exists yet regardless (`talks` doesn't exist — FP-29/STORY-7.1 still blocked), so this is a forward-looking guarantee, not an active check.
7. Audit logging gap — same flagged-not-patched treatment as FP-16/FP-17. `audit_logs` still doesn't exist. TODO hooks added at both write points (self-report creation, auto-attendance creation) rather than skipping silently or building an ad hoc audit table.
8. Idempotency gap — same treatment. Engineering Spec names `(tenant_id, event_id, member_id)` as the natural idempotency key for self-report, but `idempotency_records` doesn't exist (EPIC-2/WP-2 foundational gap, same as the audit gap). The unique constraint on `member_attendance_reports` provides a hard backstop against duplicate submission even without formal idempotency-key replay semantics; noting the gap rather than building the full idempotency system here.
9. RLS is defense-in-depth only, consistent with the FP-16/FP-17 precedent — the repository layer uses the service-role client throughout (matching the established convention from `rsvp.repository.ts`), so these RLS policies won't be exercised in the normal request path. Included anyway as a backstop against any future direct-Supabase access (e.g. a mobile client bypassing the web API). Not a new pattern — matching what's already there.
10. No conflicts between FP-19/FP-20's acceptance criteria and PDD/PIB/BA Pack invariants. Proceed as scoped.
Implementation Plan

1. Migration — create `member_attendance_reports` and `attendance` tables per Engineering Spec §3, with:
   * `member_attendance_reports`: CHECK enforcing `reason` required when `self_report_status = 'SELF_REPORTED_NO'`; CHECK forbidding `feedback`/`star_rating` unless `self_report_status = 'SELF_REPORTED_YES'`; CHECK `star_rating BETWEEN 1 AND 5` when present; CHECK `char_length(feedback) <= 1000` when present; CHECK confirmation_status/self_report_status consistency (`NO` ⇒ `NOT_REQUIRED`; never `NO` ⇒ `CONFIRMED`/`REJECTED`/`PENDING_CONFIRMATION`). Unique on `(tenant_id, event_id, member_id)` — hard re-submission guard at the DB layer.
   * `attendance`: CHECK `confirmation_type = 'no_self_report_auto'` ⇒ `confirmed_by IS NULL` (no human confirmer for an auto-resolution) and `self_report_id IS NOT NULL` (must trace back to the No self-report that triggered it). Unique on `(tenant_id, event_id, member_id)`.
   * Cross-tenant validation triggers on both tables (same pattern as `rsvps` in FP-16/FP-17 — a bare FK doesn't verify tenant match).
   * `submit_self_report_no(...)` function — the atomic dual-write described in Grounding Check item 5.
   * RLS: tenant-wide SELECT on both tables; INSERT on `member_attendance_reports` restricted to the member's own resolved row.
2. Repository/service layer — `src/features/self-reports/`. Service function (`submitSelfReport`) performs, in order:
   * Resolve `tenant_id`/`member_id` from session — never from client body.
   * Confirm member is an expected attendee (`event_attendees` row exists). If not → `FORBIDDEN_SCOPE`.
   * Call `block_actions_on_cancelled_or_locked(event_id)`. If true → `ATTENDANCE_NOT_OPEN`. (Technically redundant with the status check below, since CANCELLED/LOCKED are never COMPLETED — kept anyway for consistency with the FP-16/FP-17 precedent of treating this guard function as the single source of truth for "event closed to member actions," per its own documented contract in migration `20260629000005`.)
   * Fetch event; confirm `status = 'COMPLETED'`. If not → `SELF_REPORT_NOT_OPEN`.
   * Confirm no existing `member_attendance_reports` row for `(tenant_id, event_id, member_id)`. If one exists → `SELF_REPORT_ALREADY_SUBMITTED`.
   * If `self_report_status = 'SELF_REPORTED_NO'`: reason required (non-empty) → else `SELF_REPORT_REASON_REQUIRED`. If `feedback` or `star_rating` were provided → `VALIDATION_ERROR` (these are Yes-only per spec; reject explicitly rather than silently dropping data). Call `submit_self_report_no(...)` RPC for the atomic dual-write.
   * If `self_report_status = 'SELF_REPORTED_YES'`: validate `feedback` ≤1000 chars if present (`VALIDATION_ERROR` otherwise), `star_rating` integer 1–5 if present (`VALIDATION_ERROR` otherwise). `reason`, if accidentally provided, is ignored/stored as null (lower-stakes than the Yes-only fields on No — not worth a hard rejection). Single insert into `member_attendance_reports` with `confirmation_status = 'PENDING_CONFIRMATION'`. Leave the TODO noted in Grounding Check item 3 rather than inserting any notification row.
3. Route Handler — `POST /api/self-reports`, body `{ event_id, self_report_status: 'SELF_REPORTED_YES' | 'SELF_REPORTED_NO', reason?, feedback?, star_rating? }`. Response: the created `member_attendance_reports` row (`id, event_id, member_id, self_report_status, reason, feedback, star_rating, confirmation_status, submitted_at`).
4. Audit TODO hooks — one in `submit_self_report_no` (SQL comment, since that's where both writes happen) and one in the Yes-path service function, both referencing Engineering Spec §6's documented audit structures for self-report create and no-self-report auto-resolve.
5. Regression guard — confirm no code path here writes `attendance_status = 'ATTENDED'`, references `self_reported_status` or `leader_confirmed_status` (banned field names per Dev Execution Packet Coding Notes), or creates any route at `/attendance/self-report`.
Files to Create/Modify

* `supabase/migrations/20260629000008_self_reports_and_attendance.sql`
* `src/features/self-reports/self-report.types.ts`
* `src/features/self-reports/self-report.repository.ts`
* `src/features/self-reports/self-report.service.ts`
* `src/app/api/self-reports/route.ts`
* Existing inline error-code usage — extend with `SELF_REPORT_REASON_REQUIRED`, `SELF_REPORT_ALREADY_SUBMITTED`, `SELF_REPORT_NOT_OPEN`, `FORBIDDEN_SCOPE`, `ATTENDANCE_NOT_OPEN` (no shared module exists per FP-16/FP-17 findings — follow the same inline-string convention, do not create one)
Migration File
`supabase/migrations/20260629000008_self_reports_and_attendance.sql`

```sql
-- DIP-FP-19-FP-20: Post-event self-report submission, reason enforcement on No,
-- official attendance table created (full canonical schema, ahead of EPIC-6),
-- atomic dual-write for auto-resolved No self-reports.


-- ==============================================================
-- SECTION 1: member_attendance_reports table
-- ==============================================================

CREATE TABLE IF NOT EXISTS member_attendance_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    self_report_status TEXT NOT NULL CHECK (self_report_status IN ('SELF_REPORTED_YES', 'SELF_REPORTED_NO')),
    reason TEXT,
    feedback TEXT,
    star_rating INT,
    confirmation_status TEXT NOT NULL CHECK (confirmation_status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'NOT_REQUIRED')),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT self_reports_reason_required_check CHECK (
        self_report_status = 'SELF_REPORTED_YES'
        OR (self_report_status = 'SELF_REPORTED_NO' AND reason IS NOT NULL AND btrim(reason) <> '')
    ),
    CONSTRAINT self_reports_yes_only_fields_check CHECK (
        self_report_status = 'SELF_REPORTED_YES'
        OR (feedback IS NULL AND star_rating IS NULL)
    ),
    CONSTRAINT self_reports_feedback_length_check CHECK (
        feedback IS NULL OR char_length(feedback) <= 1000
    ),
    CONSTRAINT self_reports_star_rating_range_check CHECK (
        star_rating IS NULL OR (star_rating >= 1 AND star_rating <= 5)
    ),
    CONSTRAINT self_reports_no_confirmation_status_check CHECK (
        self_report_status <> 'SELF_REPORTED_NO' OR confirmation_status = 'NOT_REQUIRED'
    ),
    CONSTRAINT self_reports_yes_confirmation_status_check CHECK (
        self_report_status <> 'SELF_REPORTED_YES' OR confirmation_status <> 'NOT_REQUIRED'
    )
);

ALTER TABLE member_attendance_reports ENABLE ROW LEVEL SECURITY;

-- Hard re-submission guard: one report per (tenant, event, member), ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_self_reports_unique_event_member
    ON member_attendance_reports(tenant_id, event_id, member_id);


-- ==============================================================
-- SECTION 2: attendance table
--
-- Full canonical schema per Engineering Spec §3, created now because
-- FP-20 requires an immediate write path, ahead of EPIC-6 (leader
-- confirm/reject, admin override). Only 'no_self_report_auto' is
-- populated by this migration's function; other confirmation_type
-- values are structurally supported but not yet written by any code.
-- ==============================================================

CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    attendance_status TEXT NOT NULL CHECK (attendance_status IN ('ATTENDED', 'DID_NOT_ATTEND')),
    self_report_id UUID REFERENCES member_attendance_reports(id),
    confirmed_by UUID REFERENCES members(id),
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmation_type TEXT NOT NULL CHECK (
        confirmation_type IN ('leader_confirm', 'leader_reject', 'no_self_report_auto', 'admin_override')
    ),
    leader_note TEXT,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT attendance_auto_no_confirmer_check CHECK (
        confirmation_type <> 'no_self_report_auto' OR confirmed_by IS NULL
    ),
    CONSTRAINT attendance_auto_requires_self_report_check CHECK (
        confirmation_type <> 'no_self_report_auto' OR self_report_id IS NOT NULL
    )
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_event_member
    ON attendance(tenant_id, event_id, member_id);


-- ==============================================================
-- SECTION 3: Cross-tenant referential safety triggers
--
-- Same defense-in-depth class as rsvps' trigger from FP-16/FP-17 —
-- a bare FK does not verify the referenced row's tenant matches.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_self_report_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'member_attendance_reports.event_id % does not belong to tenant %', NEW.event_id, NEW.tenant_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'member_attendance_reports.member_id % does not belong to tenant %', NEW.member_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_self_report_tenant_scope ON member_attendance_reports;

CREATE TRIGGER trigger_validate_self_report_tenant_scope
BEFORE INSERT OR UPDATE ON member_attendance_reports
FOR EACH ROW EXECUTE FUNCTION validate_self_report_tenant_scope();


CREATE OR REPLACE FUNCTION public.validate_attendance_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'attendance.event_id % does not belong to tenant %', NEW.event_id, NEW.tenant_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'attendance.member_id % does not belong to tenant %', NEW.member_id, NEW.tenant_id;
  END IF;
  IF NEW.self_report_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM member_attendance_reports WHERE id = NEW.self_report_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'attendance.self_report_id % does not belong to tenant %', NEW.self_report_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_attendance_tenant_scope ON attendance;

CREATE TRIGGER trigger_validate_attendance_tenant_scope
BEFORE INSERT OR UPDATE ON attendance
FOR EACH ROW EXECUTE FUNCTION validate_attendance_tenant_scope();


-- ==============================================================
-- SECTION 4: submit_self_report_no() — atomic dual-write
--
-- supabase-js cannot transact across two separate .from() calls
-- from the client. This function performs both inserts inside a
-- single PL/pgSQL function body, which is one transaction. Caller
-- (service layer) is responsible for pre-validation (attendee
-- check, event status, duplicate check, reason presence) — this
-- function trusts its inputs and focuses solely on atomicity.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.submit_self_report_no(
    p_tenant_id UUID,
    p_event_id UUID,
    p_member_id UUID,
    p_reason TEXT
)
RETURNS TABLE (self_report_id UUID, attendance_id UUID, submitted_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_report_id UUID;
  v_attendance_id UUID;
  v_submitted_at TIMESTAMPTZ := now();
BEGIN
  INSERT INTO member_attendance_reports (
    tenant_id, event_id, member_id, self_report_status, reason, confirmation_status, submitted_at
  ) VALUES (
    p_tenant_id, p_event_id, p_member_id, 'SELF_REPORTED_NO', p_reason, 'NOT_REQUIRED', v_submitted_at
  )
  RETURNING id INTO v_report_id;

  INSERT INTO attendance (
    tenant_id, event_id, member_id, attendance_status, self_report_id,
    confirmed_by, confirmed_at, confirmation_type, version
  ) VALUES (
    p_tenant_id, p_event_id, p_member_id, 'DID_NOT_ATTEND', v_report_id,
    NULL, v_submitted_at, 'no_self_report_auto', 1
  )
  RETURNING id INTO v_attendance_id;

  -- TODO(EPIC-10): write audit_logs entries for both the self-report create and the
  -- no_self_report_auto attendance resolution once audit_logs table and audit.service
  -- exist — see Engineering Spec §6 (two distinct audit structures documented there,
  -- do not collapse into a single entry).

  RETURN QUERY SELECT v_report_id, v_attendance_id, v_submitted_at;
END;
$$;


-- ==============================================================
-- SECTION 5: RLS policies
--
-- Defense-in-depth only, consistent with FP-16/FP-17: the repository
-- layer uses the service-role client throughout, so these policies
-- are not exercised in the normal request path today.
-- ==============================================================

CREATE POLICY "self_reports_select" ON member_attendance_reports
    FOR SELECT
    USING (tenant_id = get_tenant_id());

CREATE POLICY "self_reports_insert_self" ON member_attendance_reports
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.id = member_id
              AND m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.deleted_at IS NULL
        )
    );

CREATE POLICY "attendance_select" ON attendance
    FOR SELECT
    USING (tenant_id = get_tenant_id());

-- No general INSERT/UPDATE policy on attendance for members, leaders, or admins yet —
-- the only write path this DIP implements goes through submit_self_report_no(), a
-- SECURITY DEFINER function that does not depend on the caller's RLS context. EPIC-6
-- will need to add leader/admin-scoped policies for leader_confirm/leader_reject/
-- admin_override — not added here since nothing in FP-19/FP-20 needs them.

```

Branch Name
`feature/FP-19-20-self-report-submission`
Commit Message
`FP-19, FP-20: Implement self-report submission with reason enforcement and atomic official-attendance auto-resolution`
Pull Request Description
Implements STORY-5.1 (FP-19):

* ✅ Member can submit Yes/No self-report only after `event.status = 'COMPLETED'` (`SELF_REPORT_NOT_OPEN` otherwise)
* ✅ Yes self-report accepts optional `feedback` (≤1000 chars) and optional `star_rating` (1–5), both DB- and app-validated
* ✅ Yes self-report saved as `SELF_REPORTED_YES` with `confirmation_status = PENDING_CONFIRMATION`
* ✅ Re-submission blocked — unique constraint on `(tenant_id, event_id, member_id)` plus a proactive `SELF_REPORT_ALREADY_SUBMITTED` app-layer check
* ✅ Self-report stored in its own table, structurally separate from `attendance`
Implements STORY-5.2 (FP-20):

* ✅ No without reason rejected with `SELF_REPORT_REASON_REQUIRED`
* ✅ No with reason accepted
* ✅ No self-report immediately creates official `attendance_status = DID_NOT_ATTEND` — via the atomic `submit_self_report_no()` function, no leader confirmation involved
* ✅ No leader notification generated for a No self-report — confirmed no notification-insert code path exists for this case
Also included (not separately ticketed, but load-bearing):

* `attendance` table created for the first time, full canonical schema per Engineering Spec §3, ahead of EPIC-6
* Atomic dual-write (`submit_self_report_no`) closing a real data-consistency gap that a naive two-call client implementation would have introduced
* Cross-tenant referential safety triggers on both new tables, same class as the `rsvps` trigger from FP-16/FP-17
* Canonical error codes (`FORBIDDEN_SCOPE`, `ATTENDANCE_NOT_OPEN`) used instead of the ad hoc codes the FP-16/FP-17 PR introduced — flagging that earlier drift, not fixing it retroactively
* Audit TODO hooks for both the self-report-create and no-self-report-auto-resolve audit structures documented in Engineering Spec §6
Flagged, explicitly not fixed in this PR:

* `handle_event_scheduling()` (migration `20260629000003`) creates a `LEADER_CONFIRMATION` notification row unconditionally at scheduling time, not dynamically per Yes self-report as spec requires. Currently inert (no notification worker exists). Recommend a tech-debt ticket for EPIC-8/WP-8 — do not let this get "fixed" as a side effect of building the worker without someone deciding what the correct dynamic-dispatch mechanism should replace it with.
Known assumptions (flag for review):

* On a Yes self-report, an accidentally-provided `reason` field is silently ignored (stored null) rather than rejected — asymmetric with the strict rejection of `feedback`/`star_rating` on a No self-report, which the spec explicitly scopes to Yes-only. Judgment call; can be tightened to a hard rejection if you'd rather be strict both directions.
Jira Linkage

* PDEEpicID: FP-18 (EPIC-5 — Self-Report Management)
* PDEStoryID: FP-19 (STORY-5.1 — Submit Post-Event Attendance Self-Report)
* PDEStoryID: FP-20 (STORY-5.2 — Enforce Self-Report No Reason Requirement)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-19-FP-20.md` and do not append executor notes, observations, or any other content to that file after the initial save — the file must remain byte-for-byte what was provided here. Executor observations (deviations, omissions, assumptions made during implementation) belong exclusively in the PR description, not in the DIP record.
Create the feature branch, apply the migration locally via `supabase db reset` and confirm it runs cleanly, implement the application code, commit, push, and open the PR against `dev` using `gh pr create --base dev`.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
