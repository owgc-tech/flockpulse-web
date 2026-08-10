### DIP — FP-198 + FP-199 (Web)

### Story Summary
Two small, related Community/admin additions, combined into one DIP since both are web-only, small, and share the same settings-form/admin-page conventions: (1) a `tenants.timezone` field on the Community settings page, closing the gap left by FP-190-web-adj-1's bug fix (the column existed, nothing let you view/change it); (2) a new read-only admin page listing everyone's filed unavailability ranges, with name and date-range filters, so an admin can see who's unavailable before assigning tasks rather than only discovering it via the hard block.

### Repo Target
Web (Next.js) only — no mobile involvement in either piece.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- **FP-198**: `getTenantSettings()`/`updateTenantSettings()` (`tenant/service.ts`) already select/patch `tagline`, `description`, `invite_email_subject`, `invite_email_body` directly on `tenants` — `timezone` follows the identical pattern, no new table. `CommunitySettingsForm.tsx`'s existing `tagline` field (state, input, save button, char-limit display) is the precedent to mirror for the new field's UI shape — a `<select>` populated via `Intl.supportedValuesOf('timeZone')` (native, ES2022+, already usable given this app's Next.js/Node runtime — no new package needed for a full valid-IANA-name list), not free text, per the ticket's own "confirm at DIP time" question — a dropdown avoids the typo risk a free-text field would carry for a value that drives real date-boundary logic.
- **FP-199**: `listMemberUnavailabilityRanges()` (`member_unavailability.repository.ts`) is the existing single-member list query — the new admin-facing function is a genuinely different, tenant-wide query (optionally filtered by member/date), not a reuse of this one, though it lives in the same file/feature area.
- **Overlap semantics, confirmed exact and reused, not reinvented**: `mur.start_date <= [end] AND mur.end_date >= [start]` — the identical interval-overlap condition already used in FP-190's hard-block trigger and mobile's current-year filter. Applied here for consistency, per the ticket's own explicit lean.
- `/admin/roles/page.tsx` is the structural precedent for a new list-style admin page (route, page/table-component split).
- **Access level, confirmed by checking the actual nav config**: `/admin/tasks/auto-assign` is `adminOnly: false` (Leader-accessible, not Admin-only) — since this new page exists specifically to support task assignment (which Leaders can also do), it follows the same `adminOnly: false` level, nested under the same "Task Management" nav group as Task/Auto-Assign, not under Admin-only items like Members/Roles.
- **Nav label and position, confirmed with Joseph (2026-08-10)**: labeled "Unavailability" (singular — matches this nav's existing "Task," not a plural like Members/Roles/Groups), positioned within "Task Management" **between Task and Auto-Assign**, not after Auto-Assign — matching the natural workflow of checking who's unavailable before assigning, whether manually or via the round-robin.
- **Open question resolved with a stated default**: the name filter dropdown lists *all* members, not only those with a filed range — seeing "no results" for a specific person is itself useful information for an admin (confirms they have nothing filed), and a dropdown that silently excludes people would be less transparent, not more useful.

### Implementation Plan
1. **Migration**: none for FP-198 (`tenants.timezone` already exists, added by FP-190-web-adj-1). None for FP-199 (reads existing `member_unavailability_ranges`).
2. **FP-198 — `tenant/service.ts`**: add `timezone?: string` to `getTenantSettings()`'s select list and `updateTenantSettings()`'s input, validated against the same `Intl.supportedValuesOf('timeZone')` list server-side too (never trust the dropdown's own constraint alone — a direct API call could send anything).
3. **FP-198 — `app/api/tenant/settings/route.ts`**: pass `timezone` through, same pattern as every other field.
4. **FP-198 — `CommunitySettingsForm.tsx`**: new field, mirroring the `tagline` field's shape — label, `<select>` populated from `Intl.supportedValuesOf('timeZone')`, save button (can share the existing save action/button if it's a single-form save, or its own small save button matching the "Invitation Email" section's own independent save — confirm which at implementation time based on the form's actual save-granularity).
5. **FP-199 — new `member_unavailability.repository.ts` function** `listUnavailabilityForTenant(tenantId, filters: { memberId?: string; startDate?: string; endDate?: string })`: base query joins `members(first_name, last_name)`, optionally `.eq('member_id', filters.memberId)`, optionally applies the overlap condition above when both `startDate`/`endDate` are present. Validate the both-or-neither date rule here (throw `VALIDATION_ERROR` if exactly one of the two is present).
6. **New `app/api/members/unavailability/route.ts`** (admin-facing, distinct from the existing self-service `app/api/members/me/unavailability/*`): `GET`, `requireRole('LEADER')`, query params `memberId`/`startDate`/`endDate`, all optional, calling the new repository function.
7. **New `app/admin/(shell)/tasks/unavailability/page.tsx`** + a table component: name filter `<select>` (all members, alphabetical), start/end native date pickers (both-or-neither enforced client-side too, mirroring the server validation), results table (name, start date, end date). Read-only — no row actions at all.
8. **`AdminSidebar.tsx`**: add `{ href: '/admin/tasks/unavailability', label: 'Unavailability', adminOnly: false }` inside the existing "Task Management" children array, positioned between `Task` and `Auto-Assign` (not appended after).

### Files to Create/Modify
- `src/features/tenant/service.ts` (modify)
- `app/api/tenant/settings/route.ts` (modify)
- `app/admin/(shell)/community/CommunitySettingsForm.tsx` (modify)
- `src/features/members/member_unavailability.repository.ts` (modify)
- `app/api/members/unavailability/route.ts` (new)
- `app/admin/(shell)/tasks/unavailability/page.tsx` + table component (new)
- `src/components/admin/AdminSidebar.tsx` (modify)

### Migration Files (if applicable)
None — both features read/write existing columns/tables only.

### Branch Name
feature/FP-198-FP-199-web-timezone-and-unavailability-view

### Commit Message
FP-198-FP-199-web: tenant timezone setting + read-only admin unavailability view

### Pull Request Description
Maps to both stories' acceptance criteria: FP-198 adds a validated IANA-timezone dropdown to Community settings, closing the gap left after FP-190-web-adj-1's bug fix; FP-199 adds a read-only admin page ("Unavailability," nested under Task Management between Task and Auto-Assign, Leader-accessible) listing unavailability ranges with name/date filters, reusing the exact overlap-interval logic already established in FP-190's hard-block trigger, with the both-or-neither date validation enforced server-side, not just in the UI.

### Jira Linkage
- PDEEpicID: FP-8 (FP-198), FP-11 (FP-199)
- PDEStoryID: FP-198, FP-199

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-198-FP-199-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
