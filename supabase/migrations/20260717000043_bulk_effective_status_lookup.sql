-- FP-121: bulk effective-status lookup so list queries can filter on the
-- canonical derived state (get_event_effective_status) in one round trip
-- instead of duplicating window arithmetic in the application layer.

DROP FUNCTION IF EXISTS public.get_events_effective_statuses(UUID, UUID[]);

CREATE FUNCTION public.get_events_effective_statuses(
    p_tenant_id UUID,
    p_event_ids UUID[]
)
RETURNS TABLE(event_id UUID, effective_status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT e.id, public.get_event_effective_status(e.id)
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND e.id = ANY(p_event_ids);
$$;

-- Service-role only: this is a server-side list helper, and granting it to
-- authenticated would allow cross-tenant status probing by arbitrary UUID.
REVOKE EXECUTE ON FUNCTION public.get_events_effective_statuses(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_events_effective_statuses(UUID, UUID[]) TO service_role;
