### DIP — FP-236 (Web): the audit log keeps ids, not identifying details; a removed member's own words are replaced

### Not covered — deliberately excluded
- **The privacy policy text (FP-171).** After this ships, the policy can say that identifying details are deleted on removal, including from the audit log. Writing that text is FP-171.
- **Free text written by other people about a member** (event names, announcement bodies, group names). These are not the member's own words and are not identifying member data. Unchanged.
- **Ids that stay in the audit log** (`actor_id`, `entity_id`, member ids inside event `target`, assignment leader ids). Keeping them is the decision: after removal an id resolves to "Deactivated User" or "Self-deleted User".
- **The Audit Logs page** (`app/admin/(shell)/audit-logs`). No code change: it shows whatever JSON is stored, which is now redacted.
- **Supabase backups and provider logs.** They follow their own retention; this is noted for FP-171.
- **The phone.** No change.

### Story Summary
The audit log keeps a full copy of every member's row from registration (name, email, birthdate, gender, marital status, login id) and every revoked invitation's email. Because the log is append-only, removing a member (FP-235) could not clean it.

Decisions:
- **Joseph, 2026-10-04:** keep ids, not identifying details. Redact the existing entries once, through a narrow, controlled exception to the append-only rule. When a member is removed, also replace their own words.
- **Atlas defaults, applied here and stated to Joseph on 2026-10-06:**
  - The replacement text is `[removed]`.
  - It covers RSVP reasons, self-report reasons and feedback, and leader notes about the member (`attendance.leader_note`, which also holds admin-override reasons).
  - It applies both in the tables and in the audit entries.
  - Members removed before this change get the same treatment now.

This is a **migration-only change plus a test script**: one migration and one new local test, no application code. The redaction lives in the database, so every writer is covered, the SQL functions and the one TypeScript caller of `write_audit_log` (talk completions) alike.

### Repo Target
Web (`owgc-tech/flockpulse-web`): one migration and one test script. No dependency on the phone.

### Grounding Check
Verified this session on web `dev` at `49fe3ab`. **Re-verify each point first.**

**The audit table and its rules** (migration `20260629000017_audit_logs.sql`):
- The table has `id, tenant_id, entity_type, entity_id, action, actor_id (no FK), before_value JSONB, after_value JSONB, created_at`.
- It is append-only: `REVOKE UPDATE, DELETE ... FROM authenticated, service_role`, plus a trigger `trigger_block_audit_log_update` that runs `block_audit_log_update()` and always raises.
- The single writer is `write_audit_log(p_tenant_id, p_entity_type, p_entity_id, p_action, p_actor_id, p_before, p_after)` (section 5), and it has never been redefined.

**Who writes identifying data today** (latest definition of every function that calls `write_audit_log`, found by scanning all migrations):
- `complete_registration` (latest in `20260806000065`) and `create_tenant_and_founding_admin` (`20260705000022`) write `('member', id, 'register', …, to_jsonb(members row))`, the full row. The row's columns are `id, tenant_id, user_id, email, role, created_at, first_name, last_name, deleted_at, gender, marital_status, birthdate, mfa_trust_duration_days, role_catalog_entry_id`.
- `revoke_invitation` (`20260629000021`) writes `('invitation', …, to_jsonb(invitations row), NULL)`, which holds `email` and `auth_user_id`.
- `upsert_rsvp_with_audit` (latest `20260804000063`) writes the whole `rsvps` row, including `rsvp_reason`. `insert_self_report_yes_with_audit`, `submit_self_report_no` and `resolve_leader_confirmation` write whole `member_attendance_reports` rows, including `reason` and `feedback`. `admin_override_attendance`, `submit_self_report_no` and `resolve_leader_confirmation` write whole `attendance` rows, including `leader_note`. Each of these rows carries `member_id`.
- TypeScript calls `write_audit_log` once: `src/features/formation/talk-completions.service.ts`, line 110 (`talk_completion`, no free text).
- Every other writer stores ids, names of groups, or event rows. None of that is member data.

