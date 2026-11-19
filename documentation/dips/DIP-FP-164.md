DIP-FP-164.md
Story Summary
Fixes a confirmed backend bug (My Tasks shows tasks on DRAFT events forever, since the filter only ever excluded COMPLETED/LOCKED), adds refresh-on-focus to the My Tasks screen (it currently only fetches once on mount), and adds a tab badge matching Confirmations/Self-Report's existing pattern.
Repo Target
Both repos — the status-filter fix is web (backend), refresh + badge are mobile.
Grounding Check

Confirmed root cause: listMyTaskAssignments's filter (effective_status === 'COMPLETED' || 'LOCKED') never considered DRAFT — an event that was never published has no date-based lifecycle and would never resolve to those two states on its own. event_tasks_assignments rows aren't gated to SCHEDULED events the way event_attendees rows are (a real, pre-existing asymmetry, not something to fix here — out of scope).
Fix: flip from a denylist to an allowlist — only include SCHEDULED/ACTIVE. More robust than adding DRAFT to the denylist, since that's exactly the shape of bug that just happened (enumerating exclusions is fragile; enumerating the few valid inclusion states is not).
Refresh: My Tasks currently fetches once on mount only, unlike Confirmations/Self-Report (both refetch on focus). Mirror their existing pattern.
Badge: mirror Confirmations/Self-Report's exact badge implementation (sync trigger, tab bar wiring) — both already fully built, this is applying the same pattern to a third tab.

Implementation Plan

Web listMyTaskAssignments: change the exclusion check to an inclusion check: if (!event || !['SCHEDULED', 'ACTIVE'].includes(event.effective_status)) return null;
Mobile My Tasks screen: add useFocusEffect refetch, mirroring Confirmations/Self-Report's existing implementation exactly.
Mobile badge: add a badge count service/hook mirroring Confirmations/Self-Report's exact pattern, wire into AnimatedTabBar's my-tasks/index entry (currently explicitly no-badge, per Phase 5's DIP — that decision is now superseded).

Files to Create/Modify
Web: src/features/tasks/eventTaskAssignment.service.ts
Mobile: My Tasks screen; new/existing badge service; _layout.tsx; AnimatedTabBar.tsx
Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-164

Stop Point
Save verbatim to documentation/dips/DIP-FP-164.md in both repos, frozen after save. Open separate PRs against dev, do not merge. No migration.
Include full diffs in the completion report.
