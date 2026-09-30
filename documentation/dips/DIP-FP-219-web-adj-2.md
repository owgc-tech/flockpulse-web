### DIP — FP-219-adj-2 (Web) — Require a real address type, not just a high score

### Story Summary
Fixes real addresses failing to get rejected (e.g. "Test" scoring a perfect 1.0) — root cause confirmed via diagnostic logging: `accuracy` measures how exactly a result's text matches the input string, not whether that result is a genuine street-level location. Geocodio's own documentation explicitly recommends checking `accuracy_type` alongside the score; the current code only checks the score. The fix rejects vague, region-only match types even when the score is high, and shows a clear error — matching Joseph's actual intent: block "Test," confirm it's a real address, or show an error.

### Repo Target
Web (Next.js) — single file (`src/lib/geocodio.ts`).

### Grounding Check
Confirmed live via diagnostic logging (PR #202): a request for "Test" returned `accuracy=1`, `decision=true` — the bug is real and reproduced, not theoretical.
Confirmed via Geocodio's own official documentation: `accuracy_type` values split cleanly into street-level types (`rooftop`, `range_interpolation`, `nearest_street`, `point`, `nearest_rooftop_match`, `street_center`, `intersection`) and vague, region-centroid types (`place` — city/zip centroid, `county`, `state`, `nearest_place`) — the latter group explicitly documented as "zip code or city centroid," not a real, specific location.

### Implementation Plan
1. In `isResolvableAddress()`, after checking `data.results.length === 0`, also read `data.results[0]?.accuracy_type`.
2. Define an explicit allow-list of acceptable types: `rooftop`, `range_interpolation`, `nearest_street`, `point`, `nearest_rooftop_match`, `street_center`, `intersection`.
3. The final decision requires BOTH: accuracy ≥ `MIN_ACCURACY` AND `accuracy_type` is in the allow-list. A result with a vague type (`place`, `county`, `state`, `nearest_place`, or anything unrecognized) is rejected, regardless of its accuracy score.
4. Update the diagnostic log line (still present from PR #202) to also show `accuracy_type`, so this can be verified against real addresses before the temporary logging is removed.
5. Keep the same fail-open behavior for every error path — this change only affects the success path's decision logic.

### Files to Create/Modify
- `src/lib/geocodio.ts` (modify)

### Branch Name
feature/FP-219-web-adj-2-require-real-address-type

### Commit Message
FP-219-web-adj-2: require a real accuracy_type, not just a high score

### Pull Request Description
Fixes "Test" (and similar non-addresses) being wrongly accepted. Root cause: a high `accuracy` score only means an exact string match, not a real location — Geocodio's own docs recommend checking `accuracy_type` too. Now requires both a sufficient score AND a genuine street-level type. Confirm in the PR: retest "Test" (should now reject with a clear error) and a real street address (should still pass) — paste both log lines showing the type and decision for each.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-219

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-219-web-adj-2.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test both a rejection and a real address, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
