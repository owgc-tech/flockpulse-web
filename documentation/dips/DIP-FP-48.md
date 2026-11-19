DIP-FP-48 — Audit Logging: audit_logs Table and Atomic Audit Writes Across All Mutation Paths
Covers: FP-48 (Implement audit_logs table and wire existing audit TODO hooks — scope expanded 2026-07-03 to include event create/update, per direct user decision) Epic: EPIC-10 — Audit & Compliance (FP-40)
Story Summary
Five `TODO(EPIC-10)` hooks already exist in shipped code. This DIP builds the `audit_logs` table and wires all five, plus two newly-discovered gaps (event create/update) found by cross-checking STORY-10.1's actual AC. Two of the seven write paths — RSVP upsert and self-report Yes insert — are currently plain client-side inserts with no transactional guarantee; per explicit user decision, both are converted to `SECURITY DEFINER` SQL functions so their audit writes are genuinely atomic with the mutation, not appended after the fact. Event create and the core `events` row update get the same treatment, newly built. Event cancel is explicitly not covered — no cancel endpoint exists anywhere in this codebase yet.
This is the largest DIP this session in terms of already-shipped code being touched — four brand-new `SECURITY DEFINER` functions, three existing ones extended, and two TypeScript repository functions rewired to call SQL functions instead of doing inserts directly. Treat every regression test as load-bearing, not routine.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Grounding Check

