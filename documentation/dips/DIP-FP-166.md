DIP-FP-166.md
Story Summary
Reverses two prior deliberate decisions (FP-94 and FP-66, both explicitly cited in the current code's own comment) that kept Cancelled events visible in My Events. Joseph now wants them filtered out, matching how COMPLETED/LOCKED events are already excluded.
Repo Target
Web only — listEventsForMember() lives in flockpulse-web; mobile consumes its output as-is, no mobile changes needed.
Grounding Check

Confirmed exact current filter: withEffectiveStatus.filter((e) => e.effective_status !== 'COMPLETED' && e.effective_status !== 'LOCKED'), with a comment explicitly citing both FP-94 and FP-66 as the reasons CANCELLED was deliberately allowed through. This DIP knowingly reverses both.
No other surface (admin Events list, Event Detail) is affected — this function is specific to the member-facing My Events endpoint.

Implementation Plan

Change the filter to also exclude CANCELLED: (e) => !['COMPLETED', 'LOCKED', 'CANCELLED'].includes(e.effective_status).
Update the comment to state plainly that this reverses FP-94/FP-66's original decision, per Joseph's direct request — not leave the old rationale in place looking unaddressed.

Files to Create/Modify

src/features/events/service.ts

Branch Name
feature/FP-166-hide-cancelled-my-events
Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-166

Stop Point
Save verbatim to documentation/dips/DIP-FP-166.md, frozen after save. npm run build must pass cleanly. Open PR against dev, do not merge. No migration.
Include full diff in the completion report.
