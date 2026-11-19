-- DIP-FP-127-FP-128-web: widen rsvps.rsvp_status to add TENTATIVE.
--
-- Constraint name looked up dynamically via pg_constraint, matching the
-- precedent set in 20260715000038_expand_role_model.sql (members.role /
-- invitations.role) — do not hardcode "rsvps_rsvp_status_check" by
-- convention-guessing; verify it live instead.
--
-- Deviation from the DIP text (flagged in the PR description): the lookup
-- below adds "array_length(con.conkey, 1) = 1" on top of the DIP's original
-- join. Without it, the att.attnum = ANY(con.conkey) join also matches
-- rsvps_reason_required_check (its conkey covers both rsvp_status and
-- rsvp_reason), and a plain (non-STRICT) SELECT INTO with two matching rows
-- picks one arbitrarily — confirmed locally via `supabase db reset` picking
-- rsvps_reason_required_check, dropping the wrong constraint and leaving the
-- original YES/NO-only check in place. Restricting to single-column
-- constraints excludes the composite reason-required check and makes the
-- lookup deterministic.

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
  WHERE con.conrelid = 'rsvps'::regclass
    AND con.contype = 'c'
    AND att.attname = 'rsvp_status'
    AND array_length(con.conkey, 1) = 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE rsvps DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE rsvps
  ADD CONSTRAINT rsvps_rsvp_status_check
  CHECK (rsvp_status IN ('YES', 'NO', 'TENTATIVE'));

-- rsvps_reason_required_check (rsvp_status = 'NO' requires rsvp_reason) is
-- unaffected — TENTATIVE falls through its OR clause exactly like YES does,
-- correctly requiring no reason. Not touched.
