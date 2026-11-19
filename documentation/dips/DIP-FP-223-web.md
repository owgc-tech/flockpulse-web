### DIP — FP-223 (Web)

### Story Summary
Fixes event owners and Admins not seeing events they're not personally targeted on. Confirmed with Joseph as long-standing, original intent, never correctly implemented — not new scope. Layers correctly onto this app's existing additive RBAC: Members see what they're targeted on (unchanged), Leaders also see events they own, Admins see every event in the tenant.

### Repo Target
Web (Next.js) — the shared query powers mobile's Events tab via `GET /api/events/mine`; confirm at implementation time whether web admin's own event list has the identical gap.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- `listEventsForMember()` (`src/features/events/service.ts`) currently only ever queries `event_attendees` scoped to the caller's `member_id` — no role-based branching exists at all.
- `isAdminTier(role)` and `isLeaderTierOrAbove(role)` (`src/lib/auth/middleware.ts`) are the existing, proven, rank-based role-tier helpers used elsewhere in this codebase — confirmed these are the correct tools to reuse here, not a literal `role === 'ADMIN'` comparison.
- `events.owner_member_id` is confirmed to exist and be reliably set (added for event ownership/transfer, confirmed earlier this session).
- `GET /api/events/mine` (`app/api/events/mine/route.ts`) currently passes only `tenantId`/`memberId` to `listEventsForMember` — will need `ctx.role` passed through too.

### Implementation Plan
1. Pass the caller's `role` into `listEventsForMember(tenantId, memberId, role)`.
2. If `isAdminTier(role)`: skip the `event_attendees` lookup entirely — query all events in the tenant directly (still applying the existing `COMPLETED`/`LOCKED`/`CANCELLED` exclusion used today).
3. Else if `isLeaderTierOrAbove(role)`: run the existing attendee-based query, and separately query events where `owner_member_id = memberId`; merge the two `event_id` sets (dedupe) before fetching the full event rows.
4. Else (plain Member): unchanged — existing attendee-based query only.
5. Confirm at implementation time whether web admin's own events list has the same underlying gap (different query, or does it already show everything to admins by virtue of being an admin-only page?) — fix it too if it does, flag clearly in the PR if it's genuinely a separate, non-issue.

### Files to Create/Modify
- `src/features/events/service.ts` (modify)
- `app/api/events/mine/route.ts` (modify)

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-223-web-owner-admin-event-visibility

### Commit Message
FP-223-web: owners and Admins see events they're not targeted on

### Pull Request Description
Maps to FP-223's acceptance criteria: Admins now see every event in the tenant, Leaders additionally see events they own, Members unchanged. Confirm in the PR whether web admin's own event list needed the same fix. Confirm no change occurred to notifications, badge counts, or anything else tied to `event_attendees` — this only changes which events appear in a person's own list.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-223

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-223-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment (both as an Admin and as a Leader who owns an untargeted event), and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
