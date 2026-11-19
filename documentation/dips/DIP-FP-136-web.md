DIP-FP-136-web
Story Summary
Adds the FlockPulse wordmark logo (FlockPulseLogo4_AP5.png — wide/horizontal lockup) inside the existing login card, above the "Leadership sign in" heading, positioned further left than that heading's text. The heading itself is unchanged — this is purely additive.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check

Confirmed live: app/login/page.tsx is a single small file — <main> centers a <div className="w-full max-w-sm rounded-2xl border ... p-8"> containing <h1>Leadership sign in</h1> then <LoginForm />. This heading stays exactly as-is per Joseph's confirmation; only the logo is added above it.
Confirmed live: public/ currently only holds the default Next.js starter SVGs (file.svg, globe.svg, next.svg, vercel.svg, window.svg) — no brand assets yet. The logo will be added as public/flockpulse-logo.png.
Confirmed live: next/image is not used anywhere in this codebase (CommunityBanner.tsx and every other image reference use a plain <img> tag). This DIP follows that established convention rather than introducing next/image for the first time.
Placement note, stated explicitly rather than left ambiguous: the card's p-8 gives the <h1> and the logo the same left inset by default. To make the logo sit visibly further left than the heading (per Joseph's spec), the logo needs a small negative left margin pulling it outside that shared inset — exact pixel value is a visual judgment call to verify at implementation time, not a precise spec.
No conflict with Section 4 invariants — static asset + layout change only.

Implementation Plan

Add the logo image to public/flockpulse-logo.png (the attached FlockPulseLogo4_AP5.png, renamed to a clean asset filename — confirm reasonable file size/dimensions, optimize if the source file is unnecessarily large for a login-page logo).
app/login/page.tsx — insert an <img> above the <h1>, inside the same card div:

tsx   <img
     src="/flockpulse-logo.png"
     alt="FlockPulse"
     className="-ml-2 mb-4 h-auto w-40"
   />
   <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">Leadership sign in</h1>
Treat the -ml-2/w-40 values as a starting point, not a hard spec — adjust sizing/offset so the logo reads as clearly left-of the heading without looking accidental or breaking the card's balance. Confirm it doesn't push <LoginForm /> below the fold on a typical laptop viewport.
3. No changes to LoginForm.tsx, actions.ts, or any other login-flow file.
Files to Create/Modify

public/flockpulse-logo.png (new)
app/login/page.tsx (modify)

Migration Files
None.
Branch Name
feature/FP-136-web-login-logo
Commit Message
FP-136: add FlockPulse logo to web login card
Pull Request Description
Maps to FP-136's AC: logo renders inside the login card above the "Leadership sign in" heading (unchanged text), left-aligned but visibly offset further left than the heading, card remains visually balanced.
Jira Linkage

PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control)
PDEStoryID: FP-136

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-136-web.md, no appended notes after. npm run build must pass cleanly. Open the PR against dev and stop — do not merge; Joseph tests against the deployed dev environment and merges manually. Full diffs required in the completion report, including confirmation that LoginForm.tsx shows zero diff.
