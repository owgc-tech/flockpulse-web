DIP-FP-182-web-adj-2

Story Summary
Adds a per-star-rating breakdown (count of 5-star, 4-star, 3-star, 2-star, 1-star ratings, including zero-count stars) to the Dashboard stats endpoint, needed for the new bar-graph redesign on mobile. This can't be derived from the existing `feedback` list, since that list only includes ratings that also had text feedback attached — a 5-star rating with no comment currently isn't represented anywhere in the response at all.

Repo Target
Web (Next.js), owgc-tech/flockpulse-web. Continues on the existing branch feature/FP-182-web-dashboard-api (PR #144, already merged) — this needs a fresh branch off current dev, since #144 is already in.

Grounding Check
- Confirmed by re-reading getDashboardStats()'s existing rating query: it already fetches every SELF_REPORTED_YES row's star_rating (not just ones with feedback text) into `ratings` for the average/rounded calculation — the raw data needed for a full breakdown is already being fetched, it's just never grouped by value and returned.
- "Including zero-count stars" is a real requirement, not an oversight to skip — Joseph's own example explicitly lists 2-star and 1-star at 0, meaning the UI wants to always show all five rows for scale/context, not just the stars that got at least one rating.
- No new query needed — the breakdown is a simple count-by-value over the `ratings` array already being computed in this function; purely additive to the existing response shape.

Implementation Plan
1. In getDashboardStats() (src/features/reports/report.repository.ts), after computing `ratings` (the array of non-null star_rating values already being averaged), add a `breakdown` computation: for each star value 5 down to 1, count how many entries in `ratings` equal that value. Always include all five entries in the output array, even when the count is 0.
2. Add `breakdown: { star: number; count: number }[]` to the `rating` object in `DashboardStatsResult`, ordered 5 down to 1.
3. No route or service-layer changes needed — same pass-through as before.

Files to Create/Modify
- src/features/reports/report.repository.ts (modify — getDashboardStats() and DashboardStatsResult only)

Migration Files
None.

Branch Name
feature/FP-182-web-adj-2-rating-breakdown

Commit Message
FP-182-web-adj-2: add per-star rating count breakdown to dashboard stats

Pull Request Description
- Confirm a sample response showing all five star values present, including any at 0.
- Confirm the breakdown total (sum of all five counts) equals rating_count.

Jira Linkage
- PDEEpicID: FP-36
- PDEStoryID: FP-182

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-182-web-adj-2.md. Branch off current dev (feature/FP-182-web-dashboard-api from #144 is already merged in). Open a PR against dev and stop. Do not merge.

Include full diffs for the changed section, no elisions.
