### DIP — FP-249 (Web): "Coming soon" gate for the production site (flockpulse.ca), preview unchanged

### Not covered — deliberately excluded
- **The legal pages** (`/privacy`, `/terms`, `/support`, `/delete-account`). They are a later FP-249 DIP. This DIP only builds the gate, with an allowlist that those pages will join.
- **Any Vercel, DNS or Git settings.** Joseph does these by hand after review: production branch, Porkbun DNS, environment variables.
- **The mobile repo.** The phone calls preview.flockpulse.ca, which this change must leave untouched.
- **Production database (FP-209) and region (FP-211).**
- **Any migration.**

### Story Summary
flockpulse.ca is the Production domain of the `flockpulse-web` Vercel project. Until tonight it served an old build from 2026-06-29, which most likely used the same database as the current app. Joseph pointed flockpulse.ca at a Porkbun parking page as a stopgap, but that page has no HTTPS certificate.

This DIP adds a site gate to the web app:
- **On a production deployment, or on the flockpulse.ca host,** every page shows a branded "Coming soon" page, and every API route returns 404.
- **On preview deployments (preview.flockpulse.ca, `*.vercel.app` preview URLs) and local development,** the app behaves exactly as today.

The same code can then be merged to `dev` and later to `main`, and production can safely track `main`. On launch day, one environment variable (or a later allowlist change) opens the site.

### Repo Target
Web (`owgc-tech/flockpulse-web`). No mobile change. The mobile app uses preview.flockpulse.ca and must keep working with zero change.

### Grounding Check
**Verified by Atlas this session** (read-only, via the Vercel connector):
- **Project domains:**
  - `flockpulse.ca` is the Production domain.
  - `preview.flockpulse.ca` is assigned to git branch `dev`.
  - `flockpulse-web.vercel.app` is the project's default production domain.
- **Production deployments:** only one exists, `dpl_DvRiAG6oacU9TqRqPv4wBcVSp6ER`, created 2026-06-29 from `dev` commit `ff27561`. Production has no branch configuration.
- **Environment variables:** the Supabase variables target both Production and Preview.

**NOT verified by Atlas.** There was no repository access this session, so verify each item first and report it:
1. **Where request interception lives.** Next.js 16 renamed `middleware.ts` to `proxy.ts`. Find which one this repo uses (under `src/` or the root) and what it already does. It most likely handles auth sessions, the MFA cookie `fp_mfa_expires_at`, and redirects to login. The gate must run **first**, before any auth or redirect logic, and must not change that logic for non-gated requests.
2. **The exact JSON error envelope** produced by `errorResponse` in `src/lib/auth/middleware`. Gated API responses must use the same shape, with code `NOT_FOUND`.
3. **Runtime availability of `VERCEL_ENV`** in the interception file. Vercel exposes system environment variables by default. If you cannot confirm it, rely on the host rule as well (below); keep both.
4. **Static assets the coming-soon page needs:** `/_next/static/*`, `/_next/image`, the favicon, and any logo file in `public/`.
5. **Whether `main` shares history with `dev`.** Run read-only: `git fetch origin` then `git merge-base origin/main origin/dev`. Report the result (a commit, or none). Do not change `main`.

**Rules check:**
- No tenant data is read or written.
- No new endpoint exists for the phone.
- Gated API responses use the canonical `NOT_FOUND` code in the standard JSON envelope, never an empty body.
- Nothing personal is logged.
- The coming-soon page loads no analytics, tracking or third-party scripts. The Privacy Policy promises none.

### Implementation Plan
1. **Bootstrap.**
   - Save this DIP verbatim to `documentation/dips/DIP-FP-249-web-coming-soon.md`.
   - Create `feature/FP-249-coming-soon-gate` off current `dev`.
   - Report the five grounding items above before writing code. If item 1 shows something unexpected (for example, no interception file, or one with unusual responsibilities), STOP and report.

2. **Pure decision helper:** `src/lib/site-gate.ts`, with no Next.js imports so it can be tested directly.
   - Export the function:
     ```ts
     siteGateDecision(input: {
       host: string;
       pathname: string;
       vercelEnv: string | undefined;
       publicLaunch: string | undefined;
     }): 'pass' | 'coming-soon' | 'api-not-found' | 'asset'
     ```
   - **Gated** means `publicLaunch !== 'true'` AND (`vercelEnv === 'production'` OR the host, lower-cased with any port removed, is `flockpulse.ca` or `www.flockpulse.ca`).
   - Not gated → `'pass'`.
   - Gated, with these results by path:
     - `/_next/static/`, `/_next/image`, `/favicon.ico`, and the specific `public/` files the page uses → `'asset'` (served normally);
     - `/api` or `/api/...` → `'api-not-found'`;
     - `/coming-soon` → `'pass'` (the page itself);
     - anything else → `'coming-soon'`.
   - Export a constant `GATE_PUBLIC_PATHS: string[] = []`. It stays empty for now; the legal pages are added later. Paths listed in it return `'pass'` while gated.

