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
  SELECT mar.event_id, mar.member_id, mar.confirmation_status
  INTO v_event_id, v_member_id, v_current_status
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
  RETURNING attendance.id, attendance.version INTO v_attendance_id, v_version;

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
