DIP-FP-125-FP-133-adj-1
Story Summary
Post-merge UI polish on the Community Settings "RSVP & Attendance" card from DIP-FP-125-FP-133, per Joseph's live testing (2026-07-17): (1) reorder the two fields so RSVP closure default comes first, attendance window second — matching event chronology (RSVP happens before an event; attendance reporting after it); (2) relabel "Attendance window (hours)" to "Attendance Reporting and Confirmation Window (hours)". No behavior, validation, API, or schema changes — labels and JSX order only.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web, branch off dev (which now contains PR #75).
Grounding Check
Both fields live in app/admin/(shell)/community/CommunitySettingsForm.tsx inside the "RSVP & Attendance" card, in both the editable (canEdit) form and the read-only Leader-tier block — both variants must be reordered and relabeled identically. The save action submits both values together regardless of visual order, so reordering is presentation-only. Invariants untouched; no error codes; no migration.
Implementation Plan

Phase 0: branch off dev → verify the two render blocks match the description → save this DIP verbatim → code.
In the editable form: move the "RSVP closure default (days)" field group above the attendance-window field group; change the attendance label text to "Attendance Reporting and Confirmation Window (hours)". Helper texts unchanged.
Mirror the same order + label in the read-only block.
npm run build passes.

Files to Create/Modify
app/admin/(shell)/community/CommunitySettingsForm.tsx
documentation/dips/DIP-FP-125-FP-133-adj-1.md   (new)
Migration Files
None.
Branch Name
feature/FP-125-FP-133-adj-1-settings-field-order
Commit Message
FP-125 FP-133 adj-1: reorder RSVP/attendance settings fields, relabel attendance window
Pull Request Description

RSVP closure default renders above the attendance window in both editable and read-only variants (chronological order per product feedback).
Attendance field relabeled "Attendance Reporting and Confirmation Window (hours)"; behavior, validation, and helper text unchanged.

Jira Linkage

PDEEpicID: FP-5 / FP-15
PDEStoryID: FP-125, FP-133 (adjustment round)

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-125-FP-133-adj-1.md; never append to it. npm run build before pushing. Open the PR against dev and stop — do not merge. Full diff in the completion report; this one should be small enough to verify at a glance.
