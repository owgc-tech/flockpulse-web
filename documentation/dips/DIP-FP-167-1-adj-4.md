Story Summary
Post-merge fix (-adj-4) to FP-167 Phase 1. CC's diagnostic (PR #111) found a 100%-reproducing SSR/client hydration mismatch on the Events table's Date/Time column: new Date(ev.start_datetime).toLocaleString() formats differently on the server (Node's default locale) than in the browser, causing React to detect a text mismatch and regenerate the entire <table> subtree — including <thead> — on the client. This is the leading candidate for why the sticky header's bandHeight value gets stuck wrong. Fix the mismatch; do not touch sticky CSS in this DIP.
Repo Target
Web (Next.js, owgc-tech/flockpulse-web), app/admin/(shell)/events/EventsTable.tsx, line 254.
Grounding Check
Confirmed live: {new Date(ev.start_datetime).toLocaleString()} at line 254 is the only Date/Time rendering in this file. No locale/format options passed, so output depends on the runtime's default locale — different on Node (server) vs. Chrome (client), which is exactly what PR #111 measured (6/20/2026, 4:00:00 PM vs 2026-06-20, 4:00:00 p.m.). No schema/domain-rule involvement — pure rendering fix.
Implementation Plan

Replace the bare .toLocaleString() call with an explicit, deterministic format: pass a fixed locale and explicit options to toLocaleString, e.g. new Date(ev.start_datetime).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) (or equivalent explicit options) — the fix is forcing the same locale/format on server and client, not the specific style, so match whatever reads closest to the current 6/20/2026, 4:00:00 PM output.
Grep the rest of the file (and this component's imports) for any other unguarded toLocaleString()/toLocaleDateString() calls that would have the same problem; fix any found the same way. Do not expand scope beyond this file.
npm run build must pass cleanly.
Verify: reload /admin/events on Vercel dev (once deployed) or npm run dev locally with real data, open DevTools console, confirm the hydration-mismatch error from PR #111 no longer appears. This is the pass/fail check for this DIP — do not also re-test the sticky header behavior here, that's a separate follow-up DIP once this is confirmed fixed.

Files to Create/Modify

app/admin/(shell)/events/EventsTable.tsx (modify)

Migration Files
None.
Branch Name
feature/FP-167-1-adj-4-datetime-hydration-mismatch
Commit Message
FP-167-1-adj-4: fix Date/Time column SSR/client hydration mismatch
Pull Request Description
State explicitly whether the hydration console error is gone after the fix (paste console output, empty is fine as proof). Do not claim the sticky header is fixed — only that this specific mismatch is resolved; sticky re-verification is separate.
Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-167

Stop Point
Save verbatim to documentation/dips/DIP-FP-167-1-adj-4.md, no appends after. Open PR against dev, stop. Do not merge.
