### DIP — FP-220-adj-1 (Web) — Apply the limit to all tasks, correctly enforce individual_only's own rule

### Story Summary
Two connected corrections to FP-220's already-shipped behavior. (1) The assignment-count limit was incorrectly exempted for individual_only tasks — it should apply to every task, always; individual_only only changes *what* can be assigned (people only, never groups), not whether the count limit applies. (2) individual_only's actual rule (no groups, ever) has no server-side enforcement at all today — only the picker UI hides the group search, confirmed via direct code check.

### Repo Target
Web (Next.js) — the shared assignment service, plus every picker usage (not just the one already wired).

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev` (post-FP-220 merge):
- `eventTaskAssignment.service.ts`'s count check is `if (!task.individual_only && count > limit)` — confirmed this incorrectly skips the limit entirely for individual_only tasks.
- No check anywhere in this file validates that an individual_only task's `assignee.group_ids` is empty — confirmed via direct search. The picker (`GroupMemberChipPicker.tsx`'s `individualOnly` prop) only hides the group search client-side; nothing stops a direct API call from submitting group_ids for an individual_only task.
- `EventForm.tsx`'s own task picker (confirmed, real-device tested by Joseph) doesn't receive `maxSelections` at all — the count limit currently only applies via `TaskAutoAssignPanel.tsx`.

### Implementation Plan
1. **`eventTaskAssignment.service.ts`**: change the count check to `if (count > limit)` — remove the `individual_only` exemption entirely.
2. Add a new, separate check: if `task.individual_only` and `assignee.group_ids.length > 0`, reject with a clear error (e.g., "This task can only be assigned to individuals, not groups") — this is genuinely independent from the count check, not a replacement for it.
3. **`GroupMemberChipPicker.tsx`**: confirm `maxSelections` is now applied regardless of `individualOnly` — the two props should compose (groups hidden AND count capped), not be mutually exclusive.
4. **`EventForm.tsx`**: wire its own task picker with `maxSelections={tenantSettings.taskAssignmentLimit}`, matching `TaskAutoAssignPanel.tsx` — closing the gap CC flagged as a "small follow-up if you want it." Joseph confirmed he wants it now, given real-device testing surfaced it directly.
5. **`runTaskAutoAssign`**: confirm its own count check (added per FP-220's "both usages" roster-cap decision) also drops the individual_only exemption consistently.

### Files to Create/Modify
- `src/features/tasks/eventTaskAssignment.service.ts` (modify)
- `src/features/tasks/autoAssign.service.ts` (modify)
- `app/admin/(shell)/events/GroupMemberChipPicker.tsx` (modify, if the exemption exists there too)
- `app/admin/(shell)/events/EventForm.tsx` (modify — wire in the previously-unwired picker)

### Migration Files (if applicable)
None — the `task_assignment_limit` column and its bounds are unchanged; this only corrects who the check applies to.

### Branch Name
feature/FP-220-web-adj-1-apply-limit-to-all-tasks

### Commit Message
FP-220-web-adj-1: apply assignment limit to all tasks, enforce individual_only's no-groups rule server-side

### Pull Request Description
Corrects two things: the count limit now applies to every task including individual_only ones (previously incorrectly exempted), and individual_only's actual rule (no groups) is now genuinely enforced server-side, not just hidden in one picker's UI. Also wires the previously-unwired `EventForm.tsx` picker with the same limit, closing a gap surfaced during Joseph's real-device testing. Confirm in the PR: re-test the exact scenario from tonight (Prayer Leader, individual_only, 7 people) — it should now be rejected/trimmed to the configured limit, same as Food Assignment and Music already are.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-220

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-220-web-adj-1.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment (specifically re-testing Prayer Leader with more than the configured limit, and confirming a group can no longer be submitted to an individual_only task via a direct save), and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
