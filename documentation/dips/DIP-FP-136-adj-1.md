DIP-FP-136-adj-1
Story Summary
Post-merge adjustment on PR #80's login logo, per Joseph's screenshot review: the logo is too small and the earlier "left-aligned" instruction (Joseph's own words, now reconsidered) produced a subtle negative-margin offset that undersells it. New instruction: drop the offset entirely, let the logo take up as much of the card's horizontal width as possible without distortion.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check

Confirmed live: app/login/page.tsx's <img> is currently className="-ml-3 mb-4 h-auto w-36" (144px wide) inside a max-w-sm (384px) card with p-8 (32px) padding on each side — so available content width is ~320px, and the logo is currently rendering at under half that.
Confirmed live: public/flockpulse-logo.png is 640×320px (2:1 aspect, transparent background) — plenty of source resolution to render at the card's full ~320px content width without upscaling artifacts (640px source ÷ 320px display = exactly 2x, ideal for retina, no need to re-export a larger source file).
Fix is purely a className change: w-full (fills the content column exactly, no distortion since h-auto already preserves aspect ratio) and drop the -ml-3 offset entirely, since the "more left than the heading" instruction is superseded by this new direction.

Implementation Plan

app/login/page.tsx — change the <img> className from "-ml-3 mb-4 h-auto w-36" to "mb-4 h-auto w-full". No other change.
Visually verify (dev server + browser, same as the prior round) that the logo now spans the card's full content width, stays proportional, and the form still comfortably fits without pushing below the fold — adjust mb-4 spacing if the larger logo makes the card feel cramped.

Files to Create/Modify

app/login/page.tsx (modify — one className change)

Migration Files
None.
Branch Name
feature/FP-136-adj-1-login-logo-full-width
Commit Message
FP-136: adj-1 — login logo full card width, remove left offset
Pull Request Description
Per Joseph's screenshot review: logo was too small under the prior "left-aligned, offset from heading" spec. Now spans the login card's full content width (w-full, aspect-ratio preserved via h-auto), no distortion given the source image's 2x-retina resolution margin at this display size.
Jira Linkage

PDEEpicID: FP-5
PDEStoryID: FP-136 (post-merge adjustment, already Done — no status change needed)

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-136-adj-1.md, no appended notes after. npm run build must pass cleanly. Open the PR against dev and stop — do not merge. Full diffs required in the completion report.
