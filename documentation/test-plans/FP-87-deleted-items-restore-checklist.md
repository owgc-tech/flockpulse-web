# Test Plan: FP-87 — Deleted Items Screen (View and Restore)

## Scope
Manual test plan for the three deleted-items routes (`/admin/restore/courses`, `/admin/restore/modules`, `/admin/restore/talks`). Run after the automated test script passes (`npx tsx scripts/test-fp87-deleted-items-restore.ts`).

---

## Prerequisites
- Local Supabase running with migration `20260707000024` applied.
- At least one tenant with a mix of active and deleted Courses, Modules, and Talks (use the Formation Admin screen at `/admin/formation` to create and delete records).
- Logged in as an Admin for that tenant.

---

## Checklist

### Navigation

- [ ] Visiting `/admin/restore` redirects to `/admin/restore/courses`
- [ ] Tab links switch between Courses / Modules / Talks pages without full reload
- [ ] Active tab is visually highlighted (dark background) on each page
- [ ] `← Formation` link returns to `/admin/formation`

---

### Courses tab (`/admin/restore/courses`)

- [ ] Lists all soft-deleted Courses for the tenant
- [ ] Active Courses do not appear in the list
- [ ] Each row shows: name, alias (if any), deleted-at date
- [ ] Empty state message shown when no deleted Courses exist
- [ ] **Restore button** — clicking restores the Course
  - [ ] Row disappears from the list immediately on success
  - [ ] Restored Course reappears in `/admin/formation` Courses column (at the bottom — end of list)
  - [ ] Restored Course's `sequence_order` is `max active + 1` (verify position in Formation browse)

---

### Modules tab (`/admin/restore/modules`)

- [ ] Lists all soft-deleted Modules for the tenant, across all Courses (tenant-wide, not per-course)
- [ ] Each row shows: module name, alias (if any), parent Course name, deleted-at date
- [ ] Active Modules do not appear in the list
- [ ] Empty state message shown when no deleted Modules exist

**Parent Course is active:**
- [ ] Restore button is enabled
- [ ] Clicking Restore removes the row and restores the Module
- [ ] Restored Module reappears at the bottom of its Course column in `/admin/formation`

**Parent Course is also deleted:**
- [ ] Restore button is visually disabled (greyed out, cursor-not-allowed)
- [ ] Parent Course name shown with strikethrough and `(deleted)` badge
- [ ] Hovering the disabled button shows tooltip: `Restore course "<name>" first`
- [ ] Clicking the disabled button does nothing (no error, no network call)

---

### Talks tab (`/admin/restore/talks`)

- [ ] Lists all soft-deleted Talks for the tenant, across all Modules (tenant-wide)
- [ ] Each row shows: talk name, alias (if any), parent Module name, audience abbreviation (SM/SW/MM/MW), deleted-at date
- [ ] Active Talks do not appear in the list
- [ ] Empty state message shown when no deleted Talks exist

**Parent Module is active:**
- [ ] Restore button is enabled
- [ ] Clicking Restore removes the row and restores the Talk
- [ ] Restored Talk reappears at the bottom of its Module column in `/admin/formation`

**Parent Module is also deleted:**
- [ ] Restore button is visually disabled
- [ ] Parent Module name shown with strikethrough and `(deleted)` badge
- [ ] Hovering the disabled button shows tooltip: `Restore module "<name>" first`

---

### Regression

- [ ] Formation browse screen (`/admin/formation`) still shows zero deleted items in all three columns after restores
- [ ] Restoring a Course or Module with active children works (guard triggers only fire on soft-delete, not restore)
- [ ] Restored items appear at the correct position (end of column) and are reorderable via drag-and-drop in `/admin/formation`
- [ ] Other admin routes (`/admin/invitations`, `/admin/invite`, `/admin/formation`) are unaffected
