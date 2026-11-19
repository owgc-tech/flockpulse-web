DIP-FP-66-FP-94-FP-95-web
Not covered — deliberately excluded: The mobile UI screens themselves (the actual "My Events" list, RSVP interaction, cancelled-event styling, and Leader roster view) are out of scope here — this DIP is the backend prerequisite only. A follow-up `DIP-FP-66-FP-94-FP-95-mobile.md` targeting `flockpulse-mobile` will consume what this DIP produces.
Story Summary
FP-94, FP-66, and FP-95 all assume backend capabilities that don't yet exist: a member-scoped "my events" query with attached RSVP status, and Leader-scoped access to an event's roster. This DIP adds both, entirely as additive reads against existing tables — no new schema, no new tables. It unblocks the mobile UI work without touching any admin-facing behavior that already exists and is tested.
Repo Target
Web (Next.js) — `owgc-tech/flockpulse-web`. Backend/API work for mobile-scoped stories belongs here per standing convention; the mobile repo only gets the UI layer, in the follow-up DIP.
Grounding Check
Verified live against the actual repo, not assumed from the Jira descriptions (which understate the gap):

* `GET /api/events` returns every tenant event, unfiltered — `listEvents(tenantId)` has no per-member scoping at all. FP-94's "no new backend" framing doesn't hold.
* There is no `GET /api/rsvps` — only `POST`. No existing way to fetch "my RSVP status for event X."
* `GET /api/events/:id/roster` is hard-gated `requireAdmin` — a Leader calling it today gets `FORBIDDEN_ROLE`, not a filtered result. `getEventRoster()` has no leader-scoping parameter.
* The real fix for member-scoping already exists and is simpler than reimplementing target-matching: `event_attendees` is the materialized "who's invited" table, populated automatically by the existing `handle_event_scheduling()` trigger the moment an event is published (DRAFT → SCHEDULED). Querying `event_attendees` for `member_id = ctx.memberId` is the correct, already-tested source of truth — there's no need to re-derive group/individual targeting from the `target` JSONB manually. This also means DRAFT events are automatically excluded with zero extra filtering — they never get an `event_attendees` row in the first place.
* `requireRole('LEADER')` is additive by design (`ROLE_HIERARCHY: { ADMIN: 3, LEADER: 2, MEMBER: 1 }`, checked as `<`) — confirmed in `middleware.ts`. Changing the roster route's gate from `requireAdmin` to `requireRole('LEADER')` keeps Admin access working unchanged while opening it to Leaders.
* Reusable leader-scoping primitive already exists: `getMembersAssignedToLeader()` in `src/features/assignments/service.ts` (same function Sprint 10's bulk-reassign and nav-link work used). No need to reimplement "which members belong to this leader."
* "Upcoming," per FP-94's own AC, is being interpreted as: `effective_status NOT IN ('COMPLETED', 'LOCKED')`. This lets `CANCELLED` events through regardless of their original timing (per FP-66's explicit AC that cancelled events stay visible, with no stated time cutoff), while excluding events that have already fully concluded. Flagging this interpretation explicitly since "upcoming" isn't formally defined anywhere else.
* Cross-tenant safety / atomicity / canonical error codes (Section 5, rules 4/5/6): not applicable — no new tables, no multi-table writes, no new failure modes beyond the existing `AUTH_REQUIRED`/`INVALID_TOKEN`/`NOT_FOUND` codes already in use. Nothing to invent.
* One deliberate refactor, flagged rather than silent: `listEvents()`'s existing per-row `get_event_effective_status()` RPC loop gets extracted into a small shared private helper so `listEventsForMember()` can reuse it instead of duplicating the loop. Behavior-preserving, no logic change — but touches a working, tested function, so calling it out explicitly for review rather than assuming it's fine to modify silently.
Implementation Plan

1. In `src/features/events/service.ts`, extract the existing effective-status-attachment loop from `listEvents()` into a private helper `attachEffectiveStatus(events)`, and have `listEvents()` call it (pure refactor, same output).
2. Add `listEventsForMember(tenantId, memberId)`:
   * Query `event_attendees` for `event_id` where `member_id = memberId AND tenant_id = tenantId`.
   * Query `events` for those IDs with the same field selection `listEvents()` uses.
   * Run them through `attachEffectiveStatus()`.
   * Filter to `effective_status NOT IN ('COMPLETED', 'LOCKED')`.
   * Query `rsvps` for `member_id = memberId AND event_id IN (<filtered ids>) AND tenant_id = tenantId`; map by `event_id`.
   * Attach `rsvp_status` (`'YES' | 'NO' | null`) and `rsvp_reason` to each event; `null` where no RSVP row exists.
   * Sort by `start_datetime` ascending, matching `listEvents()`'s existing order.
3. Add `app/api/events/mine/route.ts` — `GET`, wrapped in plain `withAuth` (no role restriction; inherently self-scoped via `ctx.memberId`), calling `listEventsForMember(ctx.tenantId, ctx.memberId)`.
4. In `getEventRoster()`, add an optional third parameter `scopeToLeaderMemberId?: string`. When provided, after fetching the attendee list, filter it down to member IDs present in `getMembersAssignedToLeader(scopeToLeaderMemberId, tenantId)` (import from `src/features/assignments/service.ts`). When omitted, behavior is unchanged from today (full roster — preserves FP-67's existing Admin behavior exactly).
5. In `app/api/events/[id]/roster/route.ts`, change the gate from `requireRole('ADMIN')` to `requireRole('LEADER')`, and pass `ctx.role === 'LEADER' ? ctx.memberId : undefined` as the new third argument to `getEventRoster()`.
Files to Create/Modify

```
app/api/events/mine/route.ts                     (new)
app/api/events/[id]/roster/route.ts               (modified — gate + param)
src/features/events/service.ts                    (modified — refactor + new function + roster param)

```

Migration Files (if applicable)
None. Everything here reads existing tables (`event_attendees`, `events`, `rsvps`, `assignments`) with no schema changes — confirmed in Grounding Check.
Branch Name
`feature/FP-66-94-95-web-member-event-scope`
Commit Message
`FP-66-FP-94-FP-95-web: add member-scoped events+RSVP query and leader-scoped roster access`
Pull Request Description

* FP-94 (backend piece): `GET /api/events/mine` returns only events materialized to the calling member via `event_attendees`, each with the member's own `rsvp_status`/`rsvp_reason` attached — the exact data shape the mobile "My Events" screen needs in one call.
* FP-66 (backend piece): `CANCELLED` events are never excluded by the `effective_status` filter, so they remain in the response for the mobile client to render with its own visual treatment.
* FP-95 (backend piece): `GET /api/events/:id/roster` now accepts `LEADER` role (previously Admin-only), returning a roster filtered to the Leader's own assigned members via the existing `getMembersAssignedToLeader()` primitive. Admin behavior is unchanged — confirmed via `git diff dev [branch] -- app/api/events/[id]/roster/route.ts` showing only the role-gate line and the one new argument changed, nothing else touched.
Jira Linkage

* PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
* PDEStoryID: FP-66, FP-94, FP-95 (backend prerequisite portion only)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-66-FP-94-FP-95-web.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Merge once reviewed here and confirmed the diffs look right; test against the deployed `dev` Vercel environment afterward, per standard web-repo workflow. Do not check out the branch locally to test first.
Include full diffs for every file in the completion report per Section 5, rule 12 — not a summary.
