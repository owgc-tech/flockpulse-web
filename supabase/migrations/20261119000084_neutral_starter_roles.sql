-- FP-262: neutral starter roles for new communities.
--
-- Until now every new community got OWGC's seven role names, including
-- "Pastoral Leader", "Community Servant" and "Sr. Coordinator". New communities
-- now start with four neutral roles:
--
--   Member       MEMBER  1
--   Leader       LEADER  2
--   Coordinator  ADMIN   3
--   Admin        ADMIN   4
--
-- Only the VALUES list of create_role_catalog_for_new_tenant() changes (same
-- signature, language, SECURITY DEFINER and search_path as migration 065).
-- The trigger is not dropped or recreated. Existing tenants' role_catalog rows
-- (including OWGC's seven roles) are not touched. Safe to run more than once.

CREATE OR REPLACE FUNCTION public.create_role_catalog_for_new_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO role_catalog (tenant_id, name, tier, sort_order) VALUES
    (NEW.id, 'Member',      'MEMBER', 1),
    (NEW.id, 'Leader',      'LEADER', 2),
    (NEW.id, 'Coordinator', 'ADMIN',  3),
    (NEW.id, 'Admin',       'ADMIN',  4);
  RETURN NEW;
END;
$$;

-- FP-228: functions are not executable by PUBLIC / anon / authenticated.
-- CREATE OR REPLACE keeps existing privileges; this restates them explicitly.
-- A trigger function needs no EXECUTE privilege to fire.
REVOKE EXECUTE ON FUNCTION public.create_role_catalog_for_new_tenant() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_role_catalog_for_new_tenant() TO service_role;
