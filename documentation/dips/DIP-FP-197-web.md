### DIP 1 of 2 — Web

### Story Summary
Extends `GET /api/reports/dashboard/stats` to detect Announcement-type events and return an acknowledgement summary (acknowledged count, not-acknowledged count, total targeted count, percent) instead of the meaningless attendance/RSVP/rating zeros it returns today — reusing FP-191's exact `event_attendees` + `announcement_acknowledgements` join pattern rather than reimplementing it. Non-Announcement events are completely unaffected.

### Repo Target
Web (Next.js) — single endpoint/repository change; mobile (DIP 2 of 2) consumes the new field.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- `getDashboardStats()` (`report.repository.ts:868`) queries `event_attendees` for the roster regardless of event type, then unconditionally queries `attendance`/`rsvps`/self-report data — both always empty for Announcements (per FP-191's design, they use `announcement_acknowledgements` instead) — confirming exactly why today's cards show meaningless zeros for Announcements, not a display bug but a genuine data-source mismatch.
- `getAnnouncementRoster()` (`announcement.repository.ts:134`) is the exact pattern to mirror: fetch `event_attendees` (`member_id`) for the event/tenant as the targeted-member set, then fetch `announcement_acknowledgements` (`member_id`, `acknowledged_at`) for the same event/tenant, joined by `member_id`. Reused directly, not reinvented.
- `insert_event_with_audit()`'s own `v_is_announcement` check (`event_types.system_key = 'ANNOUNCEMENT'`) is the established pattern for detecting an Announcement event — same join, same convention, reused here for the branch decision.
- `DashboardStatsResult` (`report.repository.ts:842`) currently has `attendance`/`rsvp`/`rating` all required — becomes an additive change: those three become optional, a new optional `announcement` field is added, so callers can branch on which is present rather than relying on implicit zero-value checks.

### Implementation Plan
1. **`report.repository.ts`**: `getDashboardStats()` — after resolving the event row, also fetch `event_type_id` and join `event_types.system_key` to determine `isAnnouncement`. If true: skip the existing attendance/rsvp/rating queries entirely; instead run the `event_attendees` + `announcement_acknowledgements` join (mirroring `getAnnouncementRoster()`'s exact pattern), compute `acknowledged_count` (rows with non-null `acknowledged_at`), `not_acknowledged_count` (remainder), `total_count`, and `percent` (0-100, one decimal, rounded server-side, `null` when `total_count` is 0 — matching `attendance.percent`'s existing null convention). Return `{ announcement: {...} }` with `attendance`/`rsvp`/`rating` omitted. If false: existing behavior, completely unchanged, `announcement` omitted.
2. **`DashboardStatsResult`** (interface): make `attendance`/`rsvp`/`rating` optional, add optional `announcement: { acknowledged_count: number; not_acknowledged_count: number; total_count: number; percent: number | null }`.
3. **`report.service.ts`**: no change needed — it's a pure passthrough (`getDashboardStatsRepo(...)`), the new shape flows through automatically.
4. **`app/api/reports/dashboard/stats/route.ts`**: update its header comment to mention the Announcement case; no logic change needed (JSON passthrough already handles whichever shape comes back).

### Files to Create/Modify
- `src/features/reports/report.repository.ts` (modify)
- `app/api/reports/dashboard/stats/route.ts` (modify — comment only)

### Migration Files (if applicable)
None — no schema changes, this only queries existing tables.

### Branch Name
feature/FP-197-web-announcement-board-card

### Commit Message
FP-197-web: return acknowledgement summary for Announcement events in dashboard stats

### Pull Request Description
Maps to FP-197's acceptance criteria: `GET /api/reports/dashboard/stats` now returns an `announcement` summary block (acknowledged/not-acknowledged/total counts + percent) for Announcement-type events, reusing FP-191's exact roster-join pattern, while non-Announcement events keep their existing `attendance`/`rsvp`/`rating` response completely unchanged.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-197

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-197-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
