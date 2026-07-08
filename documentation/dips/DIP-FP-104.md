# DIP-FP-104 — Admin Nav Shell + Top Community Banner (name, logo, tagline)

**Covers:** FP-104 (Admin Nav Shell + Top Community Banner)
**Epic:** FP-5 (EPIC-1 — Tenant & Access Control)

---

## Not Covered — Deliberately Excluded

- **Full Community Information and Configuration screen.** This DIP builds a minimal page at `/admin/community` covering only logo upload and tagline (per Jira comment resolution) — community **name** is displayed read-only there for context but is not made editable in this pass. A full config screen (name editing, attendance window UI, anything else) is future scope.
- **Server-side pixel-dimension enforcement for the logo.** The upload control shows recommended dimensions as UI copy; the server validates file type and size, not actual pixel dimensions (would require an image-processing dependency not currently in this repo — flagged as a deliberate boundary, not an oversight).
- **Color theming for the banner.** Explicitly excluded by the user in the original design conversation.
- **Folding logo/tagline into the FP-101 founder registration wizard.** Confirmed available only post-registration, via the new `/admin/community` page.

---

## Story Summary

Three previously-separate concerns, all under one Jira story because they're genuinely coupled: (1) a persistent Admin navigation shell (left sidebar) replacing every page's current ad hoc header/cross-links, (2) a top Community Banner showing tenant name/logo/tagline, which requires adding `logo_url`/`tagline` columns and a first-ever Supabase Storage bucket for the logo upload, and (3) fixing Formation's three-column browse screen having no responsive breakpoints — folded in because the shell itself needs responsive treatment regardless, and it's the same layout pass.

---

## Repo Target

**Web — `owgc-tech/flockpulse-web`**, working branch `dev`. Admin-only.

---

## Grounding Check

1. **First-ever Supabase Storage usage in this repo — genuinely new territory, not an established pattern to copy.** No bucket, no `storage.objects` policy, no Storage-related code exists anywhere in the current codebase (confirmed via direct grep this session). The `storage.foldername()` helper function referenced in this DIP's planned RLS policies is a documented, standard Supabase convention for path-scoped storage RLS — but per this project's standing discipline (the same "verify against actual current codebase, not assumed from training data" rule that caught the `@supabase/ssr` API-shape and `middleware.ts`→`proxy.ts` surprises earlier this project), **CC must confirm `storage.foldername()`'s exact behavior against the actual installed Supabase CLI/Postgres extension version before relying on it**, not assume it matches documentation from memory.

2. **Enforcement model: uploads go through a Server Action using the service-role client — consistent with every other write in this codebase — not a client-direct-write relying on storage RLS.** Every existing table in this repo (courses, modules, talks, invitations, tenants) follows the same pattern: RLS policies exist as a backstop, but actual application writes go through `serviceClient()` (service-role key, bypasses RLS) with the Admin/tenant check enforced in application code (`getAdminContext`-style helpers). This DIP's logo upload follows the identical pattern — the storage RLS policies in the migration are defense-in-depth, not the primary enforcement mechanism. Do not build a client-side-direct-to-Storage upload flow; it would introduce a second, inconsistent security model.

3. **Dimension guidance is advisory UI copy only — not server-enforced.** File **type** (`image/png`, `image/jpeg` only) and file **size** (max 2MB) are validated server-side, since both are cheap checks with no new dependency. Pixel dimensions (recommended minimum 256×256, square) are shown as text next to the upload control but not validated server-side — validating actual image dimensions would require an image-processing library (e.g. `sharp`) not currently a dependency of this repo. These three numbers (256px / PNG-JPG / 2MB) are defaults proposed by Atlas, not fixed product law — confirm with the user before implementation if you want them adjusted.

