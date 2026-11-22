-- FP-257 part 1: anonymous post-event feedback.
-- Feedback and star ratings move to event_feedback, which has no author, no date and no time.
-- The Yes self-report and its feedback row are written by one function; the audit entry
-- carries nothing about feedback. Additive for already-deployed code: old code keeps working.
-- The data move is a separate, previewed script (documentation/sql/FP-257-move.sql);
-- part 2 (20261120000089) drops the old columns.

-- ==============================================================
-- SECTION 1: event_feedback — id, tenant_id, event_id, star_rating, feedback. Nothing else.
-- ==============================================================

CREATE TABLE IF NOT EXISTS public.event_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    star_rating INT,
    feedback TEXT,
    CONSTRAINT event_feedback_star_rating_range CHECK (star_rating IS NULL OR star_rating BETWEEN 1 AND 5),
    CONSTRAINT event_feedback_feedback_length CHECK (feedback IS NULL OR char_length(feedback) <= 1000),
    CONSTRAINT event_feedback_feedback_not_blank CHECK (feedback IS NULL OR btrim(feedback) <> ''),
    CONSTRAINT event_feedback_not_empty CHECK (star_rating IS NOT NULL OR feedback IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_event_feedback_tenant_event ON public.event_feedback(tenant_id, event_id);

ALTER TABLE public.event_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_feedback TO service_role;

CREATE OR REPLACE FUNCTION public.validate_event_feedback_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'event_feedback.event_id % does not belong to tenant %', NEW.event_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_event_feedback_tenant_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_validate_event_feedback_tenant_scope ON public.event_feedback;
CREATE TRIGGER trigger_validate_event_feedback_tenant_scope
BEFORE INSERT OR UPDATE ON public.event_feedback
FOR EACH ROW EXECUTE FUNCTION public.validate_event_feedback_tenant_scope();

-- ==============================================================
-- SECTION 2: insert_self_report_yes_with_audit() — same name and parameters; the result
-- no longer has feedback or star_rating (return type changes, so DROP + CREATE).
-- ==============================================================

DROP FUNCTION IF EXISTS public.insert_self_report_yes_with_audit(UUID, UUID, UUID, TEXT, INT);

CREATE FUNCTION public.insert_self_report_yes_with_audit(
    p_tenant_id UUID,
    p_event_id UUID,
    p_member_id UUID,
    p_feedback TEXT,
    p_star_rating INT
)
RETURNS TABLE (
    id UUID, tenant_id UUID, event_id UUID, member_id UUID,
    self_report_status TEXT, reason TEXT,
    confirmation_status TEXT, submitted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row member_attendance_reports%ROWTYPE;
  v_feedback TEXT := CASE WHEN p_feedback IS NULL OR btrim(p_feedback) = '' THEN NULL ELSE p_feedback END;
BEGIN
  INSERT INTO member_attendance_reports (
    tenant_id, event_id, member_id, self_report_status, reason, confirmation_status
  ) VALUES (
    p_tenant_id, p_event_id, p_member_id, 'SELF_REPORTED_YES', NULL, 'PENDING_CONFIRMATION'
  )
  RETURNING * INTO v_row;

  -- Nothing about feedback goes into the audit entry, not even whether there was any.
  PERFORM write_audit_log(p_tenant_id, 'self_report', v_row.id, 'create', p_member_id, NULL,
                          to_jsonb(v_row) - 'feedback' - 'star_rating');

  -- Anonymous: no member, no report id, no time.
  IF p_star_rating IS NOT NULL OR v_feedback IS NOT NULL THEN
    INSERT INTO event_feedback (tenant_id, event_id, star_rating, feedback)
    VALUES (p_tenant_id, p_event_id, p_star_rating, v_feedback);
  END IF;

  RETURN QUERY SELECT v_row.id, v_row.tenant_id, v_row.event_id, v_row.member_id,
    v_row.self_report_status, v_row.reason,
    v_row.confirmation_status, v_row.submitted_at, v_row.created_at, v_row.updated_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_self_report_yes_with_audit(UUID, UUID, UUID, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_self_report_yes_with_audit(UUID, UUID, UUID, TEXT, INT) TO service_role;

-- ==============================================================
-- SECTION 3: redact_removed_member_personal_text() — copied from 20261006000083;
-- only the member_attendance_reports UPDATE changes (reason only).
-- ==============================================================

CREATE OR REPLACE FUNCTION public.redact_removed_member_personal_text(p_tenant_id UUID, p_member_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prev TEXT;
  v_rsvps INT;
  v_reports INT;
  v_attendance INT;
  v_audit INT;
  v_counts JSONB;
BEGIN
  UPDATE rsvps SET rsvp_reason = '[removed]'
  WHERE tenant_id = p_tenant_id AND member_id = p_member_id
    AND rsvp_reason IS NOT NULL AND rsvp_reason <> '[removed]';
  GET DIAGNOSTICS v_rsvps = ROW_COUNT;

  -- FP-257: feedback no longer lives on this table (event_feedback has no author).
  UPDATE member_attendance_reports SET reason = '[removed]'
  WHERE tenant_id = p_tenant_id AND member_id = p_member_id
    AND reason IS NOT NULL AND reason <> '[removed]';
  GET DIAGNOSTICS v_reports = ROW_COUNT;

  UPDATE attendance SET leader_note = '[removed]'
  WHERE tenant_id = p_tenant_id AND member_id = p_member_id
    AND leader_note IS NOT NULL AND leader_note <> '[removed]';
  GET DIAGNOSTICS v_attendance = ROW_COUNT;

  v_prev := current_setting('app.audit_redaction', true);
  PERFORM set_config('app.audit_redaction', 'on', true);

  WITH targets AS (
    SELECT a.id,
      CASE WHEN a.entity_type = 'member' THEN public.audit_redact_identifiers('member', a.before_value)
           ELSE public.audit_redact_member_text(a.entity_type, a.before_value) END AS new_before,
      CASE WHEN a.entity_type = 'member' THEN public.audit_redact_identifiers('member', a.after_value)
           ELSE public.audit_redact_member_text(a.entity_type, a.after_value) END AS new_after
    FROM audit_logs a
    WHERE a.tenant_id = p_tenant_id
      AND (
        (a.entity_type = 'member' AND a.entity_id = p_member_id)
        OR (a.entity_type IN ('rsvp', 'self_report', 'attendance')
            AND (a.before_value ->> 'member_id' = p_member_id::TEXT
                 OR a.after_value ->> 'member_id' = p_member_id::TEXT))
      )
  )
  UPDATE audit_logs a
  SET before_value = t.new_before, after_value = t.new_after
  FROM targets t
  WHERE a.id = t.id
    AND (a.before_value IS DISTINCT FROM t.new_before OR a.after_value IS DISTINCT FROM t.new_after);
  GET DIAGNOSTICS v_audit = ROW_COUNT;

  PERFORM set_config('app.audit_redaction', COALESCE(v_prev, ''), true);

  v_counts := jsonb_build_object('rsvps', v_rsvps, 'self_reports', v_reports,
                                 'attendance', v_attendance, 'audit_entries', v_audit);
  IF v_rsvps + v_reports + v_attendance + v_audit > 0 THEN
    -- Recorded as entity_type 'member_redaction' (entity_id = the member) so the counts are
    -- kept: entries of type 'member' keep only ids (section 2).
    PERFORM public.write_audit_log(p_tenant_id, 'member_redaction', p_member_id, 'redact_personal_text',
                                   NULL, NULL, v_counts);
  END IF;
  RETURN v_counts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redact_removed_member_personal_text(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
