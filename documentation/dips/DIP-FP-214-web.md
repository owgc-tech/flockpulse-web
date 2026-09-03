### Story Summary
Adds visible red-border highlighting to blank required fields on the Create/Edit Event form when Save fails — currently, the form relies entirely on the browser's own default (often subtle, inconsistent across browsers) required-field indicator, with only a generic top-of-form error banner otherwise. This makes it immediately obvious which field(s) need attention.

### Repo Target
Web (Next.js) — single file.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- Confirmed the complete list of required fields, including conditional ones: Name, Event Type, Start datetime, End datetime, Target — always required; Announcement body — required only when `isAnnouncement`; Location name, Location address — required only when `!isAnnouncement`; Zoom account — required only when `onlineMeetingMode === 'ZOOM'`; Platform name, Join link — required only when `onlineMeetingMode === 'OTHER'`.
- `handleSubmit` begins with `e.preventDefault(); setError(null);` — the correct insertion point for a new field-level validation pass, running before the existing business-logic checks (occurrence cap, announcement body).
- No existing field-level invalid-styling pattern exists anywhere in this codebase — confirmed via search. This is a genuinely new (small) pattern, not a mismatch with an existing convention to reconcile.
- `inputClass` is a single shared constant applied to every text input/select/textarea on this form — the correct place to conditionally append a red-border class based on that specific field's validity state, rather than duplicating the whole class string per field.

### Implementation Plan
1. Add a `fieldErrors` state object (e.g. `Record<string, boolean>`, keyed by field name) to the component.
2. In `handleSubmit`, immediately after `setError(null)`, compute which of the currently-applicable required fields (respecting the same conditional visibility already governing which fields render — e.g. don't flag Location name if `isAnnouncement`) are empty, populate `fieldErrors` accordingly, and — if any are true — `return` early without calling the save API (matching the existing early-return pattern already used for the occurrence-cap and announcement-body checks).
3. For each required field's `className`, conditionally append a red-border/background class (e.g. Tailwind `border-red-500`) when `fieldErrors[<field>]` is true, using `inputClass` as the base either way.
4. Clear a specific field's entry in `fieldErrors` inside its own `onChange` handler, the moment it becomes non-empty — so highlighting disappears as the user fixes it, without needing to re-click Save (per the ticket's explicit requirement).
5. No change to the existing generic error banner (`error` state) — it continues to handle non-field-specific failures (network errors, server-side validation) exactly as today.

### Files to Create/Modify
- `app/admin/(shell)/events/EventForm.tsx` (modify)

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-214-web-required-field-highlighting

### Commit Message
FP-214-web: highlight blank required fields on Create Event form

### Pull Request Description
Maps to FP-214's acceptance criteria: blank required fields now get a visible red border when Save is clicked and they're empty, clearing individually as each is filled in — no re-click needed. Applies consistently to every required field, including the conditional ones (Announcement body, Location fields, Online Meeting fields), respecting the same show/hide logic already governing when each is visible. Existing generic error banner untouched, this is purely additive for the blank-field case.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-214

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-214-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.
