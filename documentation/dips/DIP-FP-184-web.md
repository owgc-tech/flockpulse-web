### DIP 1 of 2 — Web

### Story Summary
Removes the `location_url` override field entirely — schema, all four RPC functions that reference it, both API-facing types, all three API routes, and both UI sites (`EventForm.tsx`, `EventDetail.tsx`). `getMapsUrl()` simplifies to always generate the address-based Google Maps link; the `http(s)://` validation branch FP-183 added as an interim fix is removed along with the field it was protecting, closing that CodeQL finding structurally rather than leaving the patched-but-still-present field behind.

### Repo Target
Web (Next.js) — schema and all application code. Mobile is a fully separate implementation (DIP 2 of 2).

### Grounding Check
Re-confirmed live against `owgc-tech/flockpulse-web` `dev`, this session — the ticket's own July 22 findings needed re-verification, per its explicit instruction, and did drift:
- **12 migration files reference `location_url`, not the ticket's originally-counted 10** — more have been added since (`20260803000062_announcement_system_type.sql`, `20260804000063_rsvp_guest_count.sql`), confirming the ticket's own caution about not trusting stale findings was warranted.
- **The critical safety check, performed exactly as the ticket demanded**: grepped every trigger function body (not just declared parameters) across all 12 files. `location_url` appears *only* inside `insert_event_with_audit()`, `update_event_with_audit()`, `create_event_series_with_audit()`, and `convert_event_to_series_with_audit()` — the four expected, known audit-write RPCs. Zero references inside any `validate_*_tenant_scope()`, `enforce_*()`, or other trigger function body. This is not a hidden FP-161-4-style landmine — confirmed, not assumed.
- **Latest live definitions to work from** (most recent `CREATE OR REPLACE` of each, confirmed by migration file date order): `insert_event_with_audit()` and `update_event_with_audit()` in `20260804000063_rsvp_guest_count.sql`; `create_event_series_with_audit()` in `20260709000032_event_series.sql` (never redefined since); `convert_event_to_series_with_audit()` in `20260710000033_convert_event_to_series.sql` (never redefined since).
- `getMapsUrl()` (`event.types.ts:185`) already carries a comment explicitly referencing this ticket: *"interim fix for CodeQL js/xss-through-dom; FP-184 removes the field"* — confirms this DIP is exactly the intended follow-through, not new scope.
- Web app-layer references confirmed at exactly the 8 files the ticket listed: `event.types.ts`, `service.ts`, `event-series.service.ts`, `EventForm.tsx` (lines 90, 402, 417, 586, 589), `EventDetail.tsx` (line 211), and all 3 API routes.
- **Existing events with a stored `location_url` value**: dropping the column discards it permanently — no migration/preservation step, per the ticket's own confirmed background (Joseph doesn't need the override, wants it gone).

### Implementation Plan
1. **New migration**: for each of the four RPC functions, `DROP FUNCTION IF EXISTS` (required — the `RETURNS TABLE` column set is changing, per this project's standing DIP checklist item) followed by `CREATE OR REPLACE FUNCTION`, taking the current live definition from the files cited above and removing `p_location_url`/`location_url` from: the parameter list, the `RETURNS TABLE` column list, the `INSERT`/`UPDATE` column and value lists, and the final `RETURNING`/`SELECT` column list. Nothing else in any of the four function bodies changes. Then `ALTER TABLE events DROP COLUMN location_url;`.
2. **`event.types.ts`**: `getMapsUrl()` loses its `locationUrl` parameter and the `http(s)://` conditional entirely — always returns the address-based Google Maps URL. Remove `location_url` from every relevant type.
3. **`service.ts`, `event-series.service.ts`**: remove `locationUrl`/`location_url` from every function signature, insert/update payload, and returned shape that currently carries it.
4. **Three API routes** (`app/api/events/route.ts`, `app/api/events/[id]/route.ts`, `app/api/event-series/route.ts`): remove `locationUrl` from request-body destructuring and from whatever's forwarded to the RPC calls.
5. **`EventForm.tsx`**: remove the `locationUrl` state, the input field (line 586), and both submission-payload references (lines 402, 417); update the maps-link `href` (line 589) to call the simplified `getMapsUrl(locationAddress)`.
6. **`EventDetail.tsx`**: update the `href` (line 211) to the simplified `getMapsUrl(event.location_address)` call.

### Files to Create/Modify
- New migration in `supabase/migrations/`
- `src/features/events/event.types.ts`, `service.ts`, `event-series.service.ts` (modify)
- `app/api/events/route.ts`, `app/api/events/[id]/route.ts`, `app/api/event-series/route.ts` (modify)
- `app/admin/(shell)/events/EventForm.tsx`, `app/admin/(shell)/events/[id]/EventDetail.tsx` (modify)

### Migration Files (if applicable)
`DROP FUNCTION IF EXISTS` + `CREATE OR REPLACE FUNCTION` for all four RPCs per Implementation Plan step 1, then `ALTER TABLE events DROP COLUMN location_url;`. Written to disk, applied locally only, never against the remote database directly.

### Branch Name
feature/FP-184-web-remove-location-url

### Commit Message
FP-184-web: remove location_url override field entirely

### Pull Request Description
Maps to FP-184's acceptance criteria: `location_url` column dropped, all four dependent RPCs updated (DROP + CREATE OR REPLACE, per this project's standing checklist item for `RETURNS TABLE` signature changes), the interim `http(s)://` validation branch in `getMapsUrl()` removed along with the field it protected — closing FP-183's CodeQL finding structurally, not just leaving it patched. Trigger-body safety check performed and documented in the Grounding Check above, per the ticket's explicit requirement. Existing events' stored `location_url` values are discarded on column drop, confirmed intentional per the ticket's background.

### Jira Linkage
- PDEEpicID: FP-11
- PDEStoryID: FP-184

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-184-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
