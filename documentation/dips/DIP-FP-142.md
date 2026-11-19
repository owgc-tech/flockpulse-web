DIP-FP-142.md
Story Summary
FP-130's Community granularity view outputs a single aggregate row currently labeled with the literal string 'Community', hardcoded in getAttendancePercentage's COMMUNITY branch. This DIP replaces that with the tenant's actual community name, reusing the existing getTenantSettings() function already used elsewhere in the admin shell — no new query mechanism needed.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check
Confirmed live against dev:

The literal string 'Community' appears in three places in AttendanceReportBrowser.tsx/report.repository.ts, and only one of them is what Joseph means:

labelHeader (the granularity's column header, e.g. "Member"/"Group"/"Community") — stays as-is. This is a category label, same as how the "Member" and "Group" column headers don't change per row; renaming it to the tenant name would be inconsistent with those two.
The granularity radio toggle option label ("Member"/"Group"/"Community") — stays as-is, since it's naming a selectable mode, not report output.
getAttendancePercentage's COMMUNITY branch, in report.repository.ts: return [{ key: 'community', label: 'Community', ... }] — this is the one Joseph means, the actual row's identifying text, rendered via {row.label} in the results table body.


getTenantSettings(tenantId) (in src/features/tenant/service.ts) already exists, is already used elsewhere (the admin shell layout, for the Community Banner), and its return shape already includes .name — no new query needed, just reused.
Only the COMMUNITY branch needs this — MEMBER and GROUP granularities already use real member/group names, unaffected.

Implementation Plan

app/api/reports/attendance/percentage/route.ts: when granularity === 'COMMUNITY', call getTenantSettings(ctx.tenantId) and pass its .name through to getAttendancePercentage as a new communityName filter field (only fetched when actually needed, not on every request regardless of granularity).
report.repository.ts: add communityName?: string to AttendancePercentageFilters. In the COMMUNITY branch, use filters.communityName ?? 'Community' as the row's label (falling back to the old literal only if the name is somehow unavailable, not as the normal path).

Files to Create/Modify

app/api/reports/attendance/percentage/route.ts
src/features/reports/report.repository.ts

Migration Files
Not applicable.
Branch Name
feature/FP-142-community-name-in-report
Commit Message
FP-142: show actual community name instead of generic "Community" label in Attendance % report
Pull Request Description
Maps to acceptance criteria:

"Community row shows the tenant's actual name" → getTenantSettings() reused, threaded through as communityName.
"Column header and granularity toggle stay as 'Community'" → deliberately untouched, since those are category/mode labels, not report content — matches how Member/Group column headers behave.
"Member and Group granularity rows unaffected" → no changes to either of those branches.

Jira Linkage

PDEEpicID: FP-36 (EPIC-9 — Reporting & Metrics)
PDEStoryID: FP-142

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-142.md, frozen after save. npm run build must pass cleanly. Open PR against dev, do not merge. No migration, no remote step.
Include full diffs for every file in the completion report.
