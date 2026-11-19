DIP-FP-47 — Replace pg_cron Event State Transitions with Time-Derived Effective Status
Covers: FP-47 (ARCH-REVISION — supersedes the state-transition mechanism from FP-13/STORY-3.2) Epic: EPIC-3 — Event Lifecycle Management (FP-11)
Story Summary
FP-13 implemented event lifecycle transitions (SCHEDULED → ACTIVE → COMPLETED → LOCKED) via a `pg_cron` job that physically writes the new status into `events.status` every 5 minutes. This DIP removes that mechanism entirely. `DRAFT`, `SCHEDULED`, and `CANCELLED` remain genuinely explicit, admin-driven states stored in the column — nothing about time tells you an event was cancelled. But `ACTIVE`, `COMPLETED`, and `LOCKED` are pure functions of `start_datetime`, `end_datetime`, and `tenant.attendance_window_hours`, so they're computed on read via a new function, never stored, never precomputed, never stale.
This closes a real bug already living in merged code: self-report submission (FP-19/FP-20) checks `event.status === 'COMPLETED'` as an exact match against the stored column. Between an event's actual `end_datetime` and the next cron tick (up to 5 minutes), a legitimate self-report attempt is incorrectly rejected with `SELF_REPORT_NOT_OPEN`. Deriving status on read eliminates this window entirely — the answer is correct the instant it's queried.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`. Same repo as FP-13, FP-16/17, FP-19/20 — this is a backend/schema change to code already living there.
Grounding Check

1. State machine unchanged, only the transition mechanism changes. The six states, what gates each transition, and the tenant-configurable attendance window (resolving PIB OQ-1) are exactly as FP-13 defined them. This DIP does not reopen OQ-1 or any other open question.
2. `handle_event_scheduling()` must not be touched. That trigger fires on the literal DRAFT→SCHEDULED `UPDATE`, which remains a real, explicit, admin-driven write — unaffected by removing cron for the later transitions. Confirm after implementation that this function and its trigger are byte-identical to before.
3. `block_actions_on_cancelled_or_locked()` is an established public interface — called by both RSVP (FP-16/17) and self-report (FP-19/20), already merged. Its signature (`p_event_id UUID`) must not change, and its behavior for every case in the existing FP-13 test checklist must be preserved exactly, including the specific case of a non-existent event ID returning `FALSE` rather than `NULL` or an error. See Implementation Plan step 3 for the regression this requires guarding against explicitly.
4. No invariant conflicts. This is a pure implementation-mechanism change — no business rule from Section 4 is affected. RSVP/self-report/formation logic already reads event status as an input; this DIP changes how that input is computed, not what it means.
5. Tenant-scoping responsibility is preserved, not weakened. The original `block_actions_on_cancelled_or_locked(p_event_id)` never took a tenant parameter — callers were always responsible for confirming the event belongs to the caller's tenant before passing the ID in. The new `get_event_effective_status(p_event_id)` function follows the identical pattern for the identical reason: it's tenant-agnostic by design, and RSVP/self-report repositories keep their existing tenant-scoped existence check before ever calling it. Do not add a `p_tenant_id` parameter to either function — that would diverge from the established calling convention for no benefit, since the tenant check already happens one level up.
Implementation Plan

1. Backfill existing rows. Before tightening the CHECK constraint, `UPDATE events SET status = 'SCHEDULED' WHERE status IN ('ACTIVE', 'COMPLETED', 'LOCKED')`. This is safe: the derived-status function will immediately recompute the correct effective state from timestamps regardless of what was previously stored, as long as the stored value isn't `DRAFT` or `CANCELLED` (which must never be overwritten by this backfill — the `WHERE` clause already excludes them).
2. Tighten `events.status` CHECK. Drop and recreate the constraint to allow only `('DRAFT', 'SCHEDULED', 'CANCELLED')`. `ACTIVE`/`COMPLETED`/`LOCKED` become values that only ever exist as a return value of the derivation function, never as stored data.
3. Create `get_event_effective_status(p_event_id UUID) RETURNS TEXT`. `DRAFT`/`CANCELLED` pass through unchanged (sticky, explicit). For `SCHEDULED`, compute the effective state from `now()` against `start_datetime`, `end_datetime`, and the tenant's `attendance_window_hours` — same boundary logic FP-13's `transition_event_states()` already used, just evaluated at query time instead of write time. Returns `NULL` if the event doesn't exist (tenant-agnostic, per Grounding Check item 5 — callers scope tenant before calling).
4. Rewrite `block_actions_on_cancelled_or_locked()` to call the new function — same signature, and explicitly guard the non-existent-event case. The original implementation used `EXISTS(...)`, which naturally returns `FALSE` (never `NULL`) for a missing row. The naive rewrite — `get_event_effective_status(p_event_id) IN ('CANCELLED', 'LOCKED')` — returns `NULL` for a missing event, not `FALSE`, because `NULL IN (...)` is `NULL` in SQL, not `FALSE`. This is a real regression risk against the FP-13 test checklist's explicit "returns FALSE for non-existent event ID" case. Wrap with `COALESCE(..., FALSE)` to preserve the original contract exactly. Verify this specific case in testing — it's the one most likely to silently pass a superficial check and fail the real one.
5. Remove the cron job and its function. `DO` block checking `cron.job` for `jobname = 'transition-event-states'` before calling `cron.unschedule(...)` (don't assume it exists — this migration may run against a database where it was never successfully scheduled). Then `DROP FUNCTION IF EXISTS public.transition_event_states()`. Leave the `pg_cron` extension itself installed — dropping it is unnecessary churn and a future EPIC-8 notification worker may want it for polling; removing the one job that used it is sufficient.
6. Repository layer — RSVP. In `src/features/rsvps/rsvp.repository.ts`, replace the direct `SELECT status, start_datetime FROM events` read with: keep a minimal tenant-scoped existence check (confirm the event belongs to the tenant — same purpose the old query served), then call `.rpc('get_event_effective_status', { p_event_id: eventId })` for the state. In `rsvp.service.ts`, replace the `event.status === 'SCHEDULED' || event.status === 'ACTIVE'` check with the same comparison against the derived value, and remove the separate `now() < start_datetime` check — it's now fully redundant, since `SCHEDULED` is defined by the derivation function as exactly "before `start_datetime`." Keeping both would be dead logic that looks like it's doing something it isn't.
7. Repository layer — self-report. Same pattern in `src/features/self-reports/self-report.repository.ts` and `self-report.service.ts`: replace the raw `status` read with a call to `get_event_effective_status`, compare against `'COMPLETED'` exactly as before. This is the change that actually fixes the staleness bug described in the Story Summary — no other logic in the self-report service needs to change.
8. Test plan. Create `documentation/test-plans/FP-47-derived-event-state-checklist.md` covering: no cron job registered; `get_event_effective_status` correctness at each time boundary (including the exact moment `end_datetime` passes, proving no staleness window); `block_actions_on_cancelled_or_locked` unchanged behavior for every case in the original FP-13 checklist, explicitly including the non-existent-event-ID case; RSVP and self-report against an event whose `end_datetime` just passed, proving both now transition instantly rather than waiting up to 5 minutes.
Files to Create/Modify

* `supabase/migrations/20260629000009_derive_event_state.sql`
* `src/features/rsvps/rsvp.repository.ts` (modify)
* `src/features/rsvps/rsvp.service.ts` (modify — remove redundant date check)
* `src/features/self-reports/self-report.repository.ts` (modify)
* `src/features/self-reports/self-report.service.ts` (modify if needed — likely just the repository call site)
* `documentation/test-plans/FP-47-derived-event-state-checklist.md`
Migration File
`supabase/migrations/20260629000009_derive_event_state.sql`

```sql
-- FP-47: Replace pg_cron-driven event state writes with time-derived effective status.
-- Supersedes the transition mechanism from FP-13 (20260629000005) only — the state
-- machine itself, and handle_event_scheduling()'s DRAFT->SCHEDULED trigger, are unchanged.


