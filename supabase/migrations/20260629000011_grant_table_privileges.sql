-- All prior migrations relied on SECURITY DEFINER RPCs for writes, which run as
-- postgres and bypass table-level grants. But repository functions that do direct
-- table SELECTs (existence checks, list queries, single-row fetches) through the
-- PostgREST service-role client fail because the default ALTER DEFAULT PRIVILEGES
-- only granted TRUNCATE/REFERENCES/TRIGGER — not SELECT/INSERT/UPDATE/DELETE.
--
-- This migration adds the missing DML grants explicitly so that the service-role
-- client can execute direct table queries. Idempotent — GRANT is a no-op if the
-- privilege already exists.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants                   TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.members                   TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups                    TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignments               TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events                    TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_attendees           TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_notifications       TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rsvps                     TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.member_attendance_reports TO service_role, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance                TO service_role, authenticated;

-- Sequences (needed for any serial/identity columns, if present)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role, authenticated;

-- Ensure future tables created by postgres also get DML grants automatically.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, authenticated;
