DIP-FP-191-web-adj-3

Story Summary
Fixes a real gap traced back to the original FP-191-web DIP: EventForm.tsx's
own isAnnouncement detection checks event_types.code, a field the guard
trigger from that same migration never protects — only name and deleted_at
are locked down. This means an admin could change code and web's own UI
would silently stop recognizing the Announcement type, even though the
backend RPC (which correctly checks system_key) would keep enforcing
everything correctly underneath. Fixes web's UI-layer check to use the
same properly-protected field the RPC and mobile already both use.

Repo Target
Web (Next.js), owgc-tech/flockpulse-web. Fresh branch off current dev.

Grounding Check
- Confirmed by direct search: this exact pattern (selectedEventType?.code
  === 'ANNOUNCEMENT') appears in exactly one place in the entire web repo —
  EventForm.tsx line 165. No other call site needs the same fix.
- Confirmed the guard trigger from the original migration
  (block_system_event_type_rename_or_delete) only checks NEW.name and
  NEW.deleted_at — code was never included, so it has always been fully
  editable with nothing stopping a change.
- Confirmed EventType (event-type.types.ts) already selects and types
  system_key — no new field, no new query, purely swapping which existing
  field this one check reads.
- This was caught during mobile's DIP-FP-191-mobile-adj-3 implementation —
  mobile correctly used system_key from the start and flagged web's
  inconsistency rather than copying it.

Implementation Plan
1. EventForm.tsx: change
   const isAnnouncement = selectedEventType?.code === 'ANNOUNCEMENT';
   to
   const isAnnouncement = selectedEventType?.system_key === 'ANNOUNCEMENT';
   No other changes — every other use of isAnnouncement in this file
   already derives correctly from this one line.

Files to Create/Modify
- app/admin/(shell)/events/EventForm.tsx (modify — one line)

Migration Files
None.

Branch Name
feature/FP-191-web-adj-3-announcement-detection-fix

Commit Message
FP-191-web-adj-3: fix EventForm's Announcement detection to use the protected system_key field, not the unprotected code field

Pull Request Description
- Confirm this is genuinely the only call site needing the change.
- Confirm the Announcement-conditional form still renders correctly after the swap (same behavior, just reading the correct field).

Jira Linkage
- PDEEpicID: FP-188
- PDEStoryID: FP-191

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-191-web-adj-3.md. Branch off current dev. Open a PR against dev and stop. Do not merge.

Include full diffs for every file in the completion report, no elisions.