3. **Wire it into the existing interception file** (`proxy.ts` or `middleware.ts`), as the first thing it does:
   - `'coming-soon'` → `NextResponse.rewrite` to `/coming-soon`, so the URL in the browser does not change. Add the header `X-Robots-Tag: noindex`.
   - `'api-not-found'` → a 404 with the same JSON envelope as `errorResponse`, code `NOT_FOUND`, message `"Not available yet."`.
   - `'asset'` → return without any auth logic (`NextResponse.next()`).
   - `'pass'` → continue into the existing logic unchanged.

   Read `process.env.VERCEL_ENV` and `process.env.FP_PUBLIC_LAUNCH`. Use the request's host header for the host. If the existing matcher config excludes some paths, make sure the gate still sees every page and API path on gated hosts; adjust the matcher only if needed, and report it.

4. **The coming-soon page:** `app/coming-soon/page.tsx`, or the route-group equivalent if the app uses groups.
   - **Content:**
     - "FlockPulse";
     - the line "Helping communities run their events, attendance and programs.";
     - a large "Coming soon";
     - "Questions? support@flockpulse.ca" as a `mailto:` link.
   - **Behavior and styling:**
     - It is a server component with no data fetching, no auth, and no client-side scripts beyond what Next.js requires.
     - It uses the existing Tailwind theme and works in light and dark mode.
     - It is centered and readable at phone width.
     - Page `<title>`: "FlockPulse — Coming soon".
   - **Wording rules:** no religious wording (FlockPulse is general-purpose), and no analytics.
   - **If someone opens `/coming-soon` on preview,** it renders. That is harmless.

5. **Test script:** `scripts/test-site-gate.ts`. It is gitignored, so force-add it with `git add -f`. Run it with `npx tsx`, using plain asserts that cover at least:
   - preview host + `vercelEnv: 'preview'` → `pass` for `/`, `/login`, `/api/events`;
   - `localhost:3000` + `undefined` env → `pass`;
   - `flockpulse.ca` + `preview` env → gated (the host rule alone gates it);
   - `FlockPulse.CA:443` → gated (case and port handling);
   - `www.flockpulse.ca` → gated;
   - `flockpulse-web.vercel.app` + `production` → gated (the env rule);
   - gated `/` → `coming-soon`; gated `/login` → `coming-soon`; gated `/coming-soon` → `pass`;
   - gated `/api` and `/api/events/123` → `api-not-found`;
   - gated `/_next/static/x.js` → `asset`;
   - `publicLaunch: 'true'` + `flockpulse.ca` + `production` → `pass`;
   - `publicLaunch: 'TRUE'` → still gated (only exactly `'true'` opens the site).

6. **Checks.**
   - Run `npx tsc --noEmit`, the lint step the repo uses, `npx tsx scripts/test-site-gate.ts`, and `npm run build`.
   - Run locally with `npm run dev` and confirm with real requests:
     - `http://localhost:3000/` shows the normal app;
     - a request with the header `Host: flockpulse.ca` (curl with `-H "Host: flockpulse.ca"`) returns the coming-soon HTML for `/` and `/login`, and a 404 JSON envelope for `/api/` paths.

     Paste the curl outputs: the status line, the relevant headers, and the first lines of the body.
   - Confirm `git diff dev --stat` lists only the files below.

7. **Commit, push, and open the PR** with `gh pr create --base dev`.

### Files to Create/Modify
- **Create:**
  - `documentation/dips/DIP-FP-249-web-coming-soon.md` (verbatim, then frozen);
  - `src/lib/site-gate.ts`;
  - `app/coming-soon/page.tsx` (or the route-group equivalent);
  - `scripts/test-site-gate.ts` (force-added).
- **Modify:**
  - the existing `proxy.ts` or `middleware.ts`, with gate wiring only.
- **Must stay untouched:** everything else, including all API routes, auth code, and `next.config` (unless a change is unavoidable; then STOP and report first). Show `git diff dev [branch] -- src/lib/auth` with zero output.

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-249-coming-soon-gate

### Commit Message
FP-249: add coming-soon gate for production and flockpulse.ca

### Pull Request Description
Plain GitHub markdown. Include:
- **The gate rule in one paragraph:** production or flockpulse.ca is gated unless `FP_PUBLIC_LAUNCH=true`, and preview and local are unchanged.
- **The five grounding answers,** including the `main`/`dev` merge-base result.
- **The test script output and the local curl results.**
- **Deviations from this DIP, with reasons.**

**Not tested:**
- a real Vercel production deployment;
- real `VERCEL_ENV` values on Vercel;
- the flockpulse.ca DNS or certificate;
- the mobile app (no change expected).

**Steps for Joseph** (Atlas will confirm the order after review):
1. Merge into `dev`, and wait for Vercel to show Ready.
2. Check that preview.flockpulse.ca works exactly as before: web login and admin pages, and on the phone, pull to refresh and open an event.
3. Production release, with Atlas's exact steps after review: set Production to track `main`, bring `dev` into `main`, and wait for the production deployment to be Ready.
4. At Porkbun, change the `flockpulse.ca` ALIAS back to A `216.198.79.1`. Then check https://flockpulse.ca and https://flockpulse-web.vercel.app: both show "Coming soon", and `/api/...` returns the 404 JSON.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-249

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-249-web-coming-soon.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually. Do not change main, Vercel settings or DNS.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
