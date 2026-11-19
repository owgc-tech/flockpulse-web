DIP-FP-135-FP-137-adj-1
Story Summary
Post-merge visual polish on PR #78's shell chrome, based on Joseph's screenshot review. Two fixes: (1) AdminSidebar.tsx's new label-group children (Formation/Reports sub-items) are missing the indent wrapper Restore's children already have — a one-line omission, confirmed live — so "Member Progress"/"Courses"/etc. render at the same left edge as top-level items with no visual demotion; (2) UserAvatarMenu.tsx's corner avatar and popover get a full visual redesign per Joseph's spec: black/white avatar circles (both sizes), centered popover layout with name → role → groups → button → sign-out in that order.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check

Confirmed live: AdminSidebar.tsx's isLabelGroup branch wraps children in <div className="flex flex-col gap-0.5"> — no ml-3/indent, unlike isRestoreGroup's <div className="ml-3 mt-0.5 flex flex-col gap-0.5">. This is the exact bug in the screenshot. Fix: match Restore's wrapper exactly.
Joseph's instruction to "keep the main menus exactly as it was" is already true — confirmed the screenshot's top-level items (Community, Members, Groups, Events, Invitations, Record Restorations) render via the unchanged bottom branch of the nav.map, untouched by this fix. Only the label-group children wrapper changes.
Confirmed live: current corner avatar button is bg-zinc-100 text-zinc-500 / dark bg-zinc-800 text-zinc-400 — theme-token subdued colors, not explicit black/white. Joseph's ask is for literal black background + white initials, not theme-reactive — so this one spot intentionally does not use the app's zinc/dark-mode tokens, same as MfaVerifyForm's literal #fff spinner color is an intentional exception elsewhere in the codebase for a similar "always this color" reason.
Confirmed live: UserAvatarMenu's Props interface has no role field today — layout.tsx already has role in scope (fetched for AdminSidebar) but never threads it down to UserAvatarMenu. Needs adding to both.
Confirmed live: an exhaustive ROLE_LABELS: Record<MemberRole, string> already exists in app/admin/(shell)/members/MembersTable.tsx (all 7 current role values, including the FP-113 additions). InvitationsTable.tsx has a second, stale, non-exhaustive copy (ADMIN/LEADER/MEMBER only) — not touched by this DIP, but flagged here as a pre-existing gap worth a future tech-debt ticket, not fixed now (out of scope, different file, no relation to this popover work).
Rather than a third inline copy, extracting the exhaustive map to src/lib/auth/roleLabels.ts (keyed on the Role type from middleware.ts, which layout.tsx already imports and is value-identical to member.types.ts's MemberRole) and having both MembersTable.tsx and the new UserAvatarMenu.tsx import from there is the correct move — avoids a third divergent copy of the same data.
No conflict with Section 4 invariants — pure UI/styling.

Implementation Plan

src/components/admin/AdminSidebar.tsx — in the isLabelGroup render branch, change the children wrapper from <div className="flex flex-col gap-0.5"> to <div className="ml-3 mt-0.5 flex flex-col gap-0.5">, matching isRestoreGroup's wrapper exactly. No other change to this file.
src/lib/auth/roleLabels.ts (new) — export ROLE_LABELS: Record<Role, string>, moved verbatim from MembersTable.tsx's existing map (same 7 entries, same strings), keyed on Role from ./middleware.
app/admin/(shell)/members/MembersTable.tsx — replace its local ROLE_LABELS const with import { ROLE_LABELS } from '@/src/lib/auth/roleLabels'. No behavior change, pure dedup.
src/components/admin/UserAvatarMenu.tsx — rewrite:

Add role: Role to Props; import ROLE_LABELS and Role type.
Corner button: bg-black text-white hover:bg-zinc-800 (explicit, not theme-token-driven, per the grounding note above), same size/shape otherwise.
Popover panel, restructured top-to-bottom, all centered (flex flex-col items-center) for the top block:

Large avatar circle — same black-bg/white-initials treatment, sized at least 2x the corner avatar (e.g. h-24 w-24, vs. corner's h-11 w-11), centered.
Full name directly below, centered, font-semibold.
Role label (ROLE_LABELS[role]) directly below name, centered, smaller/muted text.
A spacing gap, then a left-aligned "Groups:" label followed by the group list left-aligned below it (unchanged content/logic from today, just repositioned and re-labeled with the explicit "Groups:" heading Joseph asked for).
Full-width black button reading "View/Edit Profile" (renamed from "View and Edit Profile"), linking to /admin/profile as today.
"Sign out" (lowercase o, per Joseph's exact wording) in small text, right-aligned at the bottom of the panel — not part of the centered block above.




app/admin/(shell)/layout.tsx — pass role={role} to <UserAvatarMenu> (the role variable is already in scope, just wasn't threaded through before).

Files to Create/Modify

src/components/admin/AdminSidebar.tsx (modify — one-line indent fix)
src/lib/auth/roleLabels.ts (new)
app/admin/(shell)/members/MembersTable.tsx (modify — dedup only)
src/components/admin/UserAvatarMenu.tsx (modify — visual rewrite)
app/admin/(shell)/layout.tsx (modify — thread role prop)

Migration Files
None.
Branch Name
feature/FP-135-137-adj-1-sidebar-avatar-polish
Commit Message
FP-135, FP-137: adj-1 — sidebar sub-item indent fix, avatar/popover redesign
Pull Request Description
Fixes the missing indent on Formation/Reports sub-items (main-level items confirmed untouched) and redesigns the avatar/popover per Joseph's spec: black/white avatar circles at both sizes, centered name → role → groups → "View/Edit Profile" button → bottom-right "Sign out", matching the layout described in review.
Jira Linkage

PDEEpicID: FP-5 / FP-36
PDEStoryID: FP-135, FP-137 (post-merge adjustment — both already Done, no status change needed)

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-135-FP-137-adj-1.md, no appended notes after. npm run build must pass cleanly. Open the PR against dev and stop — do not merge. Full diffs required in the completion report, including confirmation that the top-level (non-grouped) nav items' render branch is byte-identical to before this fix.