**Who reads the audit JSON.** `src/features/audit/audit.repository.ts` (`getAuditLogs`) and the Audit Logs page show the JSON as stored. `src/features/events/modifiedFields.ts` reads only `entity_type = 'event'` entries (`version` and column diffs). Nothing reads member or invitation entries by key.

**`remove_member`.** Its current definition is in `20261005000080_event_member_views.sql`, section D (lines 154–242). It writes no audit entry. Grants: service_role only.

**Main-table constraints the placeholder must satisfy:**
- `rsvps_reason_required_check`: a NO needs a non-blank reason.
- `self_reports_reason_required_check`, `self_reports_yes_only_fields_check` (feedback on YES only) and `self_reports_feedback_length_check` (1000 or fewer).

`[removed]` satisfies all of them, and the update keeps NULLs as NULL.

**A trap found while grounding.** `enforce_rsvp_guest_count_max()` (`20260804000063`) runs on every UPDATE of `rsvps`. If a community lowers its guest maximum after someone RSVPed with more guests, any update of that RSVP fails, so replacing the reason would block the removal. Atlas reproduced this on a scratch database. The migration changes the trigger to check only when `guest_count` is set or changed. That is a behavior change only for updates that do not touch `guest_count`.

**Atlas pre-check of the migration below.** This is inference about your copy, not proof. Atlas applied it twice to a scratch PostgreSQL 16 database. It used stand-in tables with the real constraints, plus the real `audit_logs` (sections 1–3 and 5 of `000017`), the real `enforce_rsvp_guest_count_max` and `upsert_rsvp_with_audit`, and the real `remove_member` from `000080`. Results:
- Legacy member and invitation entries were cut to ids. One `redact_audit_identifiers` entry was recorded per community.
- A member removed earlier had their RSVP reason replaced, in the table and in the audit log, with one `member_redaction` entry.
- A second apply changed nothing and recorded nothing.
- Removing an active member whose RSVP has 7 guests against a maximum of 5:
  - the removal succeeded, and the guest count stayed 7;
  - the reason, feedback and leader note were replaced in the tables and audit entries;
  - another member's reason was untouched;
  - a regular-expression search for every planted name, email, birth year and phrase found **0** matches;
  - removing the same member again added no second redaction record.
- A new `member` write stores only `id, role, tenant_id, role_catalog_entry_id`, and an `event` write is unchanged.
- An UPDATE of `after_value` without the flag is refused. An UPDATE of `actor_id` with the flag on is refused. service_role still has no UPDATE or DELETE on `audit_logs`.
- After `remove_member` inside a larger transaction, the flag was back to empty.
- The redaction function is not executable by `anon`, `authenticated` or `service_role`.
- The guest maximum is still enforced when `guest_count` changes.

Atlas will re-run all of this on the real file in review.

