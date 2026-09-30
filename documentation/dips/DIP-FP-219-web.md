### DIP — FP-219 (Web)

### Story Summary
Adds basic validation to the event Location Address field — currently, only a "not blank" check exists (from FP-214). This is a lightweight sanity check, not real address verification: a length cap and a check against obviously-junk input (pure whitespace or a single repeated character), with no third-party geocoding integration.

### Repo Target
Web (Next.js) — form + both API routes.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- No `maxLength` exists anywhere in `EventForm.tsx` — confirmed via direct search, this story sets a genuinely new limit, not extending an existing one (an earlier reference to a "Name field precedent" was inaccurate and has been corrected in the ticket).
- `locationAddress` is handled by both `app/api/events/route.ts` (create — includes it in the existing required-field check) and `app/api/events/[id]/route.ts` (update) — both need the new length/format check added.
- The existing `getMapsUrl(locationAddress)` link (rendered next to the field) is unaffected by this change — still just opens whatever text is in the field, no new dependency on this validation.

### Implementation Plan
1. **`EventForm.tsx`**: add `maxLength={200}` to the Location Address input, matching the same visible-character-count pattern already used elsewhere on this form if one exists (check and reuse, don't invent a new convention). Add a lightweight client-side check rejecting input that, after trimming, is either empty or consists of a single character repeated throughout (e.g. "aaaaaaaa") — clear error message, not a silent rejection.
2. **`app/api/events/route.ts`** and **`app/api/events/[id]/route.ts`**: add the matching server-side check (length ≤ 200, same repeated-character rejection) — reject with a clear `ApiError` if violated, never trust the client-side check alone.
3. No change to `getMapsUrl()` or any other consumer of this field.

### Files to Create/Modify
- `app/admin/(shell)/events/EventForm.tsx` (modify)
- `app/api/events/route.ts` (modify)
- `app/api/events/[id]/route.ts` (modify)

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-219-web-address-validation

### Commit Message
FP-219-web: basic validation for event Location Address field

### Pull Request Description
Maps to FP-219's acceptance criteria: Location Address now has a 200-character cap and a check against obviously-junk input (empty after trim, or a single repeated character), enforced both client-side and server-side. No geocoding, no autocomplete, no real address verification — explicitly out of scope. Confirm in the PR that existing events with addresses already longer than 200 characters (if any) were checked and left untouched — this is additive for new/edited events only, not a migration.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-219

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-219-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
