### DIP — FP-252 (Web): replace window.location navigation in the admin tables with Next.js router navigation (clears 3 lint warnings)

### Not covered — deliberately excluded
- **Other lint warnings.** The 14 warnings that existed before FP-241 are out of scope; this DIP removes only the 3 added by the new rule.
- **TypeScript 7 and ESLint 10.** Those are FP-251, after launch.
- **Mobile.** Not affected.
- **Any visual or behavior change.** Clicking must open exactly the same page as today.

### Story Summary
The FP-241 upgrade to `eslint-config-next` 16.4.6 (PR #232) added the rule `no-location-assign-relative-destination`. It flags code that navigates by setting `window.location.href` to a relative address. Three admin list tables do this: Events, Groups and Members.

That works today, but it forces a full page reload, which is slower and drops client state. Next.js wants in-app navigation to go through its router instead. This story swaps those three assignments for router navigation, keeps behavior identical, and brings lint back to 14 warnings or fewer.

### Repo Target
Web (`owgc-tech/flockpulse-web`). There is no mobile dependency and no migration.

### Grounding Check
**Atlas could not read the repository this session (no GitHub access).** The facts below come from Claude Code's FP-241 report (PR #232, 2026-11-17). Re-verify each one before changing anything:
- The rule `no-location-assign-relative-destination` is triggered once in each of `EventsTable.tsx`, `GroupsTable.tsx` and `MembersTable.tsx`, all on `window.location.href`. The exact paths are not confirmed: locate the files with a search. Do not assume a path.
- Lint on `dev` after #232 and #233: 0 errors, 17 warnings. Re-measure on current `dev`, which has moved to `d09c631` (#233).

To verify for each of the three spots, and report before changing:
- what triggers the navigation: a row click, a button, a keyboard handler, or something else;
- the destination expression, and whether it is always a relative in-app path;
- whether the component is already a client component (`"use client"`) and already imports `useRouter`;
- any extra behavior around it, such as `stopPropagation`, checkbox or menu clicks inside the row that must NOT navigate, or middle-click and ctrl-click handling.

Invariant rules: not touched. No data access, access control, error codes or API envelope changes.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-252-web.md`. Then create the branch `feature/FP-252-lint-location-assign` off current `dev`.
2. **Baseline.** On unchanged `dev`, run each of these and record the summaries:
   - `npx tsc --noEmit`;
   - `npm run lint`: record the total, and the exact 3 warnings with file and line;
   - `npm run build`.
3. **Read and report** each of the three spots, per the Grounding Check, before editing.
4. **Change**, in each file:
   - use `useRouter` from `next/navigation` (not `next/router`) and replace `window.location.href = X` with `router.push(X)`, with the same destination expression;
   - if the component is not a client component and cannot use the hook, stop and report; do not restructure the component;
   - keep every other line as it is: click handlers, keyboard handlers, `stopPropagation`, styles, accessibility attributes;
   - do not convert rows to `<Link>`. That would change the markup. Mention it in the PR only if you think it is clearly better.
5. **Verify.**
   - `npx tsc --noEmit` is clean.
   - `npm run lint` shows 0 errors and 14 warnings or fewer, and none from `no-location-assign-relative-destination`.
   - `npm run build` passes.
   - Run `npm run dev`. For each of Events, Groups and Members: the list loads, and clicking a row opens the same detail page as on `dev`. Any in-row controls (checkboxes, menus, buttons) still do NOT navigate. If MFA blocks the admin login, say so and list these as not tested; Joseph tests them.
6. **Ship.** Commit, push, and run `gh pr create --base dev`.

### Files to Create/Modify
- Create: `documentation/dips/DIP-FP-252-web.md` (verbatim, then frozen).
- Modify: the three table components (`EventsTable.tsx`, `GroupsTable.tsx`, `MembersTable.tsx`), at their real paths.
- Must stay untouched: everything else. Show `git diff dev feature/FP-252-lint-location-assign --stat` listing only the DIP file and the three components. If anything else needs to change, stop and report first.

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-252-lint-location-assign

### Commit Message
FP-252: use router navigation instead of window.location in admin tables

### Pull Request Description
Plain GitHub markdown. Include:
- **For each of the three spots:** what triggered navigation, the old line, the new line, and confirmation that the destination is unchanged.
- **Lint before and after:** the total, plus the 3 warnings removed. tsc and build results.
- **Manual checks you ran,** and anything you could not run (admin pages behind MFA).
- **Deviations from this DIP,** with reasons.
- **Not tested:** real browsers other than your own, mobile browsers, the hosted database.
- **Steps for Joseph** after merging and Vercel Ready, logged in as Admin:
  1. Events list: click a row. It should open that event. Use the browser Back button: you should return to the list.
  2. Groups list: same check.
  3. Members list: same check.
  4. Click any checkbox, menu or button inside a row. It should do its own job and NOT open the detail page.
  5. Nothing else should look different. Navigation may feel slightly faster (no full reload).

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-252

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-252-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
