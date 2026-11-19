### Story Summary
Fixes a real timezone-boundary bug found via testing: the task-assignment hard-block trigger cast event timestamps to a calendar date using Postgres's default (UTC) session timezone, with no tenant timezone stored anywhere to cast against correctly. A late-evening event in Eastern time could land on the *next* UTC calendar day, causing it to incorrectly match (or miss) an unavailability range. Confirmed via a clean, controlled test: an event at 9 AM Eastern was unaffected, an event at 11 PM Eastern on the same calendar date was incorrectly blocked. Fixes this properly — adds a real `tenants.timezone` column (not a hardcoded literal in the trigger), defaulted to `America/Toronto` for the only tenant that exists today. Admin UI to change it is explicitly out of scope for this fix (see below).

### Repo Target
Web (Next.js) — schema + trigger fix only. No mobile changes; the bug was entirely in server-side date comparison, invisible to any client code.

### Grounding Check
Re-confirmed live against `owgc-tech/flockpulse-web` `dev`:
- The exact bug location, confirmed precisely: `block_task_assignment_if_member_unavailable()` (`20260811000070_member_unavailability_hard_block.sql`, lines 117-118) casts `v_event.start_datetime::DATE`/`end_datetime::DATE` with no timezone specified at all.
- **No `tenants.timezone` column, or any timezone column anywhere in the schema, exists today** — confirmed via full grep across every migration. This is a genuine gap, not something to work around with another hardcoded cast.
- `tenants` table precedent for adding a simple new column directly (`description`, `logo_url`, `tagline`, none via a separate settings table) — `timezone` follows the same pattern.
- **Deliberately out of scope for this fix**: no admin UI to change a tenant's timezone. OWGC is the only tenant that exists, the default is already correct for it, and building a settings UI for a value nothing currently needs to change is unwarranted scope for what's fundamentally a bug fix. If FlockPulse ever has a tenant outside Eastern time, that UI becomes a real, separate story — not a reason to hold this fix.

### Implementation Plan
1. **New migration**: `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Toronto';` — an IANA timezone name, directly usable with Postgres's `AT TIME ZONE` operator.
2. **`block_task_assignment_if_member_unavailable()`**: fetch the tenant's `timezone` alongside the event's `start_datetime`/`end_datetime` in the existing event lookup (`SELECT e.start_datetime, e.end_datetime, t.timezone INTO v_event FROM events e JOIN tenants t ON t.id = e.tenant_id WHERE e.id = NEW.event_id AND e.tenant_id = NEW.tenant_id;`), then change both casts to `(v_event.start_datetime AT TIME ZONE v_event.timezone)::DATE` / `(v_event.end_datetime AT TIME ZONE v_event.timezone)::DATE`. No other logic in the function changes — same `CREATE OR REPLACE`, no `DROP FUNCTION` needed (signature unchanged).

### Files to Create/Modify
- New migration in `supabase/migrations/`

### Migration Files (if applicable)
`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Toronto';` and `CREATE OR REPLACE FUNCTION block_task_assignment_if_member_unavailable()` with the corrected timezone-aware casts. Written to disk, applied locally only, never against the remote database directly.

### Branch Name
feature/FP-190-web-adj-1-timezone-fix

### Commit Message
FP-190-web-adj-1: fix UTC/local timezone boundary bug in unavailability hard-block

### Pull Request Description
Fixes a real bug found via testing: the hard-block trigger compared event dates using UTC (Postgres's default session timezone) with no tenant timezone available to cast against, causing a late-evening Eastern-time event to sometimes land on the wrong calendar day for the comparison. Adds a real `tenants.timezone` column (defaulted to `America/Toronto`) rather than a hardcoded literal in the trigger. Confirm in the PR: re-run the exact test that found this (a 9 AM event and an 11 PM event on the same date, against a range starting the next day) and confirm both now behave correctly.

### Jira Linkage
- PDEEpicID: FP-11
- PDEStoryID: FP-190

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-190-web-adj-1.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
