DIP-FP-135-FP-137-web
Story Summary
Combines two admin-shell chrome changes that both render inside app/admin/(shell)/layout.tsx: FP-135 adds a clickable avatar to the shell header, opening a popover profile card (name, groups, "View and Edit Profile") and housing web's first-ever sign-out control; FP-137 regroups the sidebar into sectioned headers (Formation, Reports) and splits the combined Reports page into two standalone routes, matching the existing Record-Restorations sub-nav pattern. Both are visual/structural passes over the one screen every admin/leader sees on every page load — genuinely shared scope, not just two unrelated stories bolted together.
Not covered — deliberately excluded: FP-136 (login page logo) and FP-138 (mobile login logo) are single-file, unrelated to shell chrome, and go in their own DIPs.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check

Confirmed live: app/admin/(shell)/layout.tsx renders CommunityBanner (a plain server component, no interactivity, no 'use client') then AdminSidebar + main. FP-135's avatar needs client-side popover state, so it's a new client component (UserAvatarMenu.tsx) rendered alongside CommunityBanner inside the banner row — CommunityBanner.tsx itself is not modified beyond its container becoming justify-between (or the new component being placed as a sibling), keeping the untouched-server-component boundary clean.
Confirmed live: GET /api/members/me and PATCH /api/members/me already exist (FP-112), including group memberships in the read response (getMyProfile joins assignments → groups). No new backend endpoint needed for the profile card's data or for the edit page — this DIP is pure UI wiring against existing, working endpoints.
Confirmed live: no web profile-edit page exists at all (app/admin/profile or similar — searched, nothing found). "View and Edit Profile" needs a new page built against the existing PATCH /api/members/me.
Confirmed live: no sign-out UI exists anywhere in the web shell (searched app/, src/ for signOut/sign-out — only hits are auth-flow-internal, e.g. app/login/actions.ts's loginAction calling supabase.auth.signOut() to clear a stale session before re-login, not a reusable exported action). A new signOutAction server action is required.
Confirmed live: existing overlay dismiss convention (FormationOverlay.tsx) uses Escape-key listener + click-on-backdrop-only dismiss (e.target === e.currentTarget). The new avatar popover reuses this same dismiss pattern, scaled down from a full-screen modal to a small anchored panel.
Confirmed live: AdminSidebar.tsx's NAV is a flat array; the one existing grouped item (Record Restorations) has an href on the parent that redirects to its first child (app/admin/(shell)/restore/page.tsx → redirect('/admin/restore/courses')), and its children carry no independent adminOnly — they're gated wholesale via the parent's single adminOnly: true.
Real gating gap found, must be designed around, not copied blindly: unlike Restore, the new Formation and Reports groups have mixed-gating children — /admin/formation-progress (adminOnly: false) and /admin/formation (adminOnly: true) today are independently gated top-level items; same for /admin/reports/* (adminOnly: false) vs. /admin/audit-logs (adminOnly: true). Nesting them under one group with a single parent-level adminOnly flag (the Restore pattern) would either wrongly hide "Member Progress" from Leader-tier or wrongly expose "Courses"/"Audit Logs" to Leader-tier. AdminSidebar.tsx's filtering logic must be extended to filter children independently by their own adminOnly, not just the group. This is a structural fix, called out explicitly per Section 4's "flag rather than silently comply" — Restore's existing pattern does not generalize here as-is.
Design choice, stated explicitly rather than left implicit: the new "Formation" and "Reports" group headers are non-navigational labels (plain text, no href, no redirect route), unlike Restore's clickable-parent-redirects-to-first-child pattern — inventing a new redirect route for groups whose children already have stable, independent, differently-gated routes would add indirection with no benefit. Flagging this as a deliberate deviation from the one existing precedent, not an oversight.
Confirmed live: RsvpReportBrowser and AttendanceReportBrowser already take an identical props shape (events, groups, members, token) and are already independent components — splitting app/admin/(shell)/reports/page.tsx into two standalone pages is a mechanical duplication of the existing data-fetch, not new logic. AuditLogsPage (app/admin/(shell)/audit-logs/page.tsx) is the exact pattern to mirror for both new report pages' structure (title/subtitle header + gated redirect + content).
No conflict with Section 4 invariants — this is admin-shell UI/nav structure and self-profile editing (already-existing, already-gated endpoints), not attendance/RSVP/formation lifecycle logic.

Implementation Plan
FP-135 — Avatar, profile card, sign-out:

app/admin/(shell)/layout.tsx — fetch getMyProfile(memberId, tenantId) alongside the existing getTenantSettings call (same non-fatal try/catch convention — profile fetch failure shouldn't break the whole shell). Pass the result to a new UserAvatarMenu client component, rendered as a sibling to CommunityBanner inside the banner row (adjust the banner row to justify-between so the avatar sits at the far right).
src/components/admin/UserAvatarMenu.tsx (new, client component) — circular initials avatar (mirror CommunityBanner's existing initials-fallback styling: rounded-full, bg-zinc-100/dark:bg-zinc-800, centered initial(s)). Click toggles a popover panel anchored below-right, showing: full name, list of group names (or "No groups" if empty), a "View and Edit Profile" link to /admin/profile, and a "Sign Out" button. Dismiss via Escape key + click-outside, mirroring FormationOverlay.tsx's convention.
app/admin/(shell)/actions.ts (new, or add to an existing shared shell actions file if one exists — check live) — signOutAction(): calls supabase.auth.signOut() server-side, then redirect('/login').
app/admin/profile/page.tsx (new) — server component: fetch getMyProfile for the current user, render a client form.
app/admin/profile/ProfileForm.tsx (new, client component) — first name, last name, gender, marital status, birthdate fields, submitting via a new server action calling the existing updateMyProfile service function (reuse directly, same convention as CommunitySettingsForm's actions). Reuse existing validation error shapes (INVALID_VALUE) already implemented in updateMyProfile.

FP-137 — Sidebar regroup + report split:
6. app/admin/(shell)/reports/rsvp/page.tsx (new) — mirrors AuditLogsPage's structure: same data fetch as today's combined reports/page.tsx (listMembers/listGroups/listEvents), renders only RsvpReportBrowser, gated isLeaderTierOrAbove (unchanged gating from today).
7. app/admin/(shell)/reports/attendance/page.tsx (new) — same pattern, renders only AttendanceReportBrowser.
8. app/admin/(shell)/reports/page.tsx — replace combined content with redirect('/admin/reports/rsvp'), matching the restore/page.tsx convention for a since-split parent route. (Old bookmarks/links to /admin/reports keep working.)
9. src/components/admin/AdminSidebar.tsx:

Reorder NAV: Community first, then Members, Groups, Events, Invitations, then the new Formation group, then the new Reports group, then Record Restorations — exact order as specified.
Formation group (no href, label-only heading): children { href: '/admin/formation-progress', label: 'Member Progress', adminOnly: false }, { href: '/admin/formation', label: 'Courses', adminOnly: true }.
Reports group (no href, label-only heading): children { href: '/admin/reports/rsvp', label: 'RSVP Report', adminOnly: false }, { href: '/admin/reports/attendance', label: 'Attendance Report', adminOnly: false }, { href: '/admin/audit-logs', label: 'Audit Logs', adminOnly: true }.
Filtering fix: change the render/filter logic so each child is independently checked against isAdminTier(role) via its own adminOnly, and a group with zero visible children after filtering is not rendered at all (defensive — doesn't occur with today's data, but correctness matters here per the flagged gap above).
Active-state highlighting (isActive) extended to cover the new group children the same way Restore's children already work today.

Files to Create/Modify

app/admin/(shell)/layout.tsx (modify)
src/components/admin/UserAvatarMenu.tsx (new)
app/admin/(shell)/actions.ts (new or extended — verify live whether a shared shell actions file already exists before creating a new one)
app/admin/profile/page.tsx (new)
app/admin/profile/ProfileForm.tsx (new)
app/admin/profile/actions.ts (new)
app/admin/(shell)/reports/rsvp/page.tsx (new)
app/admin/(shell)/reports/attendance/page.tsx (new)
app/admin/(shell)/reports/page.tsx (modify — becomes a redirect)
src/components/admin/AdminSidebar.tsx (modify)

Migration Files
None — this DIP uses only already-existing endpoints and tables (GET/PATCH /api/members/me, both from FP-112).
Branch Name
feature/FP-135-137-admin-shell-avatar-nav-reorg
Commit Message
FP-135, FP-137: avatar profile card + sign-out, admin sidebar regroup, report page split
Pull Request Description
Maps to FP-135's AC (avatar → popover with name/groups/edit-profile link/sign-out, first sign-out UI in web) and FP-137's AC (grouped Formation/Reports sections in Joseph's exact specified order, Member Progress/Courses relabeling, RSVP Report and Attendance Report as fully independent pages, Audit Logs moved under Reports, per-item role gating preserved through the regroup).
Jira Linkage

PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control) / FP-36 (EPIC-9 — Reporting & Metrics)
PDEStoryID: FP-135, FP-137

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-135-FP-137-web.md, no appended notes after. npm run build must pass cleanly before pushing (this DIP touches .tsx/.ts application code). Open the PR against dev and stop — do not merge; testing happens only after Joseph merges, against the deployed dev environment. Full diffs required in the completion report, including confirmation that CommunityBanner.tsx itself was not modified beyond what's explicitly scoped (if touched at all) and that RsvpReportBrowser.tsx/AttendanceReportBrowser.tsx (the two existing report components) show zero diff — only their container pages changed.
