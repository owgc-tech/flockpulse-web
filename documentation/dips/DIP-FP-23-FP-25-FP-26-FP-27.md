DIP-FP-23-FP-25-FP-26-FP-27 — Leader Confirmation, Admin Override, Confirmation Context, Lock Enforcement
Covers: STORY-6.2 (FP-23) — Confirm or Reject Member Self-Report Covers: STORY-6.4 (FP-25) — Admin Override of Official Attendance Covers: STORY-6.5 (FP-26) — View Self-Report Context During Confirmation Covers: STORY-6.6 (FP-27) — Lock Official Attendance Records Epic: EPIC-6 — Leader Confirmation Workflow (FP-21) Work Package: WP-7 (Developer Execution Packet)
Not covered — deliberately excluded:

* FP-22 (STORY-6.1) — requires actual push notification delivery; no notification worker exists (EPIC-8 gap, already tracked as FP-46). Held back rather than half-built.
* FP-24 (STORY-6.3) — two of its three ACs are already satisfied by `submit_self_report_no()` (FP-19/FP-20, merged); its third AC ("Record is audited") is blocked on the same `audit_logs` gap as everything else. No new work needed here; verify and update Jira separately, not part of this DIP.
Story Summary
A member's "Yes" self-report sits at `confirmation_status = PENDING_CONFIRMATION` until a Pastoral Leader acts on it. This DIP implements that action: a leader can Confirm (→ official `attendance_status = ATTENDED`) or Reject (→ `DID_NOT_ATTEND`) a self-report, scoped to only the members assigned to them. Separately, an Admin can override official attendance for any expected member at any time, regardless of self-report state, superseding whatever a leader or the auto-resolution mechanism previously set. Both actions are blocked once an event is `LOCKED` (or `CANCELLED`) — the same guard already built in FP-13 and reused, not reimplemented. A supporting read endpoint gives leaders the self-report context (feedback, star rating, RSVP status/reason) they need to actually make the confirm/reject decision.
FP-27 (lock enforcement) is not implemented as separate code — it's the same `block_actions_on_cancelled_or_locked()` guard from FP-13, applied to these two new write paths. There's no independent "lock enforcement" logic to build; it's a constraint on FP-23 and FP-25's own service functions. That's why it's combined here rather than drafted on its own.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`. Per the PDD, leader confirmation is a mobile day-to-day action — but consistent with every prior EPIC-4/5 DIP, this builds the backend API only. No mobile UI in scope. (Admin override, per the system prompt's own stack section, is explicitly a web feature — but this DIP still only builds its API; a dedicated admin-override screen is separate, unscoped work, same conversation as the one earlier in this session about EPIC-6 being the first place a real web screen would make sense.)
Grounding Check

1. "Assigned members" is the `assignments` table, not a `members` column. FP-23's AC ("Leader can only confirm for assigned members") and FP-26's AC ("Only assigned members are visible to the leader") are both satisfied by querying `assignments WHERE assignment_type = 'LEADER' AND leader_member_id = <caller> AND deleted_at IS NULL` — the same table and same `LEADER` assignment type already established in FP-REMEDIATION-1. There is no `members.pastoral_leader_id` column in the actual schema (that name appears in the Engineering Spec's canonical model and was incorrectly carried into FP-46's ticket description last session — worth a correction there, not in scope here).
2. Additive RBAC (Section 4, Rule 3) — Admin ⊇ Leader. Admin can confirm/reject for any member, not just assigned ones — the leader-scope restriction applies only to the `LEADER` role. Admin-only for override (FP-25 has no leader path at all).
3. This is the first DIP requiring role enforcement beyond "any authenticated member." Every prior endpoint (RSVP, self-report) was open to any member. Confirm/reject and override need to check `role IN ('LEADER', 'ADMIN')` and `role = 'ADMIN'` respectively. Inspect `src/lib/auth/middleware.ts` / `withAuth` first to confirm how role is actually exposed on `ctx` before implementing — don't assume a shape that hasn't been observed in this codebase yet.
4. Lock/cancel enforcement (FP-27) reuses `block_actions_on_cancelled_or_locked()` — no new guard is built. Same function from FP-13, already proven correct across two prior stories and the FP-47 rewrite. Call it in both new service functions before any write.
5. Row-level audit fields vs. the `audit_logs` system gap — these are different things, don't conflate them. FP-23's AC ("Confirmation is audited with `confirmed_by` and `confirmed_at`") and FP-25's AC ("Override is audited with `actor_id`, `reason`, and `timestamp`") are satisfied by the `attendance` table's own `confirmed_by`/`confirmed_at`/`leader_note` columns, which this DIP populates correctly — that's real, working provenance tracking, not a gap. The still-missing `audit_logs` table (EPIC-10) is a separate, deeper system-wide audit trail; leave the same TODO-hook treatment as FP-16/17 and FP-19/20 for that layer, but don't let its absence be mistaken for these ACs being unmet — they aren't.
6. `attendance` needs upsert semantics for admin override, but not for leader confirm/reject. A leader's confirm/reject should only ever fire once per self-report (enforced by requiring `confirmation_status = 'PENDING_CONFIRMATION'` before acting) — implemented as a plain `INSERT`, where a unique-index conflict surfaces as a real error (a race/double-fire), not something to silently overwrite. Admin override is explicitly allowed to happen repeatedly and supersede any prior state (leader decision or auto-resolution) — implemented as `INSERT ... ON CONFLICT (tenant_id, event_id, member_id) DO UPDATE`, incrementing `version`. These are two different write patterns for a reason; don't collapse them into one shared function.
7. `self_report_id` is preserved on admin override, not nulled out. If a self-report previously resolved the attendance row (leader action or auto-resolution) and an admin later overrides it, the historical link to that self-report stays intact — the override changes the official outcome, not the historical record of what triggered it originally.
8. Existing `attendance` CHECK constraints need tightening. The current constraint only enforces `confirmed_by IS NULL` for `no_self_report_auto`; it doesn't yet enforce the inverse — that `leader_confirm`/`leader_reject`/`admin_override` require a non-null `confirmed_by`. Add that now, since this DIP is what actually populates those paths for the first time.
9. Cross-tenant trigger on `attendance` doesn't yet validate `confirmed_by`'s tenant. The existing trigger (FP-19/20) checks `event_id`/`member_id`/`self_report_id` tenant match but was written before any code populated `confirmed_by`. Extend it now.
10. No conflicts with Section 4 invariants. `ATTENDED` is produced only by leader confirm or admin override, exactly as Rule 1 requires — nothing here writes `ATTENDED` any other way.
Implementation Plan

1. Migration:
   * Tighten `attendance` CHECK: `confirmation_type = 'no_self_report_auto' OR confirmed_by IS NOT NULL` (new constraint, complements the existing inverse one).
   * Extend `validate_attendance_tenant_scope()` to also check `confirmed_by`'s tenant when not null.
   * `resolve_leader_confirmation(p_tenant_id, p_self_report_id, p_leader_member_id, p_decision, p_leader_note)` — atomic function: locks the target `member_attendance_reports` row (`FOR UPDATE`), verifies `confirmation_status = 'PENDING_CONFIRMATION'` (else raises — this is the real race-safety guarantee, not just an app-layer nicety), updates it to `CONFIRMED`/`REJECTED`, and `INSERT`s the corresponding `attendance` row (`leader_confirm`/`leader_reject`, `attendance_status` = `ATTENDED`/`DID_NOT_ATTEND`) — same atomic-dual-write pattern as `submit_self_report_no()` from FP-19/20.
   * `admin_override_attendance(p_tenant_id, p_event_id, p_member_id, p_attendance_status, p_admin_member_id, p_reason)` — upsert into `attendance`, `confirmation_type = 'admin_override'`, preserving existing `self_report_id` on conflict, incrementing `version`.
   * RLS: add scoped INSERT/UPDATE policies on `attendance` for leader and admin actions, matching the FP-19/20 precedent — defense-in-depth only, since the repository layer will use the service-role client throughout, consistent with every prior story.
2. Confirmation service (`src/features/confirmations/`):
   * `GET` path (FP-26): resolve caller's role. If `LEADER`, get assigned member IDs from `assignments`; if `ADMIN`, no filter (all tenant members); `MEMBER` → `FORBIDDEN_ROLE`. Query `member_attendance_reports` where `confirmation_status = 'PENDING_CONFIRMATION'` and `member_id` in scope, joined with `members` (name) and `rsvps` (status/reason, if present) for context.
   * `POST` path (FP-23): resolve caller's role (`LEADER` or `ADMIN` only). Fetch the target self-report; confirm it exists and belongs to the tenant (`NOT_FOUND`). If caller is `LEADER`, confirm the self-report's `member_id` is in their assigned set (`FORBIDDEN_SCOPE` otherwise) — `ADMIN` skips this check per Rule 3. Confirm `confirmation_status = 'PENDING_CONFIRMATION'` (`CONFIRMATION_NOT_ALLOWED` otherwise — canonical error code, not an invented one). Call `block_actions_on_cancelled_or_locked(event_id)` (`ATTENDANCE_NOT_OPEN` if true — this is FP-27). Call `resolve_leader_confirmation(...)`.
3. Attendance-override service (`src/features/attendance-overrides/`):
   * `POST` path (FP-25): resolve caller's role — `ADMIN` only (`FORBIDDEN_ROLE` otherwise). Confirm the target member is an expected attendee of the event (`event_attendees` row exists — `NOT_FOUND` or `FORBIDDEN_SCOPE` otherwise, consistent with how RSVP/self-report already gate on this). Call `block_actions_on_cancelled_or_locked(event_id)` (`ATTENDANCE_NOT_OPEN` if true — FP-27 again). Validate `attendance_status IN ('ATTENDED', 'DID_NOT_ATTEND')` (`INVALID_TARGET` otherwise — canonical code). Call `admin_override_attendance(...)`.
4. Audit TODO hooks — one in each new SQL function, same pattern and wording style as FP-19/20's, referencing Engineering Spec §6.
5. Regression guard — confirm no code path here writes to `member_attendance_reports.self_report_status` (only `confirmation_status` changes at this stage) and that `no_self_report_auto` rows are never touched by either new function (they're already terminal — no leader or admin action is implied by FP-23/25's ACs for that case, and none is built here).
Files to Create/Modify

* `supabase/migrations/20260629000010_leader_confirmation_and_override.sql`
* `src/features/confirmations/confirmation.types.ts`
* `src/features/confirmations/confirmation.repository.ts`
* `src/features/confirmations/confirmation.service.ts`
* `src/app/api/confirmations/pending/route.ts` (GET — FP-26)
* `src/app/api/confirmations/[selfReportId]/route.ts` (POST — FP-23)
* `src/features/attendance-overrides/attendance-override.types.ts`
* `src/features/attendance-overrides/attendance-override.repository.ts`
* `src/features/attendance-overrides/attendance-override.service.ts`
* `src/app/api/attendance/override/route.ts` (POST — FP-25)
* `documentation/test-plans/FP-23-25-26-27-leader-confirmation-checklist.md`
Migration File
`supabase/migrations/20260629000010_leader_confirmation_and_override.sql`

```sql
-- DIP-FP-23-FP-25-FP-26-FP-27: Leader confirm/reject, admin override, confirmation context,
-- lock enforcement (reuses block_actions_on_cancelled_or_locked — no new guard built here).