**Invariants.**
- Attendance statuses, confirmation types, RSVP statuses, ratings and counts are never changed, so reports and formation credit are unaffected (Section 4, rules 1 and 4).
- Removal stays permanent and keeps the shell row (rule 5).
- Tenant scoping is applied in every statement.
- FP-228: the new helpers are closed to `anon` and `authenticated`, and the redaction function is closed to everyone but its owner.
- This is a destructive one-time operation, so Section 5 rule 19 applies: preview query first, Joseph confirms, idempotent, tested on scratch.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-236-web.md`, then create branch `feature/FP-236-web-audit-ids-only` off current `dev`.
2. **Migration.** Write `supabase/migrations/20261006000083_audit_ids_only_and_removed_member_text.sql` **exactly** as in "Migration Files" below. Confirm `083` is the next free number.
   - **Section 6 is a CREATE OR REPLACE of `remove_member`.** Before writing it, programmatically diff its body against the definition in `20261005000080`, section D. The only difference must be the three added lines (the comment and the `PERFORM`). If the current definition differs from what is printed here, stop and report.
   - Validate with `supabase db reset`.
3. **Tests.** New file `scripts/test-fp236-audit-redaction.ts` (force-add; `npx tsx`; local database after `supabase db reset`; real service code where it exists, the same setup style as the FP-235 and FP-237 scripts). Cover:
   - **Registration, both kinds.** Run founder registration (`create_tenant_and_founding_admin` through its real caller) and invite registration (`complete_registration` through its real caller). Each new `member`/`register` entry holds exactly the keys `id, tenant_id, role, role_catalog_entry_id`.
   - **Revoking an invitation** through the real route or service writes an entry with no `email` and no `auth_user_id`.
   - **Removal through the real `removeMember`, both reasons** (`DEACTIVATED` and `SELF_DELETED`), of a member who has: a NO RSVP with a reason; a YES self-report with feedback; a NO self-report with a reason; a leader-confirmed attendance with a note; an admin override with a reason; and an RSVP whose guest count exceeds a since-lowered community maximum. After removal:
     - every one of those texts is `[removed]` in the tables and in every audit entry about that member;
     - statuses, ratings, guest counts and attendance statuses are unchanged;
     - exactly one `member_redaction` / `redact_personal_text` entry exists, with the counts;
     - another member's texts are unchanged;
     - a database-wide search of `audit_logs` (`before_value::text || after_value::text`) for the removed member's original first name, last name, email and every planted phrase returns 0 rows.
   - **Idempotency.** Removing the same member again changes nothing and adds no second redaction entry.
   - **Append-only still holds.** As service_role, `update audit_logs` is refused (no privilege). As the owner without the flag, an UPDATE of `after_value` is refused. With the flag on, an UPDATE of `action` or `actor_id` is refused. After `remove_member`, `current_setting('app.audit_redaction', true)` is not `on`.
   - **Privileges.** `redact_removed_member_personal_text` cannot be executed by `anon`, `authenticated` or `service_role`. The two helpers are not executable by `anon` or `authenticated`. `remove_member` is service_role only.
   - **The one-time section.** Seed legacy full-row member and invitation entries plus an already-removed member with leftover texts, run section 7 again by applying the migration twice, and check the results match the preview query (below) before and after.
   - **Events.** An event audit entry is unchanged, and `modifiedFields` still derives labels: run `test-fp222-adj1-what-changed.ts`.
   - **Regression.** Also run `test-fp222-adj1-what-changed.ts`, `test-fp222-indicator-flags.ts`, `test-fp239-event-visibility.ts`, `test-fp240-roster-visibility.ts`, `test-fp242-assignee-states.ts`, and every existing FP-235 and FP-237 and member-removal script. Report each against its baseline.
4. **Checks.** Run `npx tsc --noEmit`, and run the FP-228 privilege check. Commit, push, and run `gh pr create --base dev`.

### Files to Create/Modify
- Create:
  - `documentation/dips/DIP-FP-236-web.md` (verbatim, then frozen)
  - `supabase/migrations/20261006000083_audit_ids_only_and_removed_member_text.sql`
  - `scripts/test-fp236-audit-redaction.ts` (force-add)
- Modify: none. If a test cannot reach a path without a code change, stop and report rather than changing application code.
- Must stay untouched: every file under `src/` and `app/`, and every existing migration. Show `git diff dev feature/FP-236-web-audit-ids-only --stat` listing only the three created files.

### Migration Files (if applicable)
`supabase/migrations/20261006000083_audit_ids_only_and_removed_member_text.sql`. Written to disk and validated locally; **never applied to a remote database by Claude Code**. Copy it exactly:

```sql
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
```

**Order for Joseph.** This rewrites existing audit entries and free text once, and it cannot be undone (Section 5, rule 19):
1. **Preview first** (read-only; it changes nothing). Run this in the Supabase SQL Editor and paste the result to Atlas:
   ```sql
   -- FP-236 preview (read-only). Run BEFORE applying 20261006000083. Changes nothing.
   WITH removed AS (SELECT tenant_id, id FROM members WHERE deleted_at IS NOT NULL)
   SELECT 'member audit entries holding more than ids' AS what, count(*) AS how_many
   FROM audit_logs a
   WHERE a.entity_type = 'member' AND EXISTS (
     SELECT 1 FROM jsonb_object_keys(COALESCE(a.after_value, '{}') || COALESCE(a.before_value, '{}')) k
     WHERE k NOT IN ('id', 'tenant_id', 'role', 'role_catalog_entry_id'))
   UNION ALL
   SELECT 'invitation audit entries holding an email or auth id', count(*)
   FROM audit_logs a
   WHERE a.entity_type = 'invitation' AND EXISTS (
     SELECT 1 FROM jsonb_object_keys(COALESCE(a.after_value, '{}') || COALESCE(a.before_value, '{}')) k
     WHERE k NOT IN ('id', 'tenant_id', 'role', 'role_catalog_entry_id', 'group_id', 'invited_by', 'status', 'invited_at', 'responded_at'))
   UNION ALL
   SELECT 'members already removed', count(*) FROM removed
   UNION ALL
   SELECT 'their RSVP reasons to replace', count(*) FROM rsvps r JOIN removed m ON m.id = r.member_id AND m.tenant_id = r.tenant_id
   WHERE r.rsvp_reason IS NOT NULL AND r.rsvp_reason <> '[removed]'
   UNION ALL
   SELECT 'their self-reports with a reason or feedback to replace', count(*) FROM member_attendance_reports s JOIN removed m ON m.id = s.member_id AND m.tenant_id = s.tenant_id
   WHERE (s.reason IS NOT NULL AND s.reason <> '[removed]') OR (s.feedback IS NOT NULL AND s.feedback <> '[removed]')
   UNION ALL
   SELECT 'leader notes about them to replace', count(*) FROM attendance t JOIN removed m ON m.id = t.member_id AND m.tenant_id = t.tenant_id
   WHERE t.leader_note IS NOT NULL AND t.leader_note <> '[removed]'
   UNION ALL
   SELECT 'their rsvp / self-report / attendance audit entries to check', count(*) FROM audit_logs a JOIN removed m ON m.tenant_id = a.tenant_id
   WHERE a.entity_type IN ('rsvp', 'self_report', 'attendance')
     AND (a.before_value ->> 'member_id' = m.id::text OR a.after_value ->> 'member_id' = m.id::text);
   ```
2. After Atlas confirms the preview, apply the migration as **one script**: paste the whole file and run it once. Old code is unaffected by the order (no application code changes), so the merge can come before or after.
3. Run the preview query again. The first two rows and the three "to replace" rows should all read 0. "members already removed" and the last row stay the same, because those entries are kept, just redacted.

### Branch Name
feature/FP-236-web-audit-ids-only

### Commit Message
FP-236-web: audit log keeps ids only; a removed member's own words are replaced

### Pull Request Description
Plain GitHub markdown. Include the following.

**Summary.** State that this is migration-only plus a test script. Include the order note: preview query, Atlas confirms, apply as one script, preview again.

**Acceptance criteria → behavior**, one line each, with evidence:
- no member, invitation or removed-member text remains in `audit_logs` after removal (show the search query and its 0 result);
- new registrations store ids only;
- append-only still blocks every other update;
- the redaction is recorded;
- statuses, ratings and counts are unchanged;
- idempotent;
- the guest-count trap is fixed.

**The `remove_member` diff** against `000080`, section D, which must be only the added lines.

**Deviations from this DIP**, with reasons, including any grounding claim that turned out wrong.

**Not tested.** The hosted database, the real counts on fpdb-dev (the preview gives them), and concurrency.

**Manual steps for Joseph**, after applying:
1. Web Audit Logs page: open a member "register" entry. It shows only id, tenant, role and role entry.
2. Remove a test member who has an RSVP "No" reason and self-report feedback, using the designated test account and phone. In the RSVP report, their reason reads `[removed]`. The Audit Logs page shows one "redact_personal_text" entry for them.
3. Register a new test member. Their "register" entry shows ids only.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-236

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-236-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
