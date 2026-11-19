### DIP — FP-249 (Web): add the FlockPulse logo to the coming-soon page

### Not covered — deliberately excluded
- **The legal pages** (`/privacy`, `/terms`, `/support`, `/delete-account`). They are a later FP-249 DIP.
- **Any change to the gate rules** (which hosts and environments are gated). Only the asset allowlist gains one file.
- **New image assets, or editing the existing ones.** Use the existing `public/flockpulse-logo.png` as is.
- **Vercel, DNS or Git settings, the mobile repo, and migrations.**

### Story Summary
PR #237 added the coming-soon gate, and production now shows the page at flockpulse.ca (verified 2026-11-18). The page is text only: the first DIP did not ask for the logo, which was Atlas's omission.

This DIP shows the existing FlockPulse logo on the page, styled like the login card. It also lets that one image file through the gate, so it loads on gated hosts.

### Repo Target
Web (`owgc-tech/flockpulse-web`). No mobile change.

### Grounding Check
**Verified by Atlas this session** (read from `origin/dev` at `686847e`):
- **`public/flockpulse-logo.png`:** 640×320 PNG. It shows the heart-and-sheep mark plus "FlockPulse" and "Measure · Tend · Thrive", on a white, non-transparent background.
- **`app/login/page.tsx`:** uses the logo as a plain `<img src="/flockpulse-logo.png" alt="FlockPulse" className="mb-4 h-auto w-full" />` inside a white card:
  - outer `main`: `bg-zinc-50 … dark:bg-black`;
  - card: `rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950`.
- **`src/lib/site-gate.ts`:** `ASSET_EXACT = new Set(['/favicon.ico', '/icon.png'])`. On a gated host, `/flockpulse-logo.png` currently resolves to `'coming-soon'`, so the image would be replaced by the HTML page.
- **`proxy.ts`:** the matcher excludes `_next/static`, `_next/image`, `favicon.ico` and `icon.png`. It does **not** exclude `flockpulse-logo.png`, so the gate decides for that file.
- **`app/coming-soon/page.tsx`:** text only (FlockPulse, the tagline, "Coming soon", the support link).
- **Production deployment** `dpl_6DvnS3tkdQJPDR1mdm6NdSRpKyDd` from `main` (merge `5e1bcde`, PR #238) is Ready and serves the coming-soon page. Seen by Joseph in a browser.

**Re-verify all of the above first.** Also check two things:
1. that the logo's background really is white, not transparent;
2. whether any other file in `public/` is referenced by the page after your change (none should be).

**Rules check:**
- The image is a static, public brand asset with no personal data.
- No new third-party request.
- The API stays gated.
- Dark mode: the white-background logo sits inside a white card, the same as the login page, so it never shows a white box on a black page.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-249-web-coming-soon-logo.md`. Create `feature/FP-249-coming-soon-logo` off current `dev`.
2. **`src/lib/site-gate.ts`:** add `'/flockpulse-logo.png'` to `ASSET_EXACT`, and update its comment. Nothing else changes in this file.
3. **`scripts/test-site-gate.ts`:** add checks that:
   - gated `/flockpulse-logo.png` → `'asset'`;
   - gated `/flockpulse-logo.png.html` → `'coming-soon'` (exact match only);
   - a non-gated preview host with `/flockpulse-logo.png` → `'pass'`.

   All earlier checks must still pass.
4. **`app/coming-soon/page.tsx`:** restyle to match the login page.
   - **Layout:**
     - outer `main`: `flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black`;
     - a centered card using the login card classes, `max-w-md`, with centered text.
   - **Inside the card, in this order:**
     1. the logo, as a plain `<img src="/flockpulse-logo.png" alt="FlockPulse" className="mx-auto mb-6 h-auto w-full" />`. Use a plain `img`, not `next/image`, matching the login page and avoiding `/_next/image` on the gated host;
     2. "Coming soon" as the `h1`, large but sized to fit the card, for example `text-4xl sm:text-5xl font-bold`;
     3. the line "Helping communities run their events, attendance and programs.";
     4. "Questions? support@flockpulse.ca" as the existing `mailto:` link.
   - **Remove** the separate "FlockPulse" text line, because the logo carries the name and `alt` gives it to screen readers.
   - **Keep** the metadata (title "FlockPulse — Coming soon", robots noindex).
   - No client-side code, data, auth or analytics.
5. **Checks.**
   - Run `npx tsc --noEmit`, the repo's lint step, `npx tsx scripts/test-site-gate.ts` and `npm run build`.
   - Run locally with `npm run dev`:
     - `curl -I -H "Host: flockpulse.ca" http://localhost:3000/flockpulse-logo.png` returns `200` with `content-type: image/png`;
     - `curl -H "Host: flockpulse.ca" http://localhost:3000/` returns HTML that contains `src="/flockpulse-logo.png"`;
     - preview and localhost are unchanged (`/login` still renders the login page with its logo).

     Paste the outputs.
   - `git diff dev --stat` lists only the files below.
   - Stop the dev server when done (do not leave it running on port 3000).
6. **Commit, push, and open the PR** with `gh pr create --base dev`.

### Files to Create/Modify
- **Create:** `documentation/dips/DIP-FP-249-web-coming-soon-logo.md` (verbatim, then frozen).
- **Modify:**
  - `src/lib/site-gate.ts` (one entry);
  - `app/coming-soon/page.tsx`;
  - `scripts/test-site-gate.ts` (already tracked).
- **Must stay untouched:**
  - `proxy.ts`. Show `git diff dev [branch] -- proxy.ts` with zero output.
  - Everything in `public/`, `src/lib/auth` and `app/login`.

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-249-coming-soon-logo

### Commit Message
FP-249: show FlockPulse logo on the coming-soon page

### Pull Request Description
Plain GitHub markdown. Include:
- what changed;
- the test script output and the curl results;
- the dark-mode reasoning (a white card around a white-background logo);
- deviations with reasons.

**Not tested:**
- a real Vercel production deployment;
- the logo's appearance on real phones and browsers.

**Steps for Joseph:**
1. Merge into `dev`, wait for Vercel to show Ready, then check that preview.flockpulse.ca login looks normal.
2. Open a PR `dev` → `main` and merge it with "Create a merge commit". Do not delete `dev`.
3. When the production deployment is Ready, open https://flockpulse.ca in incognito, in light and dark mode, on desktop and phone. The page should show the logo in a white card with "Coming soon".

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-249

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-249-web-coming-soon-logo.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually. Do not change main, Vercel settings or DNS.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
