# FP-104 Admin Nav Shell + Community Banner — Test Checklist

## Automated tests (run: `npx tsx scripts/test-fp104-nav-shell-community-banner.ts`)

| # | Test | Expected |
|---|------|----------|
| 1.1 | updateTenantSettings sets tagline | tagline persisted in DB |
| 1.2 | updateTenantSettings clears tagline (null) | tagline becomes null |
| 1.3 | Tagline > 150 chars rejected | VALIDATION_ERROR |
| 1.4 | Tagline exactly 150 chars accepted | saved successfully |
| 1.5 | Tagline update doesn't bleed to other tenant | other tenant tagline remains null |
| 2.1 | Non-image MIME type rejected | VALIDATION_ERROR |
| 2.2 | Oversized file (> 2 MB) rejected | VALIDATION_ERROR |
| 2.3 | SVG MIME type rejected | VALIDATION_ERROR |
| 2.4 | Valid PNG accepted, logo_url updated in DB | URL stored |
| 2.5 | Re-upload produces new cache-busting URL | ?v= timestamp differs |
| 2.6 | Upload for tenant A doesn't touch tenant B logo_url | B unchanged |
| 3.1 | getTenantSettings returns all expected fields | id, name, logo_url, tagline, attendance_window_hours |
| 3.2 | Fresh tenant has null logo_url and tagline | both null |

## Manual verification

### Route restructuring (no URL breakage)
- [ ] `/admin/formation` loads Formation browser (three-column DnD)
- [ ] `/admin/invitations` loads Invitations table
- [ ] `/admin/restore/courses` loads Deleted Courses table
- [ ] `/admin/restore/modules` loads Deleted Modules table
- [ ] `/admin/restore/talks` loads Deleted Talks table
- [ ] `/admin/community` loads Community Settings page
- [ ] None of the above routes show a 404 or redirect loop

### Community banner
- [ ] Banner appears at top of all `/admin/*` pages
- [ ] Banner shows community name (falls back to "Community" if null)
- [ ] Banner shows logo when logo_url is set; shows initial-letter placeholder when not
- [ ] Banner shows tagline only when tagline is set
- [ ] Banner is not present on `/login` or other non-admin pages

### Admin sidebar
- [ ] Sidebar appears on all `/admin/*` pages
- [ ] Formation link is active-highlighted when on `/admin/formation`
- [ ] Invitations link is active-highlighted when on `/admin/invitations`
- [ ] Community link is active-highlighted when on `/admin/community`
- [ ] Record Restorations sub-items (Courses / Modules / Talks) always visible
- [ ] Each sub-item is active-highlighted when on its respective route

### Community Settings page (`/admin/community`)
- [ ] Community Name is displayed read-only (no edit field)
- [ ] Logo upload: selecting a PNG/JPEG shows local preview before upload
- [ ] Logo upload: clicking "Upload logo" with no file shows no-file error
- [ ] Logo upload: uploading valid PNG updates preview to served URL
- [ ] Logo upload: re-uploading replaces logo in banner (refresh to confirm cache-bust)
- [ ] Tagline: typing in textarea shows character count (e.g. "12/150")
- [ ] Tagline: saving a tagline shows "Tagline saved." success message
- [ ] Tagline: clearing and saving replaces tagline in banner on reload

### Mobile / responsive
- [ ] Formation browser stacks to single column on narrow viewport (< lg breakpoint)
- [ ] Sidebar collapses gracefully on mobile (or is scrollable)
- [ ] DnD drag handles still reachable in stacked mobile layout

### Auth guard
- [ ] Visiting `/admin/community` while unauthenticated redirects to `/login`
- [ ] Non-admin user (MEMBER role) redirected to `/login`
