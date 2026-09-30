### DIP — FP-223-adj-3 (Web) — Add is_attendee to the event detail endpoint too

### Story Summary
Adds `is_attendee` to `GET /api/events/:id`'s response — currently only `/api/events/mine` (the list endpoint) has it. The mobile detail screen needs its own authoritative value, not a fragile inherited one from whatever the list screen happened to fetch first.

### Repo Target
Web (Next.js) — the event detail route/service function.

### Grounding Check
Confirm at implementation time the exact function backing `GET /api/events/:id` (likely `getEventById` or similar in `src/features/events/service.ts`) and whether it currently accepts the caller's role/memberId in a way that can reuse the same `isAdminTier`/`isLeaderTierOrAbove` + `event_attendees` lookup pattern already proven in `listEventsForMember`.

### Implementation Plan
1. In the detail-fetch function, run the same `event_attendees` lookup (scoped to `tenantId` + the caller's `memberId`) used in `listEventsForMember`, checking specifically whether *this one event* has a row for the caller.
2. Add `is_attendee: boolean` to the response.
3. No change to which events this endpoint can fetch — this is purely an additive field on the existing response, not a new access restriction.

### Files to Create/Modify
- `src/features/events/service.ts` (modify)
- `src/features/events/event.types.ts` (modify — add `is_attendee` to `EventDetailRow`)

### Branch Name
feature/FP-223-web-adj-3-is-attendee-on-detail

### Commit Message
FP-223-web-adj-3: add is_attendee to the event detail endpoint

### Pull Request Description
Adds the same `is_attendee` signal to `GET /api/events/:id` that the list endpoint already has, so the mobile detail screen has an authoritative value regardless of navigation path. Confirm in the PR: a genuinely-invited event returns `true`, a widened-visibility-only event returns `false`, tested directly against this endpoint.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-223

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-223-web-adj-3.md and do not append executor notes, observations, or any other content to that file after the initial save. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