4. **Route restructuring via Next.js route groups — must be verified against the actual installed Next.js 16.2.9 behavior before committing to it, given this project has already been bitten once by an unannounced Next.js 16 breaking change (`middleware.ts` → `proxy.ts`, discovered during FP-102).** The plan is to move `app/admin/formation/`, `app/admin/invitations/`, and `app/admin/restore/` into a route group `app/admin/(shell)/` (parenthesized folder names are excluded from the URL path in Next.js App Router — `app/admin/(shell)/formation/page.tsx` still resolves to `/admin/formation`), so a single `app/admin/(shell)/layout.tsx` wraps all three with the shell, while `/admin/invite` and `/admin/mfa-enroll` stay outside the group and get no shell at all. **Confirm this route-group behavior is unchanged in the actually-installed Next.js 16.2.9 before doing the directory moves.** If it doesn't behave as expected, fall back to a shared layout *component* (not a true route-group layout) imported individually into each existing page — functionally equivalent, less clean, but doesn't depend on unverified framework behavior.

5. **`/admin/invite` and `/admin/mfa-enroll` are excluded from the shell entirely, not merely absent from the nav list.** `/admin/mfa-enroll` is a pre-full-authentication step (a session that hasn't completed MFA yet reaches this route, per `proxy.ts`'s existing exemption) — showing a full navigational shell there would let a not-yet-fully-verified session see navigation to other Admin areas, which is a UX/consistency smell even though `proxy.ts` still gates actual access. `/admin/invite` is a narrow single-purpose form reached via a button from Invitations; it doesn't need the shell either. Both stay as standalone pages, unchanged in this DIP beyond removing any now-redundant references to the old ad hoc cross-links.

6. **Tenant RLS confirmed unchanged — single blanket `FOR ALL USING (id = get_tenant_id())` policy already exists** (migration `20260629000000`). No changes needed since, per Grounding Check item 2, actual mutation continues through the service-role client with application-level Admin checks, same as everywhere else.

7. **Community name is explicitly NOT editable in this pass** (Grounding Check / Not Covered above) — displayed read-only on `/admin/community` for context (so the page isn't confusingly logo/tagline-only with no sense of which tenant you're configuring), but no update path for it is built here.

8. **Cache-busting required for re-uploaded logos.** The logo is stored at a fixed path per tenant (`${tenantId}/logo`, upserted on each upload — not a new file per upload, to avoid orphaned old files accumulating). Because the URL itself doesn't change on re-upload, `tenants.logo_url` must be stored with a cache-busting query parameter (e.g. `?v=<upload-timestamp>`) appended, updated on every upload, so browsers/CDN don't keep serving a stale cached image after a replacement.

9. **No conflicts with Section 4 invariants.** Pure tenant-configuration and layout/navigation work — no RSVP/self-report/attendance/formation-domain data touched.

10. **Prior work check:** no `documentation/dips/DIP-FP-104*.md` exists. No Storage bucket, no shared Admin layout, no `logo_url`/`tagline` columns exist in the repo (confirmed via direct clone-and-grep this session).

11. **Canonical error codes.** `VALIDATION_ERROR` for bad file type/size/empty tagline-too-long. No new ad hoc codes.

---

## Implementation Plan

### Step 1 — Migration
Single new migration file (verify actual next sequence number at execution time; latest confirmed this session is `20260707000024`):

