# DIP-FP-121

## Story Summary

The mobile Confirmations tab lists self-reports stuck in PENDING_CONFIRMATION forever, even after their events lock or are cancelled — 7 such items are currently permanently un-actionable in live data. The server-side confirm guard correctly rejects them; the list query simply never checks event status. This DIP adds that filter server-side in getPendingConfirmations(), so locked/cancelled items vanish from the tab and from the FP-119 combined badge counts. Explicitly out of scope (per the ticket): any auto-resolution of orphaned pending self-reports into official attendance — that product decision remains open and nothing here forecloses it.

## Repo Target

Web (Next.js) — owgc-tech/flockpulse-web, branch off dev. The fix is entirely in the API layer the mobile tab consumes; zero mobile changes (the tab and badges render whatever the endpoint returns).

## Grounding Check

- Verified live against dev: getPendingConfirmations() in src/features/confirmations/confirmation.repository.ts filters only confirmation_status = 'PENDING_CONFIRMATION' + tenant + member scoping — no event-status check anywhere. It already collects eventIds and makes a follow-up events fetch (added by DIP-FP-99-adj-1).
- Verified live: migration 20260629000009_derive_event_state.sql — stored events.status CHECK is ('DRAFT','SCHEDULED','CANCELLED'); ACTIVE/COMPLETED/LOCKED exist only as return values of public.get_event_effective_status(p_event_id UUID). The confirmation guard already consumes this same function. The list filter must therefore call the canonical function, not duplicate window arithmetic in TS.
- Invariants: untouched. This is a read-path filter; no attendance writes, no lifecycle changes.
- Canonical error codes: none needed (no new error paths).
- Cross-tenant safety: the new SQL helper takes an explicit p_tenant_id and filters on it, despite being called only from service-role code — consistent with house defense-in-depth.
- Prior work: no DIP-FP-121.md exists; clean slate.

## Implementation Plan

1. Phase 0 (in order): branch off dev → verify the two grounding facts above against the checked-out code (repository function shape; migration 000009's function signature) → persist this DIP verbatim → code.
2. Migration — bulk effective-status lookup. One-round-trip helper wrapping the canonical function (a per-event .rpc() loop would be N round trips; PostgREST can't call get_event_effective_status inline in a select).
3. Repository change. In getPendingConfirmations(), immediately after the first query returns rows and eventIds are collected: call the new RPC, build the excluded-set (effective_status IN ('LOCKED','CANCELLED')), filter rows, and return [] early if nothing survives. Recompute memberIds/eventIds from the filtered rows so the RSVP and event fetches shrink accordingly. No changes to the mapping logic or return shape.
4. Validation: apply the migration to the local Docker Supabase stack (supabase migration up) — never remote; npm run build must pass cleanly (standing rule); run any existing confirmation-related tests.

## Files to Create/Modify

```
supabase/migrations/20260716000029_bulk_effective_status_lookup.sql   (new)
src/features/confirmations/confirmation.repository.ts                 (modified)
```

## Migration Files

```sql
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
```

## Branch Name

feature/FP-121-filter-locked-confirmations

## Commit Message

FP-121: exclude locked/cancelled events' self-reports from pending confirmations list

## Pull Request Description

- AC1: getPendingConfirmations() now excludes self-reports whose event's effective_status (canonical SQL derivation) is LOCKED or CANCELLED → filter applied server-side via new get_events_effective_statuses RPC.
- AC2: locked/cancelled items disappear from the mobile Confirmations tab on load and pull-to-refresh → follows from AC1; no client change required.
- AC3: FP-119 combined badge counts stop counting them → badges derive from this endpoint's result set; follows from AC1.
- AC4: genuinely-pending items on live events unaffected → filter-only change; confirm/reject logic untouched, verified by diff scope.

## Jira Linkage

- PDEEpicID: FP-18 (EPIC-5)
- PDEStoryID: FP-121

## Stop Point

Save this DIP verbatim to documentation/dips/DIP-FP-121.md and never append to it afterward; executor observations go in the PR description only. Validate the migration locally via the Supabase CLI Docker stack only — never against the remote project. Ensure npm run build passes before pushing. Open the PR against dev and stop — do not merge. Include full diffs for every file in the completion report per standing rule 12, including the untouched-file proof if applicable.
