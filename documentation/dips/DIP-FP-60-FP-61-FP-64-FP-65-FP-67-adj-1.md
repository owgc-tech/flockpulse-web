Small post-merge fix, not a new DIP — following the adjustment-file convention (the original
DIP, DIP-FP-60-FP-61-FP-64-FP-65-FP-67.md, is already frozen and merged).

Gap: none of the Events screens have a way to navigate back except the browser back button.

Fix, three screens:

1. Create Event (app/admin/(shell)/events/new/page.tsx or EventForm.tsx in create mode):
   add a "Cancel" link next to the submit button, navigating to /admin/events.

2. Event Detail (app/admin/(shell)/events/[id]/EventDetail.tsx): add a "← Back to Events"
   link, navigating to /admin/events.

3. Edit Event (EventForm.tsx in edit mode): add a "Cancel" link/button next to "Save
   changes", navigating back to THIS SPECIFIC event's Detail page (/admin/events/[id]),
   not the list — since that's where Edit was navigated from. EventForm.tsx already has
   initialEvent available in edit mode, so use initialEvent.id to build this link.

Confirm the current structure of all three files live before editing. Keep styling
consistent with existing button/link classes (e.g. the border-only style used for "Edit"
on the Detail screen) rather than introducing a new visual pattern.

Run npm run build clean before committing. Commit message:
"FP-60-FP-61-FP-64-FP-65-FP-67: Add back/cancel navigation to Create, Edit, and Detail event screens"

Save this exact instruction verbatim to documentation/dips/DIP-FP-60-FP-61-FP-64-FP-65-FP-67-adj-1.md
before making any code changes — this file is never amended after saving; a further
correction would get adj-2.

Push to a new branch off dev (feature/FP-60-65-67-adj-1-event-nav-links or similar), open
a PR, and stop without merging.