-- ==============================================================
-- SECTION 1: Tighten attendance CHECK — non-auto paths require a confirmer
--
-- Complements the existing attendance_auto_no_confirmer_check (FP-19/20),
-- which only enforced the inverse. This DIP is what actually populates
-- confirmed_by for the first time, so the constraint needs both directions.
-- ==============================================================

ALTER TABLE attendance
    ADD CONSTRAINT attendance_non_auto_requires_confirmer_check CHECK (
        confirmation_type = 'no_self_report_auto' OR confirmed_by IS NOT NULL
    );


-- ==============================================================
-- SECTION 2: Extend cross-tenant trigger to validate confirmed_by
--
-- The FP-19/20 version checked event_id/member_id/self_report_id but
-- was written before any code populated confirmed_by.
-- ==============================================================

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
  IF NEW.confirmed_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM members WHERE id = NEW.confirmed_by AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'attendance.confirmed_by % does not belong to tenant %', NEW.confirmed_by, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger itself is unchanged (still fires BEFORE INSERT OR UPDATE), only the function body changed.


-- ==============================================================
-- SECTION 3: resolve_leader_confirmation() — atomic dual-write, race-safe
--
-- Locks the target self-report row before checking its confirmation_status,
-- so two concurrent confirm attempts on the same self-report can't both
-- succeed — the second one hits the PENDING_CONFIRMATION check after the
-- first has already moved it, and raises rather than silently double-writing.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.resolve_leader_confirmation(
    p_tenant_id UUID,
    p_self_report_id UUID,
    p_leader_member_id UUID,
    p_decision TEXT,  -- 'CONFIRM' or 'REJECT'
    p_leader_note TEXT
)
RETURNS TABLE (attendance_id UUID, confirmation_status TEXT, confirmed_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event_id UUID;
  v_member_id UUID;
  v_current_status TEXT;
  v_new_confirmation_status TEXT;
  v_attendance_status TEXT;
  v_confirmation_type TEXT;
  v_attendance_id UUID;
  v_confirmed_at TIMESTAMPTZ := now();
BEGIN
  SELECT event_id, member_id, confirmation_status
  INTO v_event_id, v_member_id, v_current_status
  FROM member_attendance_reports
  WHERE id = p_self_report_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'self-report % not found for tenant %', p_self_report_id, p_tenant_id;
  END IF;

  IF v_current_status <> 'PENDING_CONFIRMATION' THEN
    RAISE EXCEPTION 'self-report % is not pending confirmation (current: %)', p_self_report_id, v_current_status;
  END IF;

  IF p_decision = 'CONFIRM' THEN
    v_new_confirmation_status := 'CONFIRMED';
    v_attendance_status := 'ATTENDED';
    v_confirmation_type := 'leader_confirm';
  ELSE
    v_new_confirmation_status := 'REJECTED';
    v_attendance_status := 'DID_NOT_ATTEND';
    v_confirmation_type := 'leader_reject';
  END IF;

  UPDATE member_attendance_reports
  SET confirmation_status = v_new_confirmation_status, updated_at = v_confirmed_at
  WHERE id = p_self_report_id;

  INSERT INTO attendance (
    tenant_id, event_id, member_id, attendance_status, self_report_id,
    confirmed_by, confirmed_at, confirmation_type, leader_note, version
  ) VALUES (
    p_tenant_id, v_event_id, v_member_id, v_attendance_status, p_self_report_id,
    p_leader_member_id, v_confirmed_at, v_confirmation_type, p_leader_note, 1
  )
  RETURNING id INTO v_attendance_id;

  -- TODO(EPIC-10): write audit_logs entry for leader confirmation/rejection once
  -- audit_logs table and audit.service exist — see Engineering Spec §6. Note:
  -- confirmed_by/confirmed_at on the attendance row itself already satisfy FP-23's
  -- "audited" AC; this TODO is for the separate, deeper system-wide audit trail.

  RETURN QUERY SELECT v_attendance_id, v_new_confirmation_status, v_confirmed_at;
END;
$$;


-- ==============================================================
-- SECTION 4: admin_override_attendance() — upsert, supersedes any prior state
--
-- Unlike resolve_leader_confirmation, this is explicitly repeatable and
-- always wins over whatever was there before (leader decision or auto-
-- resolution) — "regardless of self-report status" per FP-25's AC.
-- self_report_id is preserved on conflict, not nulled — the override
-- changes the official outcome, not the historical record of what
-- originally triggered the row.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.admin_override_attendance(
    p_tenant_id UUID,
    p_event_id UUID,
    p_member_id UUID,
    p_attendance_status TEXT,  -- 'ATTENDED' or 'DID_NOT_ATTEND'
    p_admin_member_id UUID,
    p_reason TEXT
)
RETURNS TABLE (attendance_id UUID, version INT, confirmed_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_attendance_id UUID;
  v_version INT;
  v_confirmed_at TIMESTAMPTZ := now();
BEGIN
  INSERT INTO attendance (
    tenant_id, event_id, member_id, attendance_status, self_report_id,
    confirmed_by, confirmed_at, confirmation_type, leader_note, version
  ) VALUES (
    p_tenant_id, p_event_id, p_member_id, p_attendance_status, NULL,
    p_admin_member_id, v_confirmed_at, 'admin_override', p_reason, 1
  )
  ON CONFLICT (tenant_id, event_id, member_id) DO UPDATE SET
    attendance_status = EXCLUDED.attendance_status,
    self_report_id = attendance.self_report_id,  -- preserved, not overwritten
    confirmed_by = EXCLUDED.confirmed_by,
    confirmed_at = EXCLUDED.confirmed_at,
    confirmation_type = 'admin_override',
    leader_note = EXCLUDED.leader_note,
    version = attendance.version + 1,
    updated_at = v_confirmed_at
  RETURNING id, version INTO v_attendance_id, v_version;

  -- TODO(EPIC-10): write audit_logs entry for admin override once audit_logs table
  -- and audit.service exist — see Engineering Spec §6. confirmed_by/leader_note/
  -- confirmed_at on the row itself already satisfy FP-25's "audited" AC.

  RETURN QUERY SELECT v_attendance_id, v_version, v_confirmed_at;
END;
$$;


-- ==============================================================
-- SECTION 5: RLS — defense-in-depth only, consistent with FP-16/17 and FP-19/20
-- ==============================================================

CREATE POLICY "attendance_leader_insert" ON attendance
    FOR INSERT
    WITH CHECK (
        tenant_id = get_tenant_id()
        AND confirmation_type IN ('leader_confirm', 'leader_reject')
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.id = confirmed_by
              AND m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.role IN ('LEADER', 'ADMIN')
              AND m.deleted_at IS NULL
        )
    );

CREATE POLICY "attendance_admin_upsert" ON attendance
    FOR ALL
    USING (
        tenant_id = get_tenant_id()
        AND EXISTS (
            SELECT 1 FROM members m
            WHERE m.user_id = auth.uid()
              AND m.tenant_id = get_tenant_id()
              AND m.role = 'ADMIN'
              AND m.deleted_at IS NULL
        )
    )
    WITH CHECK (tenant_id = get_tenant_id() AND confirmation_type = 'admin_override');

```

Branch Name
`feature/FP-23-25-26-27-leader-confirmation`
Commit Message
`FP-23, FP-25, FP-26, FP-27: Implement leader confirm/reject, admin override, confirmation context, and lock enforcement`
Pull Request Description
Implements STORY-6.2 (FP-23):

* ✅ Leader can view member name, event, self-report timestamp, feedback, star rating — via `GET /api/confirmations/pending` (shared with FP-26)
* ✅ Confirm → `attendance_status = ATTENDED`; Reject → `DID_NOT_ATTEND` — via `resolve_leader_confirmation()`
* ✅ Confirmation is final — enforced by the `PENDING_CONFIRMATION` precondition inside the atomic function; a second attempt raises rather than silently re-applying
* ✅ Leader can only confirm for assigned members — `assignments` table (`assignment_type = 'LEADER'`), `FORBIDDEN_SCOPE` otherwise; Admin bypasses per additive RBAC
* ✅ Audited with `confirmed_by`/`confirmed_at` — populated directly on the `attendance` row
Implements STORY-6.4 (FP-25):

* ✅ Admin can set `ATTENDED` or `DID_NOT_ATTEND` for any expected member — `admin_override_attendance()`, Admin-only
* ✅ Override allowed regardless of self-report status — upsert semantics, no self-report precondition
* ✅ Audited with `actor_id` (`confirmed_by`), `reason` (`leader_note`), timestamp (`confirmed_at`)
* ✅ Blocked after LOCKED — `block_actions_on_cancelled_or_locked()` guard (shared with FP-27, see below)
Implements STORY-6.5 (FP-26):

* ✅ Confirmation screen data (member name, timestamp, feedback, star rating) — `GET /api/confirmations/pending`
* ✅ RSVP status/reason also visible — joined from `rsvps` in the same query
* ✅ Only assigned members visible to leader — same `assignments`-based scoping as FP-23
Implements STORY-6.6 (FP-27):

* ✅ No new independent mechanism — `block_actions_on_cancelled_or_locked()` (FP-13, already proven across two prior stories and the FP-47 rewrite) is called in both `confirmation.service.ts` and `attendance-override.service.ts` before any write, returning `ATTENDANCE_NOT_OPEN` when true.
Not touched, as scoped:

* FP-22 — held pending EPIC-8/FP-46 (notification worker + correct dynamic-dispatch mechanism)
* FP-24 — already satisfied by FP-19/20 except its audit-trail AC, which is the same `audit_logs` gap as everywhere else; not re-implemented here
Correction surfaced during grounding, not part of this PR: FP-46's ticket description references `members.pastoral_leader_id`, which doesn't exist — the real mechanism is `assignments` (`assignment_type = 'LEADER'`), as used throughout this PR. Worth a quick edit to that ticket when EPIC-8 is picked up.
Jira Linkage

* PDEEpicID: FP-21 (EPIC-6 — Leader Confirmation Workflow)
* PDEStoryID: FP-23 (STORY-6.2 — Confirm or Reject Member Self-Report)
* PDEStoryID: FP-25 (STORY-6.4 — Admin Override of Official Attendance)
* PDEStoryID: FP-26 (STORY-6.5 — View Self-Report Context During Confirmation)
* PDEStoryID: FP-27 (STORY-6.6 — Lock Official Attendance Records)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-23-FP-25-FP-26-FP-27.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.
Before writing any code, inspect `src/lib/auth/middleware.ts` (or wherever `withAuth`/`ctx` is defined) to confirm how role is actually exposed — this is the first DIP requiring role enforcement beyond "any authenticated member," and no prior PR has established the pattern to follow.
Create the feature branch, apply the migration locally via `supabase db reset` and confirm it runs cleanly, implement the application code, commit, push, and open the PR against `dev` using `gh pr create --base dev`.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
