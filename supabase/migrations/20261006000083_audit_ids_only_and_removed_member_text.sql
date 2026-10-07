-- DIP-FP-236-web: the audit log keeps ids, not identifying details; a removed
-- member's own words are replaced everywhere.
--
-- Decisions (Joseph, 2026-10-04 and 2026-10-06):
--   * Audit entries about a member keep ONLY id, tenant_id, role and
--     role_catalog_entry_id. Invitation entries keep no email (and no auth id).
--     Enforced for every writer in write_audit_log(), so no caller can forget.
--   * Existing member and invitation entries are redacted once, here.
--   * When a member is removed, their own free text is replaced with
--     '[removed]', in the tables AND in their audit entries:
--       rsvps.rsvp_reason, member_attendance_reports.reason and .feedback,
--       attendance.leader_note. Statuses, ratings, counts and dates stay.
--     Members removed before this migration are treated the same, here.
--   * audit_logs stays append-only. The single exception: UPDATE of
--     before_value / after_value only, only while the transaction-local flag
--     app.audit_redaction = 'on', which only the redaction functions below set.
--     UPDATE privilege stays revoked from service_role and authenticated.
--   * Every redaction is itself recorded in the audit log.
--
-- Idempotent: re-running changes nothing that is already redacted and records
-- nothing new when nothing changed. Apply it as one script.

-- ==============================================================
-- SECTION 1: pure helpers
-- ==============================================================