1. Schema correction, made explicit: the canonical `audit_logs` schema (Engineering Spec) is one single generic table — `id, tenant_id, entity_type, entity_id, action, actor_id, before_value (jsonb), after_value (jsonb), timestamp`. The original ticket asserted "distinct structures per action type" — that was wrong, not confirmed against spec text at the time of filing. `entity_type`/`action` are free-text discriminator columns (no `CHECK` constraint restricting values — deliberate, for extensibility without future migrations every time a new action type appears), and `jsonb` `before_value`/`after_value` accommodate different action shapes without needing separate tables.
2. Column naming deviation, flagged not silent: spec names the timestamp column literally `timestamp` — using `created_at` instead, matching every other table's convention in this schema. `timestamp` as a bare column name shadows the SQL type name and is bad practice; this is the one new table in this DIP with no prior migration to defer to, so spec is authoritative on structure, but this one column name is a deliberate, justified deviation.
3. Immutability requires overriding an existing blanket grant, not just omitting one. Migration `000011`'s `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` automatically grants `SELECT/INSERT/UPDATE/DELETE` to `service_role` and `authenticated` on any new table, including this one. Left alone, that silently violates STORY-10.1's explicit immutability requirement. This DIP must `REVOKE UPDATE, DELETE` explicitly after table creation, and add a trigger blocking any `UPDATE`/`DELETE` attempt unconditionally — defense in depth, since a future migration could re-grant those privileges without anyone realizing this table needs an exception.
4. No RLS `INSERT` policy for any role, including Admin — deliberate, stricter than every other table in this schema. Every other admin-managed table (`courses`, `event_types`, etc.) has an Admin-scoped `INSERT` policy. `audit_logs` gets none: it should be writable exclusively through the `SECURITY DEFINER` functions below, never directly by any user via the API, even an Admin. Allowing direct admin inserts would undermine the table's integrity as a trustworthy record of what the system did.
5. RSVP and self-report-Yes conversions must preserve their existing external interface exactly. `rsvp.service.ts` and `self-report.service.ts` call these repository functions today expecting specific return shapes — the new `SECURITY DEFINER` functions must return identical shapes so the calling service/route code needs zero changes beyond the repository function's internal implementation.
6. Event update's audit scope is the `events` row mutation itself, not its side effects. `updateEvent()` also reschedules notifications and creates `EVENT_UPDATE` notification rows for attendees — these are consequences of the update, not the audited entity. Only the core `events` `UPDATE` (fetch current → validate → patch → `UPDATE ... RETURNING`) gets wrapped in a `SECURITY DEFINER` function; the notification-rescheduling and fan-out logic stays exactly as it is in TypeScript today, called after the atomic core update returns.
7. Event cancel is out of scope — confirmed absent, not assumed. No cancel endpoint or service function exists anywhere in this codebase (confirmed via FP-13's own migration comment: "there is currently no API-level cancel endpoint"). Nothing to audit. Whichever future story implements cancellation must add its own audit hook at that time — note this explicitly in the PR description so it isn't silently forgotten.
8. `no_self_report_auto`'s attendance audit entry gets `actor_id = NULL`, matching the existing `confirmed_by = NULL` convention on that row. No human confirmed it — the audit trail should say the same thing the `attendance` row already says. The `member_attendance_reports` entry for the same action gets `actor_id` = the submitting member, since a human did submit the self-report itself.
9. No conflicts with Section 4 invariants. Pure observability addition — no business rule changes, no new write paths beyond what already exists, just atomic audit capture layered onto them.
Implementation Plan

1. Migration — `audit_logs` table, immutability, and the shared write helper:
   * Table per Grounding Check items 1–2.
   * Cross-tenant trigger on `actor_id` when not null (same pattern as every prior cross-table trigger this session).
   * `REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, service_role` + immutability trigger.
   * RLS: `SELECT` — tenant-scoped, Admin-only (`caller_is_admin()`, reused). No `INSERT`/`UPDATE`/`DELETE` policies at all.
   * `write_audit_log(p_tenant_id, p_entity_type, p_entity_id, p_action, p_actor_id, p_before, p_after)` — shared `SECURITY DEFINER` helper, called internally by every function below rather than each duplicating the `INSERT INTO audit_logs` statement.
2. Convert `upsertRsvp()` → new function `upsert_rsvp_with_audit()`. Captures the pre-existing row (if any) as `before_value`, determines `action` (`'create'` vs `'update'`) from whether a prior row existed, performs the upsert, captures `after_value`, calls `write_audit_log`. `rsvp.repository.ts`'s `upsertRsvp()` becomes a thin `.rpc()` wrapper — `rsvp.service.ts` needs no changes.
3. Convert `insertSelfReportYes()` → new function `insert_self_report_yes_with_audit()`. Single insert, `before_value = NULL` (re-submission is already blocked by the unique constraint), `action = 'create'`. `self-report.repository.ts`'s `insertSelfReportYes()` becomes a thin `.rpc()` wrapper.
4. Extend `submit_self_report_no()` — add two `write_audit_log` calls: one for the `member_attendance_reports` insert (`entity_type = 'self_report'`, `actor_id` = submitting member), one for the `attendance` insert (`entity_type = 'attendance'`, `action = 'auto_resolve'`, `actor_id = NULL` per Grounding Check item 8).
5. Extend `resolve_leader_confirmation()` — add two `write_audit_log` calls: one for the `member_attendance_reports` update (`entity_type = 'self_report'`, `action = 'confirm'` or `'reject'`), one for the `attendance` insert (`entity_type = 'attendance'`, `action = 'leader_confirm'` or `'leader_reject'`). Both `actor_id` = the confirming leader/admin.
6. Extend `admin_override_attendance()` — one `write_audit_log` call (`entity_type = 'attendance'`, `action = 'admin_override'`), `before_value` = the pre-existing row if this upsert hit the `ON CONFLICT` path, `NULL` otherwise.
7. New function `insert_event_with_audit()` — wraps `createEvent`'s single insert. `before_value = NULL`, `action = 'create'`, `entity_type = 'event'`. `events/service.ts`'s `createEvent()` calls this instead of its own `.insert()`; existing app-layer `talk_id`/`event_type_id` validation stays exactly where it is (DB triggers already provide the safety net regardless).
8. New function `update_event_with_audit()` — wraps only the core `UPDATE events SET patch ... RETURNING` from `updateEvent()` (Grounding Check item 6). Captures the already-fetched current row as `before_value`, the updated row as `after_value`, `action = 'update'`. `updateEvent()` calls this in place of its current inline update, then proceeds exactly as before with notification rescheduling and `EVENT_UPDATE` fan-out using the returned row.
9. Full regression: every existing test script this session that exercises RSVP, self-report, confirmation, override, or event create/update must still pass — these are the highest-risk changes in the DIP precisely because they touch already-shipped, already-tested code, not new surface area.
Files to Create/Modify

* `supabase/migrations/20260629000017_audit_logs.sql`
* `src/features/rsvps/rsvp.repository.ts` (modify — `upsertRsvp` becomes an `.rpc()` wrapper)
* `src/features/self-reports/self-report.repository.ts` (modify — `insertSelfReportYes` becomes an `.rpc()` wrapper)
* `src/features/events/service.ts` (modify — `createEvent`/`updateEvent` call the new audit-wrapped functions)
* `documentation/test-plans/FP-48-audit-logs-checklist.md`
Migration File
`supabase/migrations/20260629000017_audit_logs.sql`

```sql
-- DIP-FP-48: audit_logs table, immutability enforcement, and atomic audit writes
-- across seven mutation paths. Two paths (RSVP upsert, self-report Yes insert)
-- are converted from plain client-side inserts to SECURITY DEFINER functions so
-- their audit writes are genuinely atomic, not appended after the fact — per
-- Engineering Spec WP-2's "synchronously in the same transaction" requirement.


-- ==============================================================
-- SECTION 1: audit_logs table
--
-- Single generic table per Engineering Spec canonical schema — entity_type/
-- action are free-text discriminators (no CHECK, deliberate, for extensibility).
-- created_at used instead of spec's literal "timestamp" column name — shadows
-- the SQL type name, deviated deliberately, flagged here.
-- ==============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    action TEXT NOT NULL,
    actor_id UUID REFERENCES members(id),
    before_value JSONB,
    after_value JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(tenant_id, actor_id);


-- ==============================================================
-- SECTION 2: Cross-tenant safety trigger on actor_id (when not null)
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_audit_log_actor_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.actor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM members WHERE id = NEW.actor_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'audit_logs.actor_id % does not belong to tenant %', NEW.actor_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_audit_log_actor_tenant_scope ON audit_logs;
CREATE TRIGGER trigger_validate_audit_log_actor_tenant_scope
BEFORE INSERT ON audit_logs
FOR EACH ROW EXECUTE FUNCTION validate_audit_log_actor_tenant_scope();


-- ==============================================================
-- SECTION 3: Immutability — REVOKE + trigger, defense in depth
--
-- Migration 000011's ALTER DEFAULT PRIVILEGES automatically granted
-- UPDATE/DELETE to service_role and authenticated the moment this
-- table was created. Explicitly revoking here, plus a trigger that
-- blocks any UPDATE/DELETE regardless of grants, so a future
-- re-grant elsewhere can't silently break immutability.
-- ==============================================================

REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, service_role;

CREATE OR REPLACE FUNCTION public.block_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only — % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_audit_log_update ON audit_logs;
CREATE TRIGGER trigger_block_audit_log_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION block_audit_log_mutation();

DROP TRIGGER IF EXISTS trigger_block_audit_log_delete ON audit_logs;
CREATE TRIGGER trigger_block_audit_log_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION block_audit_log_mutation();


-- ==============================================================
-- SECTION 4: RLS — SELECT only (Admin, tenant-scoped). No write
-- policy at all — audit_logs is writable exclusively via the
-- SECURITY DEFINER functions below, never directly by any user.
-- ==============================================================

CREATE POLICY "audit_logs_select_admin" ON audit_logs
    FOR SELECT USING (tenant_id = get_tenant_id() AND caller_is_admin());


-- ==============================================================
-- SECTION 5: Shared write helper — every function below calls this
-- instead of duplicating the INSERT INTO audit_logs statement.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.write_audit_log(
    p_tenant_id UUID,
    p_entity_type TEXT,
    p_entity_id UUID,
    p_action TEXT,
    p_actor_id UUID,
    p_before JSONB,
    p_after JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, actor_id, before_value, after_value)
  VALUES (p_tenant_id, p_entity_type, p_entity_id, p_action, p_actor_id, p_before, p_after)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


-- ==============================================================
-- SECTION 6: upsert_rsvp_with_audit() — replaces plain client-side
-- upsert in rsvp.repository.ts. Atomic with the audit write.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.upsert_rsvp_with_audit(
    p_tenant_id UUID,
    p_event_id UUID,
    p_member_id UUID,
    p_rsvp_status TEXT,
    p_rsvp_reason TEXT,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, tenant_id UUID, event_id UUID, member_id UUID,
    rsvp_status TEXT, rsvp_reason TEXT, responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_before JSONB;
  v_action TEXT;
  v_row rsvps%ROWTYPE;
  v_now TIMESTAMPTZ := now();
BEGIN
  SELECT to_jsonb(r) INTO v_before FROM rsvps r
  WHERE r.tenant_id = p_tenant_id AND r.event_id = p_event_id AND r.member_id = p_member_id;

  v_action := CASE WHEN v_before IS NULL THEN 'create' ELSE 'update' END;

  INSERT INTO rsvps (tenant_id, event_id, member_id, rsvp_status, rsvp_reason, responded_at, updated_at)
  VALUES (p_tenant_id, p_event_id, p_member_id, p_rsvp_status, p_rsvp_reason, v_now, v_now)
  ON CONFLICT (tenant_id, event_id, member_id) DO UPDATE SET
    rsvp_status = EXCLUDED.rsvp_status,
    rsvp_reason = EXCLUDED.rsvp_reason,
    responded_at = EXCLUDED.responded_at,
    updated_at = EXCLUDED.updated_at
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'rsvp', v_row.id, v_action, p_actor_member_id, v_before, to_jsonb(v_row));

  RETURN QUERY SELECT v_row.id, v_row.tenant_id, v_row.event_id, v_row.member_id,
    v_row.rsvp_status, v_row.rsvp_reason, v_row.responded_at, v_row.created_at, v_row.updated_at;
END;
$$;


-- ==============================================================
-- SECTION 7: insert_self_report_yes_with_audit() — replaces plain
-- client-side insert in self-report.repository.ts.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.insert_self_report_yes_with_audit(
    p_tenant_id UUID,
    p_event_id UUID,
    p_member_id UUID,
    p_feedback TEXT,
    p_star_rating INT
)
RETURNS TABLE (
    id UUID, tenant_id UUID, event_id UUID, member_id UUID,
    self_report_status TEXT, reason TEXT, feedback TEXT, star_rating INT,
    confirmation_status TEXT, submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row member_attendance_reports%ROWTYPE;
BEGIN
  INSERT INTO member_attendance_reports (
    tenant_id, event_id, member_id, self_report_status, reason, feedback, star_rating, confirmation_status
  ) VALUES (
    p_tenant_id, p_event_id, p_member_id, 'SELF_REPORTED_YES', NULL, p_feedback, p_star_rating, 'PENDING_CONFIRMATION'
  )
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'self_report', v_row.id, 'create', p_member_id, NULL, to_jsonb(v_row));

  RETURN QUERY SELECT v_row.id, v_row.tenant_id, v_row.event_id, v_row.member_id,
    v_row.self_report_status, v_row.reason, v_row.feedback, v_row.star_rating,
    v_row.confirmation_status, v_row.submitted_at, v_row.created_at, v_row.updated_at;
END;
$$;


-- ==============================================================
-- SECTION 8: insert_event_with_audit() — replaces plain client-side
-- insert in events/service.ts's createEvent().
-- ==============================================================

CREATE OR REPLACE FUNCTION public.insert_event_with_audit(
    p_tenant_id UUID,
    p_event_type_id UUID,
    p_name TEXT,
    p_start_datetime TIMESTAMPTZ,
    p_end_datetime TIMESTAMPTZ,
    p_location_name TEXT,
    p_target JSONB,
    p_talk_id UUID,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, start_datetime TIMESTAMPTZ,
    end_datetime TIMESTAMPTZ, location_name TEXT, target JSONB,
    talk_id UUID, created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row events%ROWTYPE;
BEGIN
  INSERT INTO events (
    tenant_id, event_type_id, name, status, start_datetime, end_datetime, location_name, target, talk_id
  ) VALUES (
    p_tenant_id, p_event_type_id, p_name, 'DRAFT', p_start_datetime, p_end_datetime, p_location_name, p_target, p_talk_id
  )
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'create', p_actor_member_id, NULL, to_jsonb(v_row));

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.status, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.target, v_row.talk_id, v_row.created_at;
END;
$$;


-- ==============================================================
-- SECTION 9: update_event_with_audit() — wraps ONLY the core events
-- row patch from updateEvent(). Caller (TypeScript) still does its
-- own fetch/validate before calling this, and its own notification
-- rescheduling/fan-out after — this function is just the atomic
-- "patch + audit" step in the middle.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.update_event_with_audit(
    p_event_id UUID,
    p_tenant_id UUID,
    p_patch JSONB,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, version INT, start_datetime TIMESTAMPTZ,
    end_datetime TIMESTAMPTZ, location_name TEXT, target JSONB,
    talk_id UUID, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_before JSONB;
  v_row events%ROWTYPE;
BEGIN
  SELECT to_jsonb(e) INTO v_before FROM events e WHERE e.id = p_event_id AND e.tenant_id = p_tenant_id;

  UPDATE events SET
    name = COALESCE(p_patch->>'name', name),
    start_datetime = COALESCE((p_patch->>'start_datetime')::TIMESTAMPTZ, start_datetime),
    end_datetime = COALESCE((p_patch->>'end_datetime')::TIMESTAMPTZ, end_datetime),
    location_name = COALESCE(p_patch->>'location_name', location_name),
    target = COALESCE(p_patch->'target', target),
    talk_id = CASE WHEN p_patch ? 'talk_id' THEN (p_patch->>'talk_id')::UUID ELSE talk_id END,
    version = version + 1,
    updated_at = now()
  WHERE id = p_event_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'update', p_actor_member_id, v_before, to_jsonb(v_row));

  RETURN QUERY SELECT v_row.id, v_row.name, v_row.status, v_row.version, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.target, v_row.talk_id, v_row.updated_at;
END;
$$;


-- ==============================================================
-- SECTION 10: Extend submit_self_report_no() — add audit writes
-- for both inserts (self_report create + attendance auto_resolve).
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
  v_report_row member_attendance_reports%ROWTYPE;
  v_attendance_row attendance%ROWTYPE;
BEGIN
  INSERT INTO member_attendance_reports (
    tenant_id, event_id, member_id, self_report_status, reason, confirmation_status, submitted_at
  ) VALUES (
    p_tenant_id, p_event_id, p_member_id, 'SELF_REPORTED_NO', p_reason, 'NOT_REQUIRED', v_submitted_at
  )
  RETURNING * INTO v_report_row;
  v_report_id := v_report_row.id;

  INSERT INTO attendance (
    tenant_id, event_id, member_id, attendance_status, self_report_id,
    confirmed_by, confirmed_at, confirmation_type, version
  ) VALUES (
    p_tenant_id, p_event_id, p_member_id, 'DID_NOT_ATTEND', v_report_id,
    NULL, v_submitted_at, 'no_self_report_auto', 1
  )
  RETURNING * INTO v_attendance_row;
  v_attendance_id := v_attendance_row.id;

  -- Audit: self_report create — actor is the submitting member
  PERFORM write_audit_log(p_tenant_id, 'self_report', v_report_id, 'create', p_member_id, NULL, to_jsonb(v_report_row));
  -- Audit: attendance auto_resolve — actor is NULL (system resolution, no human confirmed)
  PERFORM write_audit_log(p_tenant_id, 'attendance', v_attendance_id, 'auto_resolve', NULL, NULL, to_jsonb(v_attendance_row));

  RETURN QUERY SELECT v_report_id, v_attendance_id, v_submitted_at;
END;
$$;


-- ==============================================================
-- SECTION 11: Extend resolve_leader_confirmation() — add audit
-- writes for self_report update and attendance insert.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.resolve_leader_confirmation(
    p_tenant_id UUID,
    p_self_report_id UUID,
    p_leader_member_id UUID,
    p_decision TEXT,
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
  v_report_before JSONB;
  v_report_after JSONB;
  v_attendance_row attendance%ROWTYPE;
BEGIN
  SELECT mar.event_id, mar.member_id, mar.confirmation_status, to_jsonb(mar)
  INTO v_event_id, v_member_id, v_current_status, v_report_before
  FROM member_attendance_reports AS mar
  WHERE mar.id = p_self_report_id AND mar.tenant_id = p_tenant_id
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
  WHERE id = p_self_report_id
  RETURNING to_jsonb(member_attendance_reports.*) INTO v_report_after;

  INSERT INTO attendance (
    tenant_id, event_id, member_id, attendance_status, self_report_id,
    confirmed_by, confirmed_at, confirmation_type, leader_note, version
  ) VALUES (
    p_tenant_id, v_event_id, v_member_id, v_attendance_status, p_self_report_id,
    p_leader_member_id, v_confirmed_at, v_confirmation_type, p_leader_note, 1
  )
  RETURNING * INTO v_attendance_row;
  v_attendance_id := v_attendance_row.id;

  -- Audit: self_report status update — actor is the confirming leader/admin
  PERFORM write_audit_log(p_tenant_id, 'self_report', p_self_report_id,
    CASE WHEN p_decision = 'CONFIRM' THEN 'confirm' ELSE 'reject' END,
    p_leader_member_id, v_report_before, v_report_after);
  -- Audit: attendance insert — actor is the confirming leader/admin
  PERFORM write_audit_log(p_tenant_id, 'attendance', v_attendance_id,
    v_confirmation_type, p_leader_member_id, NULL, to_jsonb(v_attendance_row));

  RETURN QUERY SELECT v_attendance_id, v_new_confirmation_status, v_confirmed_at;
END;
$$;


-- ==============================================================
-- SECTION 12: Extend admin_override_attendance() — add audit write.
-- before_value captured from pre-existing row when ON CONFLICT fires.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.admin_override_attendance(
    p_tenant_id UUID,
    p_event_id UUID,
    p_member_id UUID,
    p_attendance_status TEXT,
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
  v_before JSONB;
  v_after_row attendance%ROWTYPE;
BEGIN
  SELECT to_jsonb(a) INTO v_before FROM attendance a
  WHERE a.tenant_id = p_tenant_id AND a.event_id = p_event_id AND a.member_id = p_member_id;

  INSERT INTO attendance (
    tenant_id, event_id, member_id, attendance_status, self_report_id,
    confirmed_by, confirmed_at, confirmation_type, leader_note, version
  ) VALUES (
    p_tenant_id, p_event_id, p_member_id, p_attendance_status, NULL,
    p_admin_member_id, v_confirmed_at, 'admin_override', p_reason, 1
  )
  ON CONFLICT (tenant_id, event_id, member_id) DO UPDATE SET
    attendance_status = EXCLUDED.attendance_status,
    self_report_id = attendance.self_report_id,
    confirmed_by = EXCLUDED.confirmed_by,
    confirmed_at = EXCLUDED.confirmed_at,
    confirmation_type = 'admin_override',
    leader_note = EXCLUDED.leader_note,
    version = attendance.version + 1,
    updated_at = v_confirmed_at
  RETURNING * INTO v_after_row;

  v_attendance_id := v_after_row.id;
  v_version := v_after_row.version;

  PERFORM write_audit_log(p_tenant_id, 'attendance', v_attendance_id, 'admin_override',
    p_admin_member_id, v_before, to_jsonb(v_after_row));

  RETURN QUERY SELECT v_attendance_id, v_version, v_confirmed_at;
END;
$$;
```

Sections 10–12 (extending `submit_self_report_no()`, `resolve_leader_confirmation()`, `admin_override_attendance()`) are not full `CREATE OR REPLACE` bodies here — each needs exactly one or two `PERFORM write_audit_log(...)` lines inserted at the point each existing `INSERT`/`UPDATE` already happens, per Implementation Plan steps 4–6. Read each function's current body from its own migration (`20260629000008`, `20260629000010`) before editing — do not rewrite from scratch; add the audit calls in place and preserve everything else exactly.
Branch Name
`feature/FP-48-audit-logs`
Commit Message
`FP-48: Implement audit_logs table and atomic audit writes across seven mutation paths`
Pull Request Description
Maps to FP-48's full (expanded) AC list: `audit_logs` table with corrected single-generic-table schema, immutability via `REVOKE` + trigger, all five original hooks wired atomically (two via new `SECURITY DEFINER` conversions, three via extending existing functions), event create/update added as new scope, event cancel explicitly noted as out of scope pending a future cancel-endpoint story.
Flag prominently: this DIP converts two already-shipped, already-tested write paths (RSVP, self-report Yes) to a different internal mechanism. Full regression across every prior test script that exercises these paths is not optional — this is the highest-risk DIP this session in terms of touching working code, even though no external interface changes.
Jira Linkage

* PDEEpicID: FP-40 (EPIC-10 — Audit & Compliance)
* PDEStoryID: FP-48 (Implement audit_logs table and wire existing audit TODO hooks)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-48.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.
Create the feature branch, read the current bodies of `submit_self_report_no()`, `resolve_leader_confirmation()`, and `admin_override_attendance()` before editing them, implement, run the full regression across every existing test script that touches RSVP/self-report/confirmation/override/event-create/event-update, commit, push, and open the PR against `dev`.
If any Jira ticket needs to be filed for a finding during this DIP, do not file it directly — report it back for Atlas to file. Standing instruction as of this session.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