-- ==============================================================
-- SECTION 1: Backfill existing stored ACTIVE/COMPLETED/LOCKED rows
--
-- Safe: the derivation function recomputes the correct effective
-- state from timestamps regardless of what's stored here, as long
-- as it isn't DRAFT or CANCELLED (excluded from this backfill).
-- ==============================================================

UPDATE events
SET status = 'SCHEDULED'
WHERE status IN ('ACTIVE', 'COMPLETED', 'LOCKED');


-- ==============================================================
-- SECTION 2: Tighten events.status CHECK
--
-- ACTIVE/COMPLETED/LOCKED are no longer legal stored values —
-- they only ever exist as a return value of get_event_effective_status().
-- ==============================================================

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE events
    ADD CONSTRAINT events_status_check
    CHECK (status IN ('DRAFT', 'SCHEDULED', 'CANCELLED'));


-- ==============================================================
-- SECTION 3: get_event_effective_status()
--
-- DRAFT/CANCELLED pass through unchanged — sticky, explicit states
-- with no time-based formula. SCHEDULED events derive ACTIVE/
-- COMPLETED/LOCKED from start_datetime/end_datetime/attendance
-- window, evaluated at query time — never precomputed, never stale.
--
-- Tenant-agnostic by design, matching block_actions_on_cancelled_or_locked's
-- existing convention: callers tenant-scope the event_id before calling.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.get_event_effective_status(p_event_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN e.status IN ('DRAFT', 'CANCELLED') THEN e.status
    WHEN now() < e.start_datetime THEN 'SCHEDULED'
    WHEN now() < e.end_datetime THEN 'ACTIVE'
    WHEN now() < e.end_datetime + (t.attendance_window_hours * INTERVAL '1 hour') THEN 'COMPLETED'
    ELSE 'LOCKED'
  END
  FROM events e
  JOIN tenants t ON t.id = e.tenant_id
  WHERE e.id = p_event_id;
$$;


-- ==============================================================
-- SECTION 4: block_actions_on_cancelled_or_locked() — rewritten, same signature
--
-- REGRESSION GUARD: the original EXISTS(...) implementation returns
-- FALSE (never NULL) for a non-existent event. A naive rewrite using
-- `get_event_effective_status(...) IN (...)` returns NULL for a
-- missing event, not FALSE, because `NULL IN (...)` is NULL in SQL.
-- COALESCE preserves the original contract exactly — this is the
-- specific case the FP-13 test checklist already covers explicitly.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_actions_on_cancelled_or_locked(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE(
    public.get_event_effective_status(p_event_id) IN ('CANCELLED', 'LOCKED'),
    FALSE
  );
$$;


-- ==============================================================
-- SECTION 5: Remove the cron job and transition_event_states()
--
-- Guard the unschedule call — don't assume the job exists on every
-- database this migration might run against. Leave the pg_cron
-- extension itself installed; a future notification worker (EPIC-8)
-- may still want it for polling. Only the one job is removed.
-- ==============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'transition-event-states') THEN
    PERFORM cron.unschedule('transition-event-states');
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.transition_event_states();

```

Branch Name
`feature/FP-47-derive-event-state`
Commit Message
`FP-47: Replace pg_cron event state transitions with time-derived effective status`
Pull Request Description
Implements FP-47:

* ✅ No `pg_cron` job registered for event state transitions — `cron.unschedule` called and verified
* ✅ `transition_event_states()` removed
* ✅ `events.status` CHECK tightened to `('DRAFT', 'SCHEDULED', 'CANCELLED')` only
* ✅ `get_event_effective_status()` computes ACTIVE/COMPLETED/LOCKED in real time from `start_datetime`/`end_datetime`/`attendance_window_hours`; DRAFT/CANCELLED pass through unchanged
* ✅ `block_actions_on_cancelled_or_locked()` preserves its exact original signature and behavior, including the non-existent-event-ID → `FALSE` case (regression-guarded via `COALESCE`, see migration Section 4 comment)
* ✅ RSVP and self-report repositories repointed to the derived-status function; the up-to-5-minute staleness window that could incorrectly reject a legitimate self-report right after `end_datetime` is eliminated
* ✅ Existing `ACTIVE`/`COMPLETED`/`LOCKED` rows backfilled to `SCHEDULED` before the constraint tightened
Confirmed unchanged:

* `handle_event_scheduling()` and its DRAFT→SCHEDULED trigger — not touched, verified byte-identical
* The state machine itself (which states exist, what gates each transition, the tenant-configurable attendance window from OQ-1) — unchanged, only the write-vs-derive mechanism changed
Cleanup included: RSVP service's separate `now() < start_datetime` check removed — fully redundant once `SCHEDULED` is itself defined as "before `start_datetime`" by the derivation function. Kept it would have been dead logic masquerading as a real check.
Jira Linkage

* PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
* PDEStoryID: FP-47 (ARCH-REVISION — supersedes FP-13 mechanism)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-47.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.
Create the feature branch, apply the migration locally via `supabase db reset` and confirm it runs cleanly — pay particular attention to the `block_actions_on_cancelled_or_locked` non-existent-event-ID regression test (Implementation Plan step 4/8) — implement the application code, commit, push, and open the PR against `dev` using `gh pr create --base dev`.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
