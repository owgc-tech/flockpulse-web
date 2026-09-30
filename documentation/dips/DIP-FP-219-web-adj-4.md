### DIP — FP-219-adj-4 (Web) — Reject Geocodio's 422 as a real rejection, not a fail-open case; remove diagnostic logging

### Story Summary
Fixes a genuine gap found via real evidence (Vercel logs showing "Punzalan"/"Punzalan's" both getting a 422 from Geocodio, then being waved through by the fail-open safety net). Geocodio's own documentation confirms a 422 means "this input is definitively unprocessable" (e.g., no city/state/zip context at all) — a deterministic rejection signal, not a sign of a service outage. The current code treats it identically to a genuine 5xx/timeout/network failure, incorrectly letting it through. Also removes the `[FP-219-investigate]` diagnostic logging added earlier tonight — its job (finding this exact bug, and the earlier accuracy_type bug) is done, and real address text has been sitting in Vercel's logs long enough.

### Repo Target
Web (Next.js) — single file.

### Grounding Check
Confirmed live via Vercel logs (session of 2026-09-30/10-01): `address="Punzalan"` and `address="Punzalan's"` both produced `HTTP 422 — returning true (fail open)`.
Confirmed against Geocodio's own documentation: a 422 specifically means "a client error prevented the request from executing" (e.g., missing city/state/zip context) — distinct in kind from a 5xx server error, a network failure, or a timeout, all of which genuinely indicate Geocodio itself may be unavailable.

### Implementation Plan
1. In `isResolvableAddress()`, split the current single `if (!res.ok)` check into two cases: if `res.status === 422`, treat it the same as `results.length === 0` — log and `return false` (a real rejection, with a message like "address is too incomplete to verify" if useful context is needed later). For every other non-2xx status, keep the existing fail-open behavior unchanged.
2. Remove every `console.log('[FP-219-investigate]...')` line added across the last few PRs — the existing `console.warn('[geocodio]...')` lines stay, since those are legitimate, permanent operational logging (they don't include the raw address text), not temporary diagnostics.
3. No change to the `accuracy`/`accuracy_type` logic from FP-219-adj-2 — this only changes how a 422 specifically is handled, before that logic is ever reached.

### Files to Create/Modify
- `src/lib/geocodio.ts` (modify)

### Branch Name
feature/FP-219-web-adj-4-reject-422-remove-diagnostics

### Commit Message
FP-219-web-adj-4: treat Geocodio 422 as a real rejection; remove temporary diagnostic logging

### Pull Request Description
Fixes "Punzalan"/similar bare, contextless text being accepted — Geocodio's 422 (a deterministic "unprocessable" signal) was being treated the same as a genuine service outage. Now rejected the same way as a clean "no results" response. Also removes the temporary `[FP-219-investigate]` logging added during tonight's investigation — its job is done. Confirm in the PR: re-test "Punzalan" (should now reject with a clear error) and confirm a real address with full city/province context still passes, and confirm a genuine Geocodio outage (e.g. temporarily wrong API key) still fails open as before.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-219

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-219-web-adj-4.md and do not append executor notes, observations, or any other content to that file after the initial save. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
