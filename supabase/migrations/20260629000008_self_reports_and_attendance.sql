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
