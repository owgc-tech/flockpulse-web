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
--
-- actor_id is a plain UUID with no FK — audit records preserve the actor ID
-- permanently even after member deletion. An FK with ON DELETE SET NULL would
-- trigger the UPDATE immutability guard when PostgreSQL propagates the nullification.
-- Tenant scope is still validated at INSERT time by the cross-tenant trigger.
-- ==============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    action TEXT NOT NULL,
    actor_id UUID,  -- no FK: audit records preserve actor_id permanently (no nullification on member delete)
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
-- SECTION 3: Immutability — REVOKE + UPDATE trigger, defense in depth
--
-- Migration 000011's ALTER DEFAULT PRIVILEGES automatically granted
-- UPDATE/DELETE to service_role and authenticated the moment this
-- table was created. Explicitly revoking both here.
--
-- UPDATE is additionally blocked by a trigger — silently mutating an
-- audit record is the most dangerous failure mode. DELETE is protected
-- by the REVOKE alone: postgres-superuser cascade deletes (from tenant
-- cleanup in tests or a future admin tenant teardown) are intentionally
-- allowed, since audit records have no value without their tenant context
-- and hard tenant deletion is an admin-level operation already.
-- ==============================================================

REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, service_role;

CREATE OR REPLACE FUNCTION public.block_audit_log_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only — UPDATE is not permitted';
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_audit_log_update ON audit_logs;
CREATE TRIGGER trigger_block_audit_log_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION block_audit_log_update();


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
--
-- RETURNS SETOF rsvps (not RETURNS TABLE with named columns) to avoid
-- PL/pgSQL output-column name clashes with ON CONFLICT column targets —
-- PostgreSQL cannot resolve "tenant_id" in ON CONFLICT (tenant_id, ...)
-- when a RETURNS TABLE output column of the same name is in scope.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.upsert_rsvp_with_audit(
    p_tenant_id UUID,
    p_event_id UUID,
    p_member_id UUID,
    p_rsvp_status TEXT,
    p_rsvp_reason TEXT,
    p_actor_member_id UUID
)
RETURNS SETOF rsvps
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

  RETURN NEXT v_row;
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

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.target, v_row.talk_id, v_row.created_at;
END;
$$;


-- ==============================================================
-- SECTION 9: update_event_with_audit() — wraps ONLY the core events
-- row patch from updateEvent(). Caller (TypeScript) still does its
-- own fetch/validate before calling this, and its own notification
-- rescheduling/fan-out after — this function is just the atomic
-- "patch + audit" step in the middle.
--
-- Column references in SET clause are qualified with "events." to
-- avoid ambiguity with PL/pgSQL output column variables of the same name.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.update_event_with_audit(
    p_event_id UUID,
    p_tenant_id UUID,
    p_patch JSONB,
    p_actor_member_id UUID
)
RETURNS TABLE (
    id UUID, name TEXT, status TEXT, version INT,
    start_datetime TIMESTAMPTZ, end_datetime TIMESTAMPTZ,
    location_name TEXT, target JSONB,
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
    name          = COALESCE(p_patch->>'name',                    events.name),
    start_datetime = COALESCE((p_patch->>'start_datetime')::TIMESTAMPTZ, events.start_datetime),
    end_datetime   = COALESCE((p_patch->>'end_datetime')::TIMESTAMPTZ,   events.end_datetime),
    location_name  = COALESCE(p_patch->>'location_name',          events.location_name),
    target         = COALESCE(p_patch->'target',                  events.target),
    talk_id        = CASE WHEN p_patch ? 'talk_id' THEN (p_patch->>'talk_id')::UUID ELSE events.talk_id END,
    version        = events.version + 1,
    updated_at     = now()
  WHERE events.id = p_event_id AND events.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  PERFORM write_audit_log(p_tenant_id, 'event', v_row.id, 'update', p_actor_member_id, v_before, to_jsonb(v_row));

  RETURN QUERY SELECT
    v_row.id, v_row.name, v_row.status, v_row.version, v_row.start_datetime,
    v_row.end_datetime, v_row.location_name, v_row.target, v_row.talk_id, v_row.updated_at;
END;
$$;


-- ==============================================================
-- SECTION 10: Extend submit_self_report_no() — add audit writes
-- for both inserts (self_report create + attendance auto_resolve).
-- actor_id on self_report entry = submitting member.
-- actor_id on attendance entry = NULL (system resolution, no human).
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

  -- self_report create: actor = submitting member
  PERFORM write_audit_log(p_tenant_id, 'self_report', v_report_id, 'create',
    p_member_id, NULL, to_jsonb(v_report_row));
  -- attendance auto_resolve: actor = NULL (no human confirmed this)
  PERFORM write_audit_log(p_tenant_id, 'attendance', v_attendance_id, 'auto_resolve',
    NULL, NULL, to_jsonb(v_attendance_row));

  RETURN QUERY SELECT v_report_id, v_attendance_id, v_submitted_at;
END;
$$;


-- ==============================================================
-- SECTION 11: Extend resolve_leader_confirmation() — add audit
-- writes for self_report status update and attendance insert.
-- Both actor_ids = the confirming leader/admin.
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

  -- self_report status update: actor = confirming leader/admin
  PERFORM write_audit_log(p_tenant_id, 'self_report', p_self_report_id,
    CASE WHEN p_decision = 'CONFIRM' THEN 'confirm' ELSE 'reject' END,
    p_leader_member_id, v_report_before, v_report_after);
  -- attendance insert: actor = confirming leader/admin
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
