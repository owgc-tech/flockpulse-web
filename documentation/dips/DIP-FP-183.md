Story Summary
Fix CodeQL finding #3 (js/xss-through-dom): getMapsUrl() returns an admin-supplied location_url override with zero validation, used directly as an <a href>. Add a scheme check so only http(s) URLs pass through; anything else falls back to the existing address-based Google Maps link. This is an interim fix — FP-184 will remove the field entirely later; this just closes the security finding safely tonight.
Repo Target
Web (owgc-tech/flockpulse-web)
Grounding Check
Confirmed via direct source read: src/features/events/event.types.ts:139. Two call sites, both already handle a string return correctly (EventForm.tsx:507, EventDetail.tsx:210) — no changes needed at either call site, fix is fully contained to the one function.
Implementation Plan

In getMapsUrl(), change the if (locationUrl) return locationUrl; line to also check the scheme: only return locationUrl directly if it matches /^https?:\/\//i. Otherwise, fall through to the existing address-based Google Maps link — same as if no override were set at all.
npm run build and npm run typecheck must pass cleanly.
No test/lint scope changes needed.

Files to Create/Modify

src/features/events/event.types.ts

Branch Name
feature/FP-183-getmapsurl-scheme-validation
Commit Message
FP-183: validate URL scheme in getMapsUrl before using as href
Pull Request Description
Confirm CodeQL alert #3 no longer reproduces on next scan; confirm both call sites still work correctly with a normal https:// override and with no override at all.
Jira Linkage

PDEEpicID: FP-170
PDEStoryID: FP-183

Stop Point
Save verbatim to documentation/dips/DIP-FP-183.md. Open PR against dev, stop. Do not merge.
