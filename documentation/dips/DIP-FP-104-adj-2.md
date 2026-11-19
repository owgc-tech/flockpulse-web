**Instruction for CC — Shell height containment + banner sticky/resize + column header freeze + horizontal scrollbar fix (same branch, no new DIP, no migration)**

**Root cause to fix first — everything else likely follows from this:**

`app/admin/(shell)/layout.tsx`'s outer wrapper uses `min-h-screen`, which lets the whole document grow taller than the viewport and scroll as one unit. This is why the banner scrolls away, and is the likely cause of the Formation column headers not staying frozen and a stray horizontal scrollbar appearing mid-column. Change the outer `<div className="flex min-h-screen flex-col">` to `<div className="flex h-screen flex-col overflow-hidden">`, so only `main` (already `overflow-y-auto`) scrolls, and everything above/around it — banner, sidebar, individual column headers — stays structurally outside that scroll region rather than needing to fight it with CSS.

**1. Banner — sticky + resize** (`src/components/admin/CommunityBanner.tsx`):
- Outer container: add `sticky top-0 z-20` as backup insurance on top of the layout fix above. Keep solid background (`bg-white dark:bg-zinc-950`) — required for sticky to look right. Set explicit height `h-24` (96px).
- Logo `<img>`: `h-9 w-9` → `h-20 w-20` (80px, nearly fills the 96px banner).
- No-logo placeholder box: same `h-20 w-20`, bump the initial-letter text to `text-3xl`.
- Community name: `text-sm` → `text-[21px]` (1.5× via arbitrary value).
- Tagline: `text-xs` → `text-lg` (exactly 1.5×, maps cleanly to a standard step).

**2. Formation columns — investigate and fix the horizontal scrollbar** (`app/admin/(shell)/formation/FormationBrowser.tsx`, `Column` component):
- Report back what's actually causing horizontal overflow before assuming a fix — check whether it's the outer document (should be resolved by the layout fix above) or something local to the column (e.g. `@dnd-kit`'s drag transform temporarily pushing an element wider than its container).
- Regardless of root cause, add `overflow-x-hidden` to the column's scrollable row-list container (the `flex-1 overflow-y-auto p-2` div) as a safety net — none of these columns should ever need horizontal scroll, their content is simple stacked rows.

**3. Formation columns — freeze the header, confirm independent per-column vertical scroll:**
- The column header (`COURSES` / `MODULES` / `TALKS` label + `+` button) is already structurally a sibling *outside* the scrollable row-list div, so it shouldn't scroll with the list once the root document-scroll issue above is fixed. Add `sticky top-0 z-10` to the header div anyway as the same backup-insurance pattern used for the banner — don't rely solely on the layout fix.
- Confirm each column's vertical scrollbar is genuinely independent (scrolling one column's list doesn't move the others) and appears on the right edge of that column, not the page. This should already be true structurally (`overflow-y-auto` is scoped per-column, not global) — verify visually rather than assume, and report back if it isn't behaving that way.

**Process:**
- Branch off current `dev`: `feature/FP-104-shell-scroll-fixes`
- UI-only, no new automated tests needed, but re-run `npx tsx scripts/test-fp104-nav-shell-community-banner.ts` to confirm nothing broke (expect 17/17 unchanged)
- Run `npm run build` clean
- Open PR against `dev`, don't merge — no migration needed for this one, same deployed-environment testing flow as always