1. `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url TEXT, ADD COLUMN IF NOT EXISTS tagline TEXT;` — both nullable.
2. Create the Storage bucket: `INSERT INTO storage.buckets (id, name, public) VALUES ('tenant-logos', 'tenant-logos', true) ON CONFLICT (id) DO NOTHING;`
3. Storage RLS policies on `storage.objects` (idempotency-guarded per this project's standing migration discipline — wrap in `DO $$ ... IF NOT EXISTS ... $$` or use `DROP POLICY IF EXISTS` + `CREATE POLICY`):
   - Public SELECT: `bucket_id = 'tenant-logos'`
   - Admin-scoped INSERT and UPDATE: `bucket_id = 'tenant-logos' AND (storage.foldername(name))[1] = get_tenant_id()::text AND caller_is_admin()` — per Grounding Check item 1, confirm `storage.foldername()` behavior first.
   - No DELETE policy needed (upsert overwrites in place; consistent with this project's broader "no hard delete" discipline anyway).

### Step 2 — Backend: extend `src/features/tenant/service.ts`
- `getTenantSettings`: extend the `.select(...)` column list to include `logo_url, tagline`.
- `updateTenantSettings`: extend the `input` type to accept `tagline?: string | null`, validate length (propose max 150 chars — confirm with user), patch `tagline` alongside the existing `attendance_window_hours` handling.
- New function `uploadTenantLogo(tenantId: string, file: File): Promise<string>`: validates `file.type` (`image/png`/`image/jpeg` only) and `file.size` (≤ 2MB), uploads to the `tenant-logos` bucket at path `${tenantId}/logo` with `upsert: true` and the correct `contentType`, then updates `tenants.logo_url` to the resulting public URL plus a cache-busting `?v=${Date.now()}` suffix (Grounding Check item 8), returns the final URL. Accept that a failure between "file uploaded" and "DB updated" leaves an orphaned blob in Storage — low-consequence (storage waste only, no data-integrity or security risk), not worth a compensating-transaction pattern.

### Step 3 — Route restructuring (route groups)
Per Grounding Check item 4, verify Next.js 16.2.9 route-group behavior first, then:
- `git mv app/admin/formation app/admin/\(shell\)/formation`
- `git mv app/admin/invitations app/admin/\(shell\)/invitations`
- `git mv app/admin/restore app/admin/\(shell\)/restore`
- New `app/admin/(shell)/layout.tsx`: Server Component, resolves auth (same pattern as every existing Admin page — `createSupabaseServerClient()`, `getUser()`, redirect to `/login` if absent/wrong role), fetches `getTenantSettings(tenantId)`, renders `<AdminSidebar />` + `<CommunityBanner tenant={settings} />` + `{children}`.
- `app/admin/invite/` and `app/admin/mfa-enroll/` stay exactly where they are, untouched by the move.

### Step 4 — Sidebar and banner components
- `src/components/admin/AdminSidebar.tsx` — Client Component (`usePathname()` for active-route highlighting). Items: Formation (`/admin/formation`), Invitations (`/admin/invitations`), Community Information and Configuration (`/admin/community`), Record Restorations (`/admin/restore`) with Course/Modules/Talks always-visible as sub-items (`/admin/restore/courses`, `/admin/restore/modules`, `/admin/restore/talks`) — no expand/collapse needed for only three sub-items.
- `src/components/admin/CommunityBanner.tsx` — presentational, accepts `{ name, logoUrl, tagline }`. Name renders with `?? 'Community'` fallback per the established branding principle. Logo renders only if `logoUrl` is set (no FlockPulse-branded placeholder in its place — an empty/generic icon slot instead, per the branding principle applying equally to logo as to name). Tagline renders only if set.

### Step 5 — `/admin/community` page (minimal settings)
- `app/admin/(shell)/community/page.tsx` — Server Component, same auth pattern, fetches `getTenantSettings`, passes to Client Component.
- `app/admin/(shell)/community/CommunitySettingsForm.tsx` — Client Component: read-only display of community name (Grounding Check item 7), file input for logo with visible guidance text ("Square image, minimum 256×256px, PNG or JPG, max 2MB" — or whatever final copy is confirmed), image preview of current logo if set, tagline textarea (max 150 chars, confirm), Save button.
- `app/admin/(shell)/community/actions.ts` — Server Action(s) calling `uploadTenantLogo` and `updateTenantSettings`, same `getAdminContext` pattern as every other admin Server Action file in this repo.

### Step 6 — Remove now-redundant per-page chrome
- Remove the "← Formation" inline links from the three `/admin/restore/*` pages (redundant with the sidebar).
- Remove the Courses/Modules/Talks tab bar from the restore pages (redundant with the sidebar sub-items) — each restore page keeps its own content, just drops the now-duplicate in-page tab navigation.
- Remove the Invitations page's "Send invite" button repositioning is NOT needed — that's a page action, not a nav link, it stays exactly where it is.
- Remove any other page-level cross-links that duplicate what the sidebar now provides.

### Step 7 — Formation responsive fix
In `FormationBrowser.tsx`: change the fixed `grid grid-cols-3` to a responsive variant — stack to a single column below a chosen breakpoint (propose `lg`, i.e. `grid-cols-1 lg:grid-cols-3`), with each column given a bounded `max-height` and independent scroll when stacked (rather than each column trying to fill the full viewport height, which doesn't make sense stacked). Confirm the `@dnd-kit` `PointerSensor` continues to work acceptably for touch drag in the stacked/mobile layout during manual testing — Pointer Events generally unify mouse and touch, but this should be verified hands-on rather than assumed, since drag-and-drop touch interactions are a common rough edge.

### Step 8 — Regression check
Confirm every existing Admin route still resolves to its original URL after the route-group restructuring (`/admin/formation`, `/admin/invitations`, `/admin/restore`, `/admin/restore/courses`, `/admin/restore/modules`, `/admin/restore/talks`) — route groups shouldn't change any URL, but this must be verified with `npm run build`'s route listing output, not assumed. Confirm `/admin/invite` and `/admin/mfa-enroll` still work exactly as before (no shell, no regression).

---

## Files to Create/Modify

**Migration:**
- `supabase/migrations/[next-number]_community_banner_logo_tagline.sql` (new)

**Backend (modify):**
- `src/features/tenant/service.ts` (extend `getTenantSettings`/`updateTenantSettings`, add `uploadTenantLogo`)

**Frontend (new):**
- `app/admin/(shell)/layout.tsx`
- `src/components/admin/AdminSidebar.tsx`
- `src/components/admin/CommunityBanner.tsx`
- `app/admin/(shell)/community/page.tsx`
- `app/admin/(shell)/community/CommunitySettingsForm.tsx`
- `app/admin/(shell)/community/actions.ts`

**Frontend (moved, via `git mv` — preserve history):**
- `app/admin/formation/**` → `app/admin/(shell)/formation/**`
- `app/admin/invitations/**` → `app/admin/(shell)/invitations/**`
- `app/admin/restore/**` → `app/admin/(shell)/restore/**`

**Frontend (modify, in place after move):**
- `app/admin/(shell)/formation/FormationBrowser.tsx` (responsive grid)
- `app/admin/(shell)/restore/courses/page.tsx`, `modules/page.tsx`, `talks/page.tsx` (remove redundant header/tab chrome)

**Test plan:**
- `documentation/test-plans/FP-104-nav-shell-community-banner-checklist.md`

---

## Branch Name

`feature/FP-104-nav-shell-community-banner`

---

## Commit Message

`FP-104: Admin nav shell + top Community Banner (logo upload, tagline, Formation responsive fix)`

---

## Pull Request Description

Maps to FP-104's AC: shared Admin layout via Next.js route groups, sidebar with the four confirmed items (Community Info placeholder→real minimal page, Record Restorations with always-visible sub-items), `/admin/invite` and `/admin/mfa-enroll` deliberately excluded from the shell, top banner with name/logo/tagline (fallback "Community", conditional logo/tagline render, no color), `logo_url`/`tagline` schema additions, first-ever Storage bucket with service-role-enforced upload matching every other write pattern in this repo, Formation's three-column screen now responsive.

States explicitly how Grounding Check items 1 (`storage.foldername()` verification) and 4 (route-group behavior verification) were actually resolved, since both were flagged as unverified-against-real-environment at drafting time.

---

## Jira Linkage

- PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control)
- PDEStoryID: FP-104

---

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-FP-104.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.

**Before writing any code:** verify `storage.foldername()` behavior (Grounding Check item 1) and Next.js 16.2.9 route-group behavior (Grounding Check item 4) against the actual environment — report back to the user (via Atlas) if either doesn't behave as expected, rather than silently working around it.

**If any Jira ticket needs to be filed for a finding during this DIP, do not file it directly — report it back for Atlas to file.**

**Standing requirement:** since this DIP touches `.ts`/`.tsx` application code, `npm run build` must pass cleanly before pushing/opening the PR.

All changes go through a feature branch and a PR — no direct pushes to `dev`, no exceptions.

Create the feature branch, implement, test (minimum 11–15 automated tests covering: tenant isolation on the storage upload path, file-type/size rejection, tagline length validation, cache-busting URL changes on re-upload — plus manual verification of the route restructuring not breaking any URL, the sidebar's active-state highlighting, and drag-and-drop still working in the stacked mobile layout), run `npm run build` clean, commit, push, and open the PR against `dev`. Do not merge — the user will test locally and merge manually.

Include full diffs for every file in your completion report — not a summary.
