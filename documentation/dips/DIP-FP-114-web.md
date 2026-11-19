DIP-FP-114-web
Story Summary
Grants Leader-tier (`LEADER`, `PASTORAL_LEADER`) real web login access to the same Admin app, with read-only access to most sections, full exclusion from Formation/Group/Member-management and audit logs, and scoped mutation rights limited to events they personally created.
Repo Target
Web only.
Grounding Check

* Login gate confirmed: `app/login/actions.ts`'s `loginAction()` has a single hard `if (role !== 'ADMIN')` check, sign-out-and-reject. This is the only login gate — needs widening to rank-based (Admin-tier or Leader-tier), reusing `middleware.ts`'s `ROLE_HIERARCHY` rather than a new literal check.
* A second, separate gate exists and must change too: `app/admin/(shell)/layout.tsx` independently re-checks `role !== 'ADMIN'` and redirects to `/login` — this wraps every page under `community`, `events`, `formation-progress`, `formation`, `groups`, `invitations`, `members`, `restore`. Both gates need to move in lockstep; missing this one would mean Leader-tier could log in successfully but immediately bounce back to `/login` the moment they land on any admin page.
* Real, necessary risk if only these two gates are widened naively: doing so would grant Leader-tier full read+write to everything in the shell — including Formation/Groups/Members, which must stay fully excluded, not read-only. This DIP needs per-section logic, not one blanket widen.
* `AdminSidebar` has zero role-awareness today — a flat, unconditional nav list. Needs to filter to only what Leader-tier can actually reach (`Events`, and whichever of `Community`/`formation-progress` end up read-accessible per the open question below) — showing a nav link to a page that then 403s is worse UX than not showing it.
* Confirmed real schema gap: `events` table (original `CREATE TABLE`, `20260629000002_create_events_and_schedules.sql`) has no `created_by`/owner column at all — only `tenant_id`, no per-row creator tracking. `POST /api/events` (`requireRole('ADMIN')`-gated) never records who created an event. This DIP must add a column (e.g. `created_by_member_id UUID REFERENCES members(id)`), populate it on creation via `ctx.memberId`, and add ownership checks to the `PATCH`/cancel routes (Admin-tier bypasses via existing rank check; Leader-tier must match `created_by_member_id`). Existing events will have `NULL` for this column — the correct, safe behavior is that no Leader-tier account can edit/cancel any event created before this migration (only Admin-tier can, same as today) — not a bug to "fix" retroactively, just a natural consequence of data that predates ownership tracking.
* No web Confirmations screen exists at all — confirmed via the `(shell)` directory listing. The FP-97/98 confirmation-and-self-report flow is mobile-only; `GET /api/confirmations/pending`/`POST /api/confirmations/:id` already exist and already work for any Leader-tier caller (server-side scoped correctly, confirmed back when FP-98 was built). Assumption, flagged rather than silently decided: this DIP does not build a redundant web Confirmations screen — Leader-tier's "can mutate confirmations" capability is already fully served by the existing mobile app; web login access doesn't need to duplicate it. Push back if a web-specific confirmations screen was actually wanted.
* Two sections not covered by the original access matrix at all — genuine open questions, not assumed: `Community` (tenant branding/settings) and `Restore` (soft-deleted record recovery for Courses/Modules/Talks). Neither was explicitly categorized as read-only or excluded. Given `Restore` is inherently a Formation-adjacent recovery tool, I'd default it to excluded (same tier as Formation itself) unless told otherwise. `Community` seems lower-stakes and plausibly fine as read-only — but flagging both explicitly rather than deciding silently.
Implementation Plan

1. Migration: add `created_by_member_id UUID REFERENCES members(id)` to `events`. No backfill possible (data doesn't exist) — column starts `NULL` for all existing rows.
2. `createEvent()`: populate `created_by_member_id` from `ctx.memberId` on insert.
3. `app/api/events/route.ts` (`POST`) and `app/api/events/[id]/route.ts` (`PATCH`) and the cancel route: widen role gate from `requireRole('ADMIN')` to `requireRole('LEADER')` (rank-based, covers `PASTORAL_LEADER` automatically per FP-113), then add an explicit ownership check for non-Admin-tier callers — reject with a canonical error code (e.g. `FORBIDDEN_SCOPE`, checking Engineering Spec §6 for an existing match before inventing one) if `created_by_member_id !== ctx.memberId` and caller isn't Admin-tier.
4. `app/login/actions.ts`: widen the role check to rank-based (Admin-tier or Leader-tier), reusing `ROLE_HIERARCHY`/`isExactlyLeaderTier`-style helpers from `middleware.ts` rather than a new literal.
5. `app/admin/(shell)/layout.tsx`: same rank-based widening for the page-level gate.
6. Per-section read-only enforcement: every mutation entry point (forms, buttons, API calls) inside Members/Groups/Formation/Formation Progress/Invitations/Restore/Audit needs to be blocked for Leader-tier specifically — both API-level (`requireRole('ADMIN')` stays as-is on all mutation endpoints in these areas — no widening) and UI-level (hide/disable create/edit/delete controls when `role` is Leader-tier, so the read-only experience doesn't show dead buttons).
7. `AdminSidebar`: filter `NAV` to Leader-tier-visible items only (`Events`, plus `Community` pending the open question above) — needs to become role-aware, reading role from the session.
8. Login copy: "Admin Sign-in" → "Leadership Sign-in" (exact copy location TBD at implementation — search for the literal string).
Files to Create/Modify

```
supabase/migrations/<new>_add_event_creator.sql       (new)
src/features/events/service.ts                         (modified — createEvent, ownership check)
app/api/events/route.ts                                 (modified)
app/api/events/[id]/route.ts                             (modified)
app/api/events/[id]/cancel/route.ts                      (modified)
app/login/actions.ts                                    (modified)
app/login/[login page component — TBD, copy change]      (modified)
app/admin/(shell)/layout.tsx                              (modified)
src/components/admin/AdminSidebar.tsx                    (modified)
[Members/Groups/Formation/etc. page components — TBD]    (modified, per-section read-only UI)
```

Migration Files (if applicable)
Per Implementation Plan step 1 — written and applied locally first (`supabase db reset`), confirmed working before merge, per the FP-113 precedent this session just established.
Branch Name
`feature/FP-114-web-leader-tier-access`
Commit Message
`FP-114-web: grant Leader-tier login, read-only admin access, and scoped event ownership`
Pull Request Description

* Leader-tier (`LEADER`, `PASTORAL_LEADER`) can now log into web ("Leadership Sign-in").
* Events gain creator tracking; Leader-tier can create/edit/cancel only their own events, Admin-tier unrestricted as before.
* Formation/Groups/Members/Invitations/Restore/Audit remain fully Admin-tier-only, unchanged.
* Everything else Leader-tier can reach is read-only.
* No new web Confirmations screen — that capability already works via mobile.
Jira Linkage

* PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control)
* PDEStoryID: FP-114
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-114-web.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Run `supabase db reset` locally to confirm the migration applies cleanly before considering this ready for review — do not skip this given the FP-113 precedent. Merge once reviewed here.
Include full diffs for every file in the completion report per Section 5, rule 12 — not a summary.
