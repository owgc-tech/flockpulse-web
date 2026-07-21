Story Summary
Diagnostic-only DIP — no code changes. Three fix attempts on FP-167 Phase 1's sticky column header have each shipped based on reasoning or partial verification rather than confirmed observation of the real, authenticated, deployed page, and each has failed differently. The newest report narrows the symptom further: the header is missing specifically at rest, before any scroll, and reappears once scrolled — the reverse of a normal "doesn't stick" failure. Before attempting a fifth code change, this DIP requires CC to actually inspect the live DOM and report exact findings. No fix is authorized under this DIP.
Repo Target
Web (Next.js, owgc-tech/flockpulse-web) — investigation only, targeting the deployed dev Vercel environment's /admin/events page. No mobile involvement.
Grounding Check

Current live code on dev (post FP-167-1-adj-3, commit e7913b3) has <thead className="sticky z-[5] ..." style={{ top: bandHeight }}>, where bandHeight starts at useState(0) and is only set correctly after a ResizeObserver callback fires post-mount.
The band above it (<div className="sticky top-0 z-10 ...">) is a higher stacking order (z-10) than the thead (z-[5]).
Working hypothesis, not yet confirmed: on first paint, before ResizeObserver fires, bandHeight is 0, so the thead sticks at top: 0 — directly behind the band, hidden by it due to the z-index difference — until React re-renders with the real measured height. This DIP exists to confirm or rule this out with real measurements, not to fix it yet.
adj-3's commit message documented zero verification (no DOM measurements, no screenshots) before merge, unlike adj-1 and adj-2 — this DIP corrects that gap before any further code changes are authorized.
No schema, domain-rule, or migration concerns — this is frontend-only investigation.

Implementation Plan
No code may be modified under this DIP. Investigate the real, authenticated, deployed /admin/events page — not a synthetic reproduction, not a mock/unauthenticated route. If genuine access is blocked (auth, environment), stop and report the blocker explicitly rather than falling back to a reproduction silently — that substitution is exactly what produced false-positive verifications in adj-1/adj-2.

Load /admin/events on the deployed dev environment, authenticated, with the page fully at rest (no scroll interaction yet — this is the state the user's screenshot shows as broken).
In DevTools console, run and record the exact output of:

js   const thead = document.querySelector('thead');
   const band = document.querySelector('[class*="sticky"][class*="top-0"]'); // the title/filter band
   console.log('thead exists:', !!thead);
   console.log('thead computed style:', thead && getComputedStyle(thead).cssText.match(/(position|top|z-index|display|visibility|height):[^;]+/g));
   console.log('thead rect:', thead && thead.getBoundingClientRect());
   console.log('band rect:', band && band.getBoundingClientRect());

Take a screenshot of the Elements panel with <thead> selected, and the Computed Styles pane visible (specifically position, top, z-index, display, height).
Repeat steps 2–3 after scrolling ~300px down (a state confirmed to show the header correctly, per the user's report) — this gives a direct before/after comparison of the same measurements.
Check the browser console for any JS errors on page load, specifically anything related to ResizeObserver.
Note the exact timestamp/delay (approximately) between page load and any visible change in the header's position or visibility, if observable.
Confirm the deployed bundle actually reflects commit e7913b3 (not a stale cached build) — check the Vercel deployment's commit SHA in its dashboard or deployment URL metadata.

Files to Create/Modify
None. This DIP produces a written report only, delivered in the PR description.
Migration Files (if applicable)
None.
Branch Name
feature/FP-167-1-diag-1-header-render-investigation
Commit Message
FP-167-1-diag-1: investigate sticky header missing at rest (no code changes)
Pull Request Description
Must contain, verbatim, the raw output from steps 2–7 above — actual console output and computed style values, not paraphrased conclusions. State plainly whether the z-index/stacking hypothesis in the Grounding Check is confirmed, ruled out, or inconclusive, and why, based only on what was directly observed. If the real authenticated page could not be reached, state that explicitly as the finding instead of substituting a reproduction.
Jira Linkage

PDEEpicID: FP-11
PDEStoryID: FP-167

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-167-1-diag-1.md and do not append anything to it afterward — the report goes in the PR description only. Open the PR against dev with the findings and stop. Do not attempt any code fix under this DIP, even if the cause seems obvious from the findings — that's the next DIP, informed by real data instead of another guess. Do not merge.
