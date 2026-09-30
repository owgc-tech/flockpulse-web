### DIP — FP-223-adj-2 (Web) — Add is_attendee to distinguish genuine invites from widened visibility

### Story Summary
Fixes a real consequence of FP-223: Admins and Leader-owners now see events they were never targeted/invited on, but the RSVP prompt and badge count can't currently tell the difference — they only check "is rsvp_status empty," which is also true for these newly-visible, never-invited events. Result: a false "Please RSVP now" prompt, a badge count, and a real error when someone tries to RSVP to something they were never invited to. The server needs a new explicit signal distinguishing "genuinely invited" from "visible via Admin/owner widening."

### Repo Target
Web (Next.js) — `listEventsForMember`, the single shared query mobile depends on.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`: for the `seesAll` (Admin) path, `eventIds` is `null` and the `event_attendees` query is skipped entirely — there's currently no way to know, even server-side, which of an Admin's visible events they're a genuine attendee of. The `seesOwned` (Leader) path does run the attendee query, but merges it into one combined `ids` Set without preserving which IDs came from attendee status specifically.

### Implementation Plan
1. For `seesAll`: additionally run the `event_attendees` query (same shape as the existing Member-path one) purely to build an `attendeeEventIds` Set — not used to restrict the event list, only to mark each result.
2. For `seesOwned`: keep the existing merged `ids` Set for the actual query restriction, but track the attendee-sourced IDs separately before merging in the owned ones, so both sets are available independently.
3. For the plain Member path: every event is already attendee-based by definition — `attendeeEventIds` is just the full set.
4. In the final `.map()` building the response, add `is_attendee: attendeeEventIds.has(e.id)` to every returned event.

### Files to Create/Modify
- `src/features/events/service.ts` (modify)

### Migration Files (if applicable)
None — this is a computed response field, not a stored column.

### Branch Name
feature/FP-223-web-adj-2-is-attendee-flag

### Commit Message
FP-223-web-adj-2: add is_attendee to distinguish genuine invites from widened visibility

### Pull Request Description
Maps to the real bug Joseph hit: Admins/Leaders seeing events they're not invited to were getting a false RSVP prompt, a badge count, and a real error on attempting to RSVP. This adds the server-side signal mobile needs to correctly suppress both. Confirm in the PR: an Admin's genuinely-invited events still show `is_attendee: true`, and their widened-visibility-only events show `false`.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-223

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-223-web-adj-2.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
