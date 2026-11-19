**Instruction for CC — URGENT: fix broken `dev` build**

`dev` is currently failing to deploy on Vercel after PR #35 was merged. Full error:

```
./app/admin/formation/FormationBrowser.tsx:422:14
Type error: Type '{ ... hasChildren: boolean | undefined; ... }' is not assignable to type 'IntrinsicAttributes & Props'.
  Types of property 'hasChildren' are incompatible.
    Type 'boolean | undefined' is not assignable to type 'undefined'.
      Type 'false' is not assignable to type 'undefined'.
```

**Root cause:** in `FormationOverlay.tsx`, `CourseOverlayProps` declares `hasChildren?: never`, but Courses genuinely need `hasChildren` (FP-85's guard applies to Courses too, gated by active Modules) — this was a typing mistake from the original draft, not something introduced by the recent `hasChildren` fix.

**Fix:**
1. Branch directly off current `dev` (not off the now-merged feature branch): `git checkout dev && git pull && git checkout -b hotfix/FP-76-86-course-haschildren-type`
2. In `FormationOverlay.tsx`, change `CourseOverlayProps.hasChildren` from `hasChildren?: never` to `hasChildren?: boolean`, matching `ModuleOverlayProps`.
3. **Run `npm run build` locally and confirm it completes with no type errors before pushing anything.** This is now a required step for this DIP, not optional — the `tsx` test script does not exercise Next.js's type checker and cannot be relied on alone for `.tsx` changes.
4. Also re-run the existing test script (`npx tsx scripts/test-fp76-82-83-84-85-86-formation-admin.ts`) to confirm no regression — expect 19/19.
5. Commit, push, open a PR titled clearly as a hotfix against `dev` (e.g. `fix(fp76-86): correct hasChildren type for CourseOverlayProps — unblocks dev deploy`). Given `dev` is currently broken, this should be prioritized for quick review/merge over normal DIP-branch pacing — but still through a PR, not a direct push.

Report back with the `npm run build` output showing a clean pass before I sign off.
