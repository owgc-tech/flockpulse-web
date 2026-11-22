### DIP — FP-257 (Web): make post-event feedback and star ratings truly anonymous

### Not covered — deliberately excluded
- **The phone's confirmation screen** (it still shows rating and feedback when the server sends them): `DIP-FP-257-mobile`. It is independent and can run in parallel.
- **The Board's look and response shape:** unchanged (`rating.feedback` stays a list of `{ star_rating, feedback }`, plus average, rounded, count and breakdown).
- **FP-254** (birthdate on removal): on hold. This DIP replaces `redact_removed_member_personal_text()` but does **not** touch `remove_member()`; FP-254 must build on this merged.
- **Old backups:** Supabase's own backups of `fpdb-dev` still hold the old rows until they expire on their own. Nothing to do in code.
- **`audit_redact_member_text()`:** it still lists `feedback` as a self-report key. That is harmless once no entry has the key, so it stays unchanged.
- **Privacy Policy and Harvey's documents:** Joseph updates them; this DIP only makes the code match "stored without any link to the person who wrote them".

### Story Summary
Joseph's rule: feedback is anonymous. Today only the Board hides the author. The feedback and rating sit on the author's own self-report row, Leaders see them with the member's name while confirming, and the audit log copies them with the member as actor.

This DIP moves feedback and ratings into a new table, `event_feedback`, that holds **only** `id` (random UUID), `tenant_id`, `event_id`, `star_rating` and `feedback`: no author, no report id, no date, no time (final decision, Joseph, 2026-11-18). The Yes self-report and its feedback row are written by one function. Nothing about feedback goes into the audit log, not even `has_feedback` (with one person giving feedback on an event, a `has_feedback: true` next to their member id would itself point to the author, so Atlas chose "nothing", which the ticket allows). Leaders no longer receive feedback when confirming. The Board reads the new table and never shows submission order.

It ships in three steps, so nothing breaks while the old code is still live:
1. **Migration `…088`** (additive): the table, the new write function, the revised redaction function.
2. **A one-time data move** in `documentation/sql/FP-257-move.sql`: preview, move, verify. Joseph runs it.
3. **Migration `…089`:** drops `feedback` and `star_rating` from `member_attendance_reports`. It refuses to run if anything was not moved.

### Repo Target
Web (`owgc-tech/flockpulse-web`). Migrations, the self-report write path, the confirmations list, the Board query. The mobile half is independent.

### Grounding Check
**Verified by Atlas this session** (`origin/dev` at `e05d0f1`, migrations up to `20261120000087`):
- **Table** `member_attendance_reports` (`20260629000008`): `feedback TEXT`, `star_rating INT`, and the CHECKs `self_reports_yes_only_fields_check`, `self_reports_feedback_length_check` (≤1000) and `self_reports_star_rating_range_check`. Unique index on `(tenant_id, event_id, member_id)`. Same-tenant trigger `validate_self_report_tenant_scope`.
- **`insert_self_report_yes_with_audit(p_tenant_id, p_event_id, p_member_id, p_feedback, p_star_rating)`** (`20260629000017`, section 7) inserts the row with feedback and rating, writes `to_jsonb(v_row)` to the audit log with the member as actor, and returns a table that includes `feedback` and `star_rating`. Called from `src/features/self-reports/self-report.repository.ts` `insertSelfReportYes` (around line 72).
- **`resolve_leader_confirmation`** (latest in `20260707000026`, around line 157) writes `to_jsonb(mar)` before and after into the self-report audit entry, so it copies feedback and rating today. **It needs no change:** once the columns are gone, `to_jsonb` no longer contains them. `submit_self_report_no` and `admin_override_attendance` never touch feedback.
- **`redact_removed_member_personal_text`** (only definition: `20261006000083`, section 5) sets `feedback = '[removed]'` on the removed member's reports. It is called by `remove_member()` (now in `…087`) and by the FP-236 one-time cleanup. **It must stop referencing `feedback` before the column is dropped,** or every removal fails.
- **Audit updates** are blocked by `block_audit_log_update()` unless `app.audit_redaction = 'on'` and only `before_value`/`after_value` change (FP-236 pattern, `…083` section 3).
- **Web readers of the columns** (grep of `src` and `app`):
  - `src/features/confirmations/confirmation.repository.ts` `getPendingConfirmations` selects `feedback, star_rating` with the member's name (lines ~37–45) and maps them (~136–137); `confirmation.types.ts` lines 14–15.
  - `src/features/reports/report.repository.ts` Board card 3 (~1016–1044) reads `member_attendance_reports.star_rating, feedback` for `SELF_REPORTED_YES` reports; the feedback list keeps query order.
  - `src/features/self-reports/self-report.repository.ts` `getSelfReportById` (~226) selects both columns; `self-report.types.ts` `SelfReportRow` and `SelfReportResponse`; `self-report.service.ts` returns `row.feedback`/`row.star_rating` in both the Yes and No paths.
  - `app/api/self-reports/route.ts` passes `feedback` and `star_rating` from the body (unchanged).
  - No web admin page shows feedback (`app/admin` grep is empty).
  - `scripts/test-fp236-audit-redaction.ts` plants feedback and reads the columns (lines ~94–132, ~215). It must be updated.