-- What an audit entry may keep, by entity type. Everything else passes through.
CREATE OR REPLACE FUNCTION public.audit_redact_identifiers(p_entity_type TEXT, p_value JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
  SELECT CASE
    WHEN p_value IS NULL OR jsonb_typeof(p_value) <> 'object' THEN p_value
    WHEN p_entity_type = 'member' THEN (
      SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
      FROM jsonb_each(p_value) AS e(k, v)
      WHERE k IN ('id', 'tenant_id', 'role', 'role_catalog_entry_id'))
    WHEN p_entity_type = 'invitation' THEN (
      SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
      FROM jsonb_each(p_value) AS e(k, v)
      WHERE k IN ('id', 'tenant_id', 'role', 'role_catalog_entry_id', 'group_id',
                  'invited_by', 'status', 'invited_at', 'responded_at'))
    ELSE p_value
  END
$$;

-- A removed member's own words inside an audit entry, by entity type.
CREATE OR REPLACE FUNCTION public.audit_redact_member_text(p_entity_type TEXT, p_value JSONB)
RETURNS JSONB LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_catalog AS $$
DECLARE
  v JSONB := p_value;
  k TEXT;
  v_keys TEXT[];
BEGIN
  IF v IS NULL OR jsonb_typeof(v) <> 'object' THEN RETURN v; END IF;
  v_keys := CASE p_entity_type
    WHEN 'rsvp'        THEN ARRAY['rsvp_reason']
    WHEN 'self_report' THEN ARRAY['reason', 'feedback']
    WHEN 'attendance'  THEN ARRAY['leader_note']
    ELSE ARRAY[]::TEXT[]
  END;
  FOREACH k IN ARRAY v_keys LOOP
    IF v ? k AND jsonb_typeof(v -> k) = 'string' THEN
      v := jsonb_set(v, ARRAY[k], to_jsonb('[removed]'::TEXT));
    END IF;
  END LOOP;
  RETURN v;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_redact_identifiers(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_redact_identifiers(TEXT, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.audit_redact_member_text(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_redact_member_text(TEXT, JSONB) TO service_role;

-- ==============================================================
-- SECTION 2: write_audit_log() — same signature and behavior, plus the
-- identifier rule on both values (covers every SQL and TypeScript writer).
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
  VALUES (p_tenant_id, p_entity_type, p_entity_id, p_action, p_actor_id,
          public.audit_redact_identifiers(p_entity_type, p_before),
          public.audit_redact_identifiers(p_entity_type, p_after))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ==============================================================
-- SECTION 3: block_audit_log_update() — still blocks every UPDATE, except a
-- change of before_value / after_value ONLY, while app.audit_redaction = 'on'.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_audit_log_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF COALESCE(current_setting('app.audit_redaction', true), '') = 'on'
     AND NEW.id          IS NOT DISTINCT FROM OLD.id
     AND NEW.tenant_id   IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.entity_type IS NOT DISTINCT FROM OLD.entity_type
     AND NEW.entity_id   IS NOT DISTINCT FROM OLD.entity_id
     AND NEW.action      IS NOT DISTINCT FROM OLD.action
     AND NEW.actor_id    IS NOT DISTINCT FROM OLD.actor_id
     AND NEW.created_at  IS NOT DISTINCT FROM OLD.created_at
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only — UPDATE is not permitted';
END;
$$;

-- ==============================================================
-- SECTION 4: enforce_rsvp_guest_count_max() — check only when guest_count is
-- set or changed. Without this, replacing a removed member's reason on an RSVP
-- whose guest count is above a since-lowered community maximum would fail and
-- block the removal.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.enforce_rsvp_guest_count_max()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_max INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.guest_count IS NOT DISTINCT FROM OLD.guest_count THEN
    RETURN NEW;
  END IF;
  IF NEW.guest_count IS NOT NULL THEN
    SELECT max_guest_count_default INTO v_max FROM tenants WHERE id = NEW.tenant_id;
    IF v_max IS NOT NULL AND NEW.guest_count > v_max THEN
      RAISE EXCEPTION 'GUEST_COUNT_EXCEEDS_MAX: guest_count % exceeds this community''s max of %', NEW.guest_count, v_max;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ==============================================================
-- SECTION 5: redact_removed_member_personal_text() — a removed member's own
-- words, in the tables and in their audit entries, plus their register entry.
-- Internal: called by remove_member() and by the one-time cleanup below; not
-- callable by the API (no grant to service_role).
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

  UPDATE member_attendance_reports
  SET reason   = CASE WHEN reason   IS NOT NULL THEN '[removed]' END,
      feedback = CASE WHEN feedback IS NOT NULL THEN '[removed]' END
  WHERE tenant_id = p_tenant_id AND member_id = p_member_id
    AND ((reason IS NOT NULL AND reason <> '[removed]') OR (feedback IS NOT NULL AND feedback <> '[removed]'));
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

-- ==============================================================
-- SECTION 6: remove_member() — CREATE OR REPLACE of the CURRENT definition
-- (20261005000080, section D), unchanged except ONE added statement before
-- RETURN: the removed member's own words are replaced (section 5).
-- ==============================================================

CREATE OR REPLACE FUNCTION public.remove_member(
  p_tenant_id UUID,
  p_member_id UUID,
  p_reason TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_email TEXT;
  v_deleted_at TIMESTAMPTZ;
  v_placeholder TEXT := 'deleted-' || p_member_id::text || '@deleted.invalid';
  v_first TEXT;
  v_last TEXT;
  v_prev_bypass TEXT;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('SELF_DELETED', 'DEACTIVATED') THEN
    RAISE EXCEPTION 'p_reason must be SELF_DELETED or DEACTIVATED' USING ERRCODE = 'FP422';
  END IF;

  SELECT user_id, email, deleted_at INTO v_user_id, v_email, v_deleted_at
  FROM members
  WHERE id = p_member_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found for this tenant' USING ERRCODE = 'FP404';
  END IF;

  IF p_reason = 'SELF_DELETED' THEN
    v_first := 'Self-deleted'; v_last := 'User';
  ELSE
    v_first := 'Deactivated';  v_last := 'User';
  END IF;

  IF v_deleted_at IS NULL THEN
    -- Normal removal: ONE update, so the guard triggers and the FP-234 prune fire.
    UPDATE members
    SET deleted_at = now(),
        email = v_placeholder,
        first_name = v_first,
        last_name = v_last,
        birthdate = make_date(extract(year FROM birthdate)::int, 1, 1)
    WHERE id = p_member_id AND tenant_id = p_tenant_id;
  ELSIF v_email <> v_placeholder THEN
    -- Removed earlier by a plain deactivation that kept their details: finish the
    -- scrub, keeping the original deleted_at. No transition of deleted_at, so no
    -- guard or prune trigger is involved.
    UPDATE members
    SET email = v_placeholder,
        first_name = v_first,
        last_name = v_last,
        birthdate = make_date(extract(year FROM birthdate)::int, 1, 1)
    WHERE id = p_member_id AND tenant_id = p_tenant_id;
  END IF;

  -- Invitation rows for this person. v_email is the ORIGINAL email unless the
  -- member row was already scrubbed (then only auth_user_id can match).
  UPDATE invitations
  SET email = v_placeholder,
      status = CASE WHEN status = 'PENDING' THEN 'REVOKED' ELSE status END,
      responded_at = CASE WHEN status = 'PENDING' THEN now() ELSE responded_at END
  WHERE tenant_id = p_tenant_id
    AND (auth_user_id = v_user_id
         OR (v_email <> v_placeholder AND lower(email) = lower(v_email)))
    AND (email <> v_placeholder OR status = 'PENDING');

  -- FP-237 (i): detach from their leader and from every group.
  v_prev_bypass := current_setting('app.bypass_system_group_guard', true);
  PERFORM set_config('app.bypass_system_group_guard', 'true', true);
  UPDATE assignments
  SET deleted_at = now()
  WHERE tenant_id = p_tenant_id AND member_id = p_member_id AND deleted_at IS NULL;
  PERFORM set_config('app.bypass_system_group_guard', COALESCE(v_prev_bypass, ''), true);

  -- FP-237 (ii): their unavailability.
  DELETE FROM member_unavailability_ranges
  WHERE tenant_id = p_tenant_id AND member_id = p_member_id;

  -- FP-222: their per-event "last viewed version" rows.
  DELETE FROM event_member_views
  WHERE tenant_id = p_tenant_id AND member_id = p_member_id;

  -- FP-236: their own words (RSVP reasons, self-report reasons and feedback, leader
  -- notes) become '[removed]', in the tables and in their audit entries.
  PERFORM public.redact_removed_member_personal_text(p_tenant_id, p_member_id);

  RETURN v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_member(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(UUID, UUID, TEXT) TO service_role;

-- ==============================================================
-- SECTION 7: one-time cleanup of existing data (idempotent)
--   7a. every member and invitation audit entry, every tenant: identifiers out;
--       one 'redact_audit_identifiers' entry per tenant that had any change.
--   7b. every member removed before this migration (deleted_at set): section 5.
-- ==============================================================

DO $$
DECLARE
  r RECORD;
  v_prev TEXT;
BEGIN
  v_prev := current_setting('app.audit_redaction', true);
  PERFORM set_config('app.audit_redaction', 'on', true);

  FOR r IN
    WITH changed AS (
      UPDATE audit_logs a
      SET before_value = public.audit_redact_identifiers(a.entity_type, a.before_value),
          after_value  = public.audit_redact_identifiers(a.entity_type, a.after_value)
      WHERE a.entity_type IN ('member', 'invitation')
        AND (a.before_value IS DISTINCT FROM public.audit_redact_identifiers(a.entity_type, a.before_value)
             OR a.after_value IS DISTINCT FROM public.audit_redact_identifiers(a.entity_type, a.after_value))
      RETURNING a.tenant_id
    )
    SELECT tenant_id, count(*) AS n FROM changed GROUP BY tenant_id
  LOOP
    PERFORM public.write_audit_log(r.tenant_id, 'tenant', r.tenant_id, 'redact_audit_identifiers',
                                   NULL, NULL, jsonb_build_object('audit_entries', r.n));
  END LOOP;

  PERFORM set_config('app.audit_redaction', COALESCE(v_prev, ''), true);

  FOR r IN SELECT tenant_id, id FROM members WHERE deleted_at IS NOT NULL LOOP
    PERFORM public.redact_removed_member_personal_text(r.tenant_id, r.id);
  END LOOP;
END;
$$;
