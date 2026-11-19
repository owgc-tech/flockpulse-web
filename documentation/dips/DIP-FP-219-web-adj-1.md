### DIP — FP-219-adj-1 (Web) — Real Address Verification via Geocodio

### Story Summary
Adds genuine address verification on top of the already-shipped basic sanity check — a server-side call to Geocodio's geocoding API, rejecting addresses that don't resolve to a real, known place. Geocodio was chosen after verifying directly (not assumed): genuinely free, permanently, 2,500 lookups/day, no credit card required, unrestricted commercial use, native Canada support.

### Repo Target
Web (Next.js) — both event API routes, plus one new server-side utility.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev` (post-FP-219 merge):
- `validateLocationAddress()` (`src/features/events/event.types.ts`) already runs as the fast, free first-pass filter in both `app/api/events/route.ts` and `app/api/events/[id]/route.ts` — this DIP adds a second check *after* that one passes, not a replacement.
- Confirm at implementation time: Geocodio's exact current API request/response shape (endpoint URL, required params, the precise field names for `accuracy_score`/`accuracy_type`) against their live API documentation — don't assume the shape from general knowledge, verify against the real, current docs before writing the integration.

### Implementation Plan
1. Sign up for a Geocodio API key (Joseph, outside this DIP) and add it as a new server-side environment variable (e.g. `GEOCODIO_API_KEY`) in Vercel — both Production and Preview.
2. New server-side utility (e.g. `src/lib/geocodio.ts`): a function taking an address string, calling Geocodio's geocoding endpoint, returning a simple verdict (resolved/not-resolved) based on the response's accuracy data.
3. **Fail open, not closed**: if the Geocodio call errors, times out, or the API key is misconfigured, log a warning server-side and allow the save to proceed — a third-party outage must never block someone from saving a genuinely real event.
4. Call this utility in both `app/api/events/route.ts` and `app/api/events/[id]/route.ts`, after the existing `validateLocationAddress()` check passes, before the actual database write.
5. On a clear non-resolution, return the same `INVALID_VALUE` error shape already established, with a clear message (e.g. "We couldn't recognize this as a real address — please check it and try again").

### Files to Create/Modify
- `src/lib/geocodio.ts` (new)
- `app/api/events/route.ts` (modify)
- `app/api/events/[id]/route.ts` (modify)

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-219-web-adj-1-geocodio-verification

### Commit Message
FP-219-web-adj-1: real address verification via Geocodio

### Pull Request Description
Maps to FP-219's expanded acceptance criteria: Location Address now goes through real verification via Geocodio after passing the existing basic check. Fails open on any Geocodio-side error, so a third-party outage can't block a real save. Confirm in the PR the exact accuracy threshold chosen and why, and confirm the API key is genuinely server-side only, never reaching the client bundle.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-219

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-219-web-adj-1.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
