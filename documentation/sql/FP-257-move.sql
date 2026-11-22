-- FP-257: one-time move of existing feedback and star ratings into event_feedback, which has
-- no author. Joseph runs this by hand in the Supabase SQL Editor, one section at a time:
--   * run A after migration 20261120000088 is applied; send Atlas the four numbers;
--   * run B only after Joseph (via Atlas) confirms A; it is safe to re-run;
--   * run C after B (expected: 0 | 0 | 0 | the number of rows copied);
--   * apply migration 20261120000089 only after the FP-257 web code is merged and live.
-- Counts only; no member names or ids. NOT a migration.

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
