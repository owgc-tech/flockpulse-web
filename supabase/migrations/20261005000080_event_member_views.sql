-- FP-222-web (part 1 of 2): server support for the Needs Attention and Recently
-- Modified indicators on the mobile Events tab.
--
--   * event_member_views  — the last events.version each member viewed of each event
--                           (drives "Recently Modified": events.version > last_seen_version)
--   * record_event_view() — the only writer; never lowers a stored version
--   * events_with_outstanding_refusals() — set-based lookup behind "Needs Attention",
--                           so the event list needs a constant number of queries
--   * remove_member()     — FP-237's function plus deleting the member's view rows
--
-- FP-228 conventions: the table is API-only (RLS on, NO policies, nothing granted to
-- anon or authenticated); the functions are closed to PUBLIC/anon/authenticated and
-- granted to service_role only.


-- ==============================================================
-- SECTION A: event_member_views
-- ==============================================================

CREATE TABLE IF NOT EXISTS event_member_views (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    last_seen_version INT NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, member_id)
);

-- lookups by member (list flags) and removal cleanup
CREATE INDEX IF NOT EXISTS idx_event_member_views_member
    ON event_member_views(tenant_id, member_id);

-- Cross-tenant safety trigger (standing rule for every tenant-scoped table with FKs):
-- event and member must both belong to the row's tenant. Deliberately no
-- deleted_at requirement on the member — this is only referential safety.
CREATE OR REPLACE FUNCTION public.validate_event_member_views_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM events WHERE id = NEW.event_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'event_member_views.event_id % is invalid or belongs to a different tenant', NEW.event_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM members WHERE id = NEW.member_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'event_member_views.member_id % is invalid or belongs to a different tenant', NEW.member_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_event_member_views_tenant_scope ON event_member_views;
CREATE TRIGGER trigger_validate_event_member_views_tenant_scope
BEFORE INSERT OR UPDATE ON event_member_views
FOR EACH ROW EXECUTE FUNCTION validate_event_member_views_tenant_scope();

-- API-only (FP-228): RLS on, no policies, nothing for anon/authenticated.
ALTER TABLE event_member_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON event_member_views FROM PUBLIC, anon, authenticated;
GRANT ALL ON event_member_views TO service_role;


-- ==============================================================
-- SECTION B: record_event_view(p_tenant_id, p_event_id, p_member_id, p_version)
--
-- INSERT ... ON CONFLICT (event_id, member_id) DO UPDATE with
-- last_seen_version = GREATEST(existing, new): a stale or lower version never lowers
-- the stored one. last_seen_at = now() on every call.
--
-- A removed member is a no-op (nothing is written), so a late best-effort call can
-- never leave a view row behind after removal.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.record_event_view(
  p_tenant_id UUID, p_event_id UUID, p_member_id UUID, p_version INT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM members WHERE id = p_member_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
  ) THEN
    RETURN;
  END IF;

  INSERT INTO event_member_views (tenant_id, event_id, member_id, last_seen_version, last_seen_at)
  VALUES (p_tenant_id, p_event_id, p_member_id, p_version, now())
  ON CONFLICT (event_id, member_id) DO UPDATE
  SET last_seen_version = GREATEST(event_member_views.last_seen_version, EXCLUDED.last_seen_version),
      last_seen_at = now();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_event_view(UUID, UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_event_view(UUID, UUID, UUID, INT) TO service_role;


-- ==============================================================
-- SECTION C: events_with_outstanding_refusals(p_tenant_id, p_event_ids)
--
-- The events (among p_event_ids) that have at least one OUTSTANDING refusal: a
-- response that is current, REFUSED, and still attached to an assignment, whose
-- person STILL resolves as an assignee of that assignment (the same rule the web
-- event page applies to its "Refused: Name" line, via resolve_assignee_member_ids —
-- so the mobile indicator and the web page never disagree, e.g. when someone left a
-- group without anything clearing their row). History rows (is_current = false) are
-- ignored. One call for the whole list, however many events it holds.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.events_with_outstanding_refusals(p_tenant_id UUID, p_event_ids UUID[])
RETURNS TABLE (event_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT DISTINCT r.event_id
  FROM event_task_assignment_responses r
  JOIN event_tasks_assignments a ON a.id = r.assignment_id AND a.tenant_id = r.tenant_id
  WHERE r.tenant_id = p_tenant_id
    AND r.event_id = ANY(p_event_ids)
    AND r.assignment_id IS NOT NULL
    AND r.is_current
    AND r.status = 'REFUSED'
    AND EXISTS (
      SELECT 1 FROM public.resolve_assignee_member_ids(p_tenant_id, a.assignee) x
      WHERE x.member_id = r.member_id
    )
$$;

REVOKE EXECUTE ON FUNCTION public.events_with_outstanding_refusals(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.events_with_outstanding_refusals(UUID, UUID[]) TO service_role;


-- ==============================================================
-- SECTION D: remove_member() — CREATE OR REPLACE of the CURRENT definition
-- (20261004000079, FP-237), nothing changed except one added statement: delete the
-- member's event_member_views rows. Like the rest of the tail it runs on EVERY
-- branch (normal removal, finishing an earlier plain deactivation, an
-- already-removed retry), so retries and the cleanup below complete it.
-- Same signature, privileges, labels and idempotency.
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

  RETURN v_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_member(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_member(UUID, UUID, TEXT) TO service_role;


-- ==============================================================
-- One-time cleanup (idempotent): view rows of members that were already removed.
-- Expected: none yet — the table is new — but the rule is stated once, here, so a
-- row can never outlive its member. A second run changes nothing.
-- ==============================================================

DO $$
DECLARE
  v_deleted INT;
BEGIN
  WITH d AS (
    DELETE FROM event_member_views v
    USING members m
    WHERE m.id = v.member_id AND m.deleted_at IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM d;

  RAISE NOTICE 'FP-222: deleted % event_member_views row(s) belonging to already-removed members', v_deleted;
END
$$;
