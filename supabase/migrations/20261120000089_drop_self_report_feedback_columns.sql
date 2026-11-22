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
