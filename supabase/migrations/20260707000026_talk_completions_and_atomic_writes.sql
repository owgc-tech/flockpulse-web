-- DIP-FP-79-FP-80-FP-81-FP-77-FP-78: talk_completions table, atomic write helpers,
-- and updated attendance confirmation functions to sync completion rows.
--
-- FP-79: talk_completions table with cross-tenant safety trigger and RLS
-- FP-80: sync_talk_completion_for_attendance helper + updated resolve_leader_confirmation
--        and admin_override_attendance to call it
-- No backfill: no real ATTENDED data exists yet (pre-launch).


-- ==============================================================
-- SECTION 1: talk_completions table
--
-- One durable "member completed this Talk" fact per (tenant, member, talk).
-- Never a log of every attendance — UNIQUE constraint enforces one row per pair.
-- source: 'event_attendance' (written by sync_talk_completion_for_attendance)
--         'manual' (written by service-role client for FP-81 admin entry)
-- ==============================================================

CREATE TABLE IF NOT EXISTS talk_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    talk_id UUID NOT NULL REFERENCES talks(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('event_attendance', 'manual')),
    source_event_id UUID REFERENCES events(id) ON DELETE SET NULL,
    recorded_by UUID REFERENCES members(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT talk_completions_unique_per_member_talk UNIQUE (tenant_id, member_id, talk_id)
);

CREATE INDEX IF NOT EXISTS idx_talk_completions_member ON talk_completions(tenant_id, member_id);
CREATE INDEX IF NOT EXISTS idx_talk_completions_talk ON talk_completions(tenant_id, talk_id);


-- ==============================================================
-- SECTION 2: Cross-tenant safety trigger
--
-- Validates that member_id and talk_id both belong to tenant_id.
-- Mirrors the pattern already established for other Formation tables.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_talk_completion_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM members WHERE id = NEW.member_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'talk_completions.member_id % does not belong to tenant %', NEW.member_id, NEW.tenant_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM talks WHERE id = NEW.talk_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'talk_completions.talk_id % does not belong to tenant %', NEW.talk_id, NEW.tenant_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_talk_completion_tenant_scope ON talk_completions;
CREATE TRIGGER trigger_validate_talk_completion_tenant_scope
BEFORE INSERT OR UPDATE ON talk_completions
FOR EACH ROW EXECUTE FUNCTION validate_talk_completion_tenant_scope();


-- ==============================================================
-- SECTION 3: RLS — tenant-wide SELECT only
--
-- App-layer RBAC in /api/formation/progress handles member-scope restriction.
-- No client-facing INSERT/UPDATE/DELETE: all writes go through SECURITY DEFINER
-- functions or the service-role client (FP-81), consistent with other tables.
-- ==============================================================

ALTER TABLE talk_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "talk_completions_select_tenant" ON talk_completions
    FOR SELECT USING (tenant_id = get_tenant_id());


-- ==============================================================
-- SECTION 4: sync_talk_completion_for_attendance()
--
-- Shared helper called from both resolve_leader_confirmation and
-- admin_override_attendance after their attendance upsert + audit-log block.
--
-- Source-precedence policy (DIP Grounding Check item 9):
--   ATTENDED: upserts completion — event wins over any existing record.
--   DID_NOT_ATTEND: deletes completion ONLY if source=event_attendance AND
--     source_event_id=p_event_id (never deletes manual entries or other events).
--
-- If events.talk_id IS NULL (not a Talk-linked event), does nothing.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.sync_talk_completion_for_attendance(
    p_tenant_id UUID,
    p_event_id UUID,
    p_member_id UUID,
    p_attendance_status TEXT,
    p_confirmed_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_talk_id UUID;
BEGIN
  SELECT talk_id INTO v_talk_id FROM events
  WHERE id = p_event_id AND tenant_id = p_tenant_id;

  -- If the event is not linked to a Talk, nothing to sync.
  IF v_talk_id IS NULL THEN
    RETURN;
  END IF;

  IF p_attendance_status = 'ATTENDED' THEN
    INSERT INTO talk_completions (
      tenant_id, member_id, talk_id, completed_at, source, source_event_id, recorded_by
    ) VALUES (
      p_tenant_id, p_member_id, v_talk_id, p_confirmed_at, 'event_attendance', p_event_id, NULL
    )
    ON CONFLICT (tenant_id, member_id, talk_id) DO UPDATE SET
      completed_at = EXCLUDED.completed_at,
      source = 'event_attendance',
      source_event_id = EXCLUDED.source_event_id,
      recorded_by = NULL;

  ELSIF p_attendance_status = 'DID_NOT_ATTEND' THEN
    -- Only remove the completion that THIS event produced; never touch manual or other events.
    DELETE FROM talk_completions
    WHERE tenant_id = p_tenant_id
      AND member_id = p_member_id
      AND talk_id = v_talk_id
      AND source = 'event_attendance'
      AND source_event_id = p_event_id;
  END IF;
END;
$$;


-- ==============================================================
-- SECTION 5: CREATE OR REPLACE resolve_leader_confirmation()
--
-- Copied verbatim from migration 20260629000017 (current canonical body),
-- with one addition: PERFORM sync_talk_completion_for_attendance(...)
-- after the existing audit-log writes, before RETURN QUERY.
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

  -- FP-80: sync talk_completions atomically
  PERFORM sync_talk_completion_for_attendance(
    p_tenant_id, v_event_id, v_member_id, v_attendance_status, v_confirmed_at
  );

  RETURN QUERY SELECT v_attendance_id, v_new_confirmation_status, v_confirmed_at;
END;
$$;


-- ==============================================================
-- SECTION 6: CREATE OR REPLACE admin_override_attendance()
--
-- Copied verbatim from migration 20260629000017 (current canonical body),
-- with one addition: PERFORM sync_talk_completion_for_attendance(...)
-- after the existing audit-log write, before RETURN QUERY.
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

  -- FP-80: sync talk_completions atomically
  PERFORM sync_talk_completion_for_attendance(
    p_tenant_id, p_event_id, p_member_id, p_attendance_status, v_confirmed_at
  );

  RETURN QUERY SELECT v_attendance_id, v_version, v_confirmed_at;
END;
$$;