- **Board ratings today** count every Yes report, whatever the confirmation result. The new table keeps that behavior.

**Scratch-database test by Atlas** (PostgreSQL 16, all migrations through `…087`, with legacy rows in two communities, a removed member's `[removed]` feedback, a confirm, a No report): the SQL below was applied **verbatim** and checked.
- `…088` applied twice without error. The table has exactly the five columns, RLS on, no access for `authenticated`, the function is closed to `authenticated` and open to `service_role`.
- A Yes with blank feedback and rating 4 stores rating 4 and NULL feedback. A Yes with neither stores no feedback row. A rating of 9 is refused and the self-report is rolled back too (atomic). A feedback row pointing at another community's event is refused.
- The new audit entry has no `feedback`, `star_rating` or `has_feedback` key.
- Move: preview `4 | 4 | 6 | 0`; section B copied 4 rows (the removed member's `[removed]` text was not copied, its rating was), cleared 4, scrubbed 6 audit entries; run again: 0, 0, 0. Other community's feedback moved with its own tenant id.
- `…089` refused while a rating was left on a report, then applied twice. Afterwards: both columns and their three CHECKs gone, removal redaction works, Yes, confirm and reject work, and new feedback text never appears in the audit log.
- One expected leftover: a confirm made **between** the move and `…089` writes `"feedback": null, "star_rating": null` keys into that one audit entry. No data, so `…089` allows it.

**Re-verify all of the above first**, and report differences before changing anything. Also:
1. Grep the whole repo (including `scripts/` and `documentation/sql/`) for `feedback` and `star_rating` again, and list every hit you change or leave.
2. Confirm no view, policy or other function references the two columns: after `…089` locally, run `SELECT proname FROM pg_proc WHERE prosrc ILIKE '%feedback%'` and explain each hit (expected: comments only, plus the new function and the redaction key list).

**Rules check:**
- Atomic write (rule 5): one `SECURITY DEFINER` function.
- Same-tenant trigger on `event_id` (rule 4).
- API-only access (FP-228): RLS on, no policies, nothing for `anon` or `authenticated`.
- Error codes unchanged (`VALIDATION_ERROR` for bad rating or length).
- Destructive steps previewed and idempotent (rule 19).
- **Supersessions** (Joseph, 2026-11-18): v3 invariant rule 1 no longer lists `feedback` and `star_rating` on `member_attendance_reports`; STORY-6.2/6.5 (Leader sees feedback when confirming) is superseded.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-257-web.md`. Create `feature/FP-257-anonymous-feedback` off current `dev`. Report the grounding answers.

2. **Migrations.** Write `supabase/migrations/20261120000088_anonymous_event_feedback.sql` and `supabase/migrations/20261120000089_drop_self_report_feedback_columns.sql` exactly as given below (confirm both numbers are still free). For the redaction function in `…088` section 3, check programmatically that it is the `…083` definition with **only** the `member_attendance_reports` UPDATE changed, and show that diff in the PR.

3. **Move script.** Write `documentation/sql/FP-257-move.sql` with sections A, B and C as given below, and a header that says: run A after `…088`, B only after Joseph confirms A, C after B; `…089` only after the code is live.

4. **Self-report write path.**
   - `self-report.types.ts`: remove `feedback` and `star_rating` from `SelfReportRow`. **Keep them in `SelfReportResponse`** so the phone's contract is unchanged.
   - `self-report.repository.ts`: `getSelfReportById` no longer selects the two columns. `insertSelfReportYes` keeps its parameters.
   - `self-report.service.ts`: validation unchanged. The response echoes what the member just sent: Yes → `feedback: feedback ?? null`, `star_rating: starRating ?? null`; No → both `null`. Do not read them back from the database.

5. **Confirmations.** Remove `feedback` and `star_rating` from the select, the mapping and `PendingConfirmationRow`. Add a comment: Leaders never see feedback (FP-257).

6. **Board** (`report.repository.ts` card 3):
   - Read `event_feedback` (`star_rating, feedback`) filtered by `tenant_id` and `event_id`. Never select or order by `id`.
   - Average, rounded, count and breakdown as today.
   - Feedback list: entries with non-blank feedback, ordered by a new pure helper `orderAnonymousFeedback(rows, random = Math.random)` in `src/features/reports/anonymous-feedback.ts`: shuffle (Fisher–Yates with `random`), then a stable sort by `star_rating` high to low, entries without a rating last. So the order never reflects submission order.
   - Update the anonymization comment to describe the new table.
   - Same response shape.

7. **Update `scripts/test-fp236-audit-redaction.ts`** minimally: it must no longer plant or read the dropped columns, and must no longer expect `[removed]` feedback. Keep every other check. Say exactly what changed.

8. **Test script** `scripts/test-fp257-anonymous-feedback.ts` (force-add; calls `assertLocalDb()` first, FP-263), against the local database after `supabase db reset`:
   - **Schema:** `event_feedback` has exactly `id, tenant_id, event_id, star_rating, feedback`; `member_attendance_reports` has no `feedback` or `star_rating`.
   - **Write:** submitting Yes through `submitSelfReport` with feedback and rating creates one `event_feedback` row and returns the echoed values; blank feedback with no rating creates none; rating 0 or 6 and 1001 characters give `VALIDATION_ERROR` and no rows; No with feedback still gives `VALIDATION_ERROR`.
   - **Planted check (the ticket's test):** plant a unique phrase as feedback. Then prove it never appears together with the author: not in any `audit_logs` row (search the whole JSON text), not in `listPendingConfirmations` output (also assert no `feedback` or `star_rating` key at all), and the Board's entry for it carries only `star_rating` and `feedback`.
   - **Order:** `orderAnonymousFeedback` with a fixed `random` gives rating-descending order, unrated last, and two different `random` functions can reorder equal ratings.
   - **Removal:** `remove_member` on a member who left feedback succeeds; the anonymous feedback stays (not linked).
   - **Other community** untouched throughout.
   - **Move script on local data:** before `…089` is applied, plant legacy rows, run section B twice, check A gives zeros. (Use `supabase migration up` or apply `…088` alone on a fresh reset as needed, and say how.)

9. **Checks.** Run `npx tsc --noEmit`, lint, the new script, `test-fp236-audit-redaction.ts` and the existing self-report and confirmation scripts. `git diff dev --stat` lists only the expected files.

10. **Commit, push, and open the PR** with `gh pr create --base dev`.

### Files to Create/Modify
- **Create (force-add where gitignored):**
  - `documentation/dips/DIP-FP-257-web.md` (verbatim, then frozen);
  - `supabase/migrations/20261120000088_anonymous_event_feedback.sql`;
  - `supabase/migrations/20261120000089_drop_self_report_feedback_columns.sql`;
  - `documentation/sql/FP-257-move.sql`;
  - `src/features/reports/anonymous-feedback.ts`;
  - `scripts/test-fp257-anonymous-feedback.ts`.
- **Modify:**
  - `src/features/self-reports/self-report.types.ts`, `self-report.repository.ts`, `self-report.service.ts`;
  - `src/features/confirmations/confirmation.repository.ts`, `confirmation.types.ts`;
  - `src/features/reports/report.repository.ts` (card 3 only);
  - `app/api/reports/dashboard/stats/route.ts` (comment only, if needed);
  - `scripts/test-fp236-audit-redaction.ts`.
- **Must stay untouched:** `remove_member()` and every earlier migration, `app/api/self-reports/route.ts`, `resolve_leader_confirmation`, `audit_redact_member_text`, `.env.local`.

### Migration Files (if applicable)
Written to disk, validated locally with `supabase db reset`, **never applied to a remote database by Claude Code.**

**`supabase/migrations/20261120000088_anonymous_event_feedback.sql`:**
```sql
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
```

**`supabase/migrations/20261120000089_drop_self_report_feedback_columns.sql`:**
```sql
-- FP-257 part 2: drop feedback and star_rating from member_attendance_reports.
-- Apply only after the data move (documentation/sql/FP-257-move.sql B) and after the
-- FP-257 web code is merged and live. Refuses to run if anything was not moved.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'member_attendance_reports'
               AND column_name IN ('feedback', 'star_rating')) THEN
    IF EXISTS (SELECT 1 FROM member_attendance_reports WHERE feedback IS NOT NULL OR star_rating IS NOT NULL) THEN
      RAISE EXCEPTION 'FP-257: feedback or ratings are still on member_attendance_reports. Run documentation/sql/FP-257-move.sql section B first.';
    END IF;
  END IF;
  -- Non-null values only: a confirm between the move and this migration writes null keys, which are harmless.
  IF EXISTS (SELECT 1 FROM audit_logs WHERE entity_type = 'self_report'
             AND (before_value ->> 'feedback' IS NOT NULL OR before_value ->> 'star_rating' IS NOT NULL
                  OR after_value ->> 'feedback' IS NOT NULL OR after_value ->> 'star_rating' IS NOT NULL)) THEN
    RAISE EXCEPTION 'FP-257: self-report audit entries still hold feedback or rating keys. Run documentation/sql/FP-257-move.sql section B first.';
  END IF;
END
$$;

ALTER TABLE public.member_attendance_reports
  DROP COLUMN IF EXISTS feedback,
  DROP COLUMN IF EXISTS star_rating;
```

**`documentation/sql/FP-257-move.sql`:**
```sql
-- ===== A. PREVIEW (read-only) =====
SELECT
  (SELECT count(*) FROM member_attendance_reports WHERE star_rating IS NOT NULL OR (feedback IS NOT NULL AND btrim(feedback) <> '' AND feedback <> '[removed]')) AS rows_to_copy,
  (SELECT count(*) FROM member_attendance_reports WHERE feedback IS NOT NULL OR star_rating IS NOT NULL) AS rows_to_clear,
  (SELECT count(*) FROM audit_logs WHERE entity_type = 'self_report'
     AND (COALESCE(before_value ?| ARRAY['feedback','star_rating'], false) OR COALESCE(after_value ?| ARRAY['feedback','star_rating'], false))) AS audit_entries_to_scrub,
  (SELECT count(*) FROM event_feedback) AS event_feedback_rows_now;

-- ===== B. MOVE (run once after Joseph confirms A; safe to re-run) =====
BEGIN;
INSERT INTO event_feedback (tenant_id, event_id, star_rating, feedback)
SELECT tenant_id, event_id, star_rating,
       CASE WHEN feedback IS NULL OR btrim(feedback) = '' OR feedback = '[removed]' THEN NULL ELSE feedback END
FROM member_attendance_reports
WHERE self_report_status = 'SELF_REPORTED_YES'
  AND (star_rating IS NOT NULL OR (feedback IS NOT NULL AND btrim(feedback) <> '' AND feedback <> '[removed]'))
ORDER BY random();

UPDATE member_attendance_reports SET feedback = NULL, star_rating = NULL
WHERE feedback IS NOT NULL OR star_rating IS NOT NULL;

SELECT set_config('app.audit_redaction', 'on', true);
UPDATE audit_logs
SET before_value = CASE WHEN jsonb_typeof(before_value) = 'object' THEN before_value - 'feedback' - 'star_rating' ELSE before_value END,
    after_value  = CASE WHEN jsonb_typeof(after_value)  = 'object' THEN after_value  - 'feedback' - 'star_rating' ELSE after_value  END
WHERE entity_type = 'self_report'
  AND (COALESCE(before_value ?| ARRAY['feedback','star_rating'], false) OR COALESCE(after_value ?| ARRAY['feedback','star_rating'], false));
SELECT set_config('app.audit_redaction', '', true);
COMMIT;

-- ===== C. VERIFY (read-only) — expected: 0 | 0 | 0 | (number of rows copied) =====
-- Same query as A.
```

### Branch Name
feature/FP-257-anonymous-feedback

### Commit Message
FP-257: store post-event feedback and ratings without the author

### Pull Request Description
Plain GitHub markdown. Include:
- each acceptance criterion and the behavior that meets it;
- the redaction-function diff against `…083`;
- the grep list from grounding item 1 and the `pg_proc` hits from item 2;
- the script output;
- deviations from this DIP.

**Not tested:** the hosted database, any device, concurrent submissions.

**Steps for Joseph (order matters):**
1. **Apply `…088`** in the Supabase SQL Editor. Verify: `SELECT count(*) FROM event_feedback;` returns 0.
2. **Run section A** of `documentation/sql/FP-257-move.sql` and send Atlas the four numbers.
3. After Atlas confirms, **run section B** once, then **section C**. Expected: `0 | 0 | 0 | <rows copied>`.
4. **Merge** this PR into `dev` and wait for Vercel **Ready**.
5. **Apply `…089`.** If it refuses, stop and tell Atlas. Verify: `SELECT count(*) FROM information_schema.columns WHERE table_name = 'member_attendance_reports' AND column_name IN ('feedback','star_rating');` returns 0.
6. On a phone: open the Board for an event with feedback. It looks the same (order may differ). As a test member, submit Yes with a rating and a comment on a finished event; it appears on that event's Board. As a Leader, the confirmation card no longer shows rating or comment (after the mobile update; before it, the fields are simply empty).

### Jira Linkage
- PDEEpicID: FP-18
- PDEStoryID: FP-257

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-257-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
