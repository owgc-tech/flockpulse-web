DIP-FP-180-adj-3
Story Summary
Fixes a live 500 error on both auto-assign screens' "Run auto-assign" button: Postgres error 42702, "column reference 'event_id' is ambiguous." Root cause is that auto_assign_task_slots's RETURNS TABLE(...) declares output columns named event_id/task_id, which collide with the real table's column names referenced bare in the function's ON CONFLICT (event_id, task_id) clause — PL/pgSQL can't tell whether event_id there means the OUT parameter or the table column, and ON CONFLICT's conflict-target list can't be qualified to disambiguate. This exact bug pattern already happened once before in this codebase (upsert_rsvp_with_audit, migration 20260629000017) and was fixed there by switching from RETURNS TABLE to RETURNS SETOF <table> + %ROWTYPE + RETURN NEXT — this DIP applies that same established fix here.
Repo Target
Web (Next.js), owgc-tech/flockpulse-web.
Grounding Check

Root cause confirmed directly from the Vercel log's error payload (code: "42702", details: "It could refer to either a PL/pgSQL variable or a table column") cross-referenced against the function body — not guessed.
House precedent found and followed, not invented: 20260629000017_audit_logs.sql's own comment on upsert_rsvp_with_audit documents this exact class of bug and its fix (RETURNS SETOF rsvps instead of RETURNS TABLE with colliding column names). Using the same pattern here rather than the alternative #variable_conflict use_column pragma fix, for consistency with existing code.
No conflict with Section 4 invariants.
Return field names are unchanged (id, event_id, task_id, assignee, created_at, updated_at), plus tenant_id is now also returned — harmless, since EventTaskAssignmentRow (the TS type already used for this RPC's result) already includes tenant_id in its shape, and the panel's success handler only destructures the fields it needs.
Because the return type itself changes (TABLE(...) → SETOF event_tasks_assignments), CREATE OR REPLACE FUNCTION is not sufficient — Postgres requires an explicit DROP FUNCTION IF EXISTS first with the exact current signature, per the standing DIP checklist rule for RPC signature/return-shape changes.
No TypeScript changes required — confirmed by comparing the new return shape against EventTaskAssignmentRow and every consumer of runAutoAssignTaskSlots's result (autoAssign.service.ts, both API routes, TaskAutoAssignPanel.tsx's handleRun) — all already only reference id, event_id, assignee by name, none reference a fixed column count or order.
Round-robin ordering is actually slightly improved as a side effect: the old version ordered its final RETURN QUERY by updated_at DESC, which isn't guaranteed stable if two rows update within the same clock tick; RETURN NEXT inside the existing per-event loop returns rows in true insertion/round-robin order instead.

Implementation Plan

Migration: DROP FUNCTION IF EXISTS public.auto_assign_task_slots(UUID, UUID, JSONB, UUID); followed by CREATE FUNCTION with RETURNS SETOF event_tasks_assignments, a v_row event_tasks_assignments%ROWTYPE variable, and RETURN NEXT v_row; inside the loop in place of the old v_touched_ids array + trailing RETURN QUERY SELECT. All other logic (event selection, round-robin index math, assignee JSONB construction, upsert) is unchanged.
No other files change.

Files to Create/Modify

supabase/migrations/20260724000058_fix_auto_assign_ambiguous_column.sql (new)

Migration Files
sql-- DIP-FP-180-adj-3: fixes Postgres error 42702 ("column reference \"event_id\"
-- is ambiguous") on every "Run auto-assign" call. RETURNS TABLE(...) declared
-- output columns named event_id/task_id, which collided with the real
-- event_tasks_assignments columns referenced bare in
-- ON CONFLICT (event_id, task_id) — PL/pgSQL can't disambiguate, and a
-- conflict target list can't be table-qualified to resolve it manually.
--
-- Same bug, same fix already established in this codebase: see
-- 20260629000017_audit_logs.sql's upsert_rsvp_with_audit(), which switched
-- from RETURNS TABLE to RETURNS SETOF <table> + %ROWTYPE + RETURN NEXT for
-- exactly this reason. Applying that same pattern here rather than the
-- alternative #variable_conflict use_column compiler pragma, for
-- consistency with existing code.
--
-- Return type is changing (TABLE(...) -> SETOF event_tasks_assignments), so
-- CREATE OR REPLACE alone is not sufficient — explicit DROP FUNCTION first,
-- per the standing DIP checklist rule for RPC return-shape changes.

DROP FUNCTION IF EXISTS public.auto_assign_task_slots(UUID, UUID, JSONB, UUID);

CREATE FUNCTION public.auto_assign_task_slots(
    p_tenant_id UUID,
    p_task_id UUID,
    p_roster JSONB,
    p_actor_member_id UUID
)
RETURNS SETOF event_tasks_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_event_ids UUID[];
  v_roster_len INT := jsonb_array_length(p_roster);
  v_entry JSONB;
  v_type TEXT;
  v_rid UUID;
  v_new_assignee JSONB;
  v_row event_tasks_assignments%ROWTYPE;
  i INT;
BEGIN
  SELECT array_agg(e.id ORDER BY e.start_datetime ASC, e.id ASC)
  INTO v_event_ids
  FROM events e
  WHERE e.tenant_id = p_tenant_id
    AND public.get_event_effective_status(e.id) IN ('DRAFT', 'SCHEDULED', 'ACTIVE');

  IF v_event_ids IS NULL OR v_roster_len = 0 THEN
    RETURN;
  END IF;

  FOR i IN 1..array_length(v_event_ids, 1) LOOP
    v_entry := p_roster -> ((i - 1) % v_roster_len);
    v_type := v_entry->>'type';
    v_rid := (v_entry->>'id')::UUID;

    IF v_type = 'group' THEN
      v_new_assignee := jsonb_build_object('group_ids', jsonb_build_array(v_rid));
    ELSE
      v_new_assignee := jsonb_build_object('member_ids', jsonb_build_array(v_rid));
    END IF;

    INSERT INTO event_tasks_assignments (tenant_id, event_id, task_id, assignee)
    VALUES (p_tenant_id, v_event_ids[i], p_task_id, v_new_assignee)
    ON CONFLICT (event_id, task_id)
    DO UPDATE SET assignee = EXCLUDED.assignee, updated_at = now()
    RETURNING * INTO v_row;

    RETURN NEXT v_row;
  END LOOP;

  RETURN;
END;
$$;

-- No pre-flight duplicate check needed — this migration doesn't touch the
-- unique index. No explicit GRANT needed — same as prior migrations in this
-- file set.
Branch Name
feature/FP-180-adj-3-fix-ambiguous-column
Commit Message
FP-180-adj-3: fix 42702 ambiguous column error in auto_assign_task_slots by switching to RETURNS SETOF
Pull Request Description

Fixes the POST /api/tasks/auto-assign/prayer-leader (and food-assignment) 500 error seen in Vercel logs (code: 42702) when clicking "Run auto-assign."
Root cause: RETURNS TABLE output-column names collided with ON CONFLICT (event_id, task_id)'s bare column references.
Fix follows the existing house precedent (upsert_rsvp_with_audit) exactly: RETURNS SETOF event_tasks_assignments + %ROWTYPE + RETURN NEXT.
No TypeScript changes — confirm via git diff dev [branch] -- src/ app/ showing changes only in the migration file.
Include, in the completion report, the local Supabase CLI validation output showing the function recreates cleanly and a manual round-robin test run against the local stack succeeds without the 42702 error.

Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-180

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-180-adj-3.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in the completion report, no elisions.
