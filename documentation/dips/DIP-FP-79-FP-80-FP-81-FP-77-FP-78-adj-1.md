**Instruction for CC — Course name/description missing from Formation Progress screen**

**Root cause:** `CourseProgress` interface in `formation-completion.service.ts` only has `course_id` — no name or description was ever added, unlike `ModuleProgress`/`TalkProgress` which do have `module_name`/`talk_name`. The UI's `CourseRow` component in `FormationProgressBrowser.tsx` compensates by hardcoding the literal string `"Course"` and rendering `course.course_id.slice(0, 8)` in the parentheses — that's the bug on screen.

**Fix:**

1. **`src/features/formation/formation-completion.service.ts`:**
   - Add `course_name: string` and `course_description: string | null` to the `CourseProgress` interface.
   - Inside `computeCourseProgress`, fetch the course row itself (use the existing `getCourseById(courseId, tenantId)` from `course.service.ts` — already returns `name`/`description`) and populate both new fields on the returned object.
   - Do this fetch unconditionally inside `computeCourseProgress` itself (not only in `computeAllCoursesProgress`), so the standalone `?course_id=` path in `/api/formation/progress` gets the name/description too, not just the "all courses" path.

2. **`app/admin/(shell)/formation-progress/FormationProgressBrowser.tsx`, `CourseRow` component:**
   - Replace the hardcoded `"Course"` label with `course.course_name`.
   - Replace `({course.course_id.slice(0, 8)}...)` with `({course.course_description})` — but **only render the parentheses at all if `course_description` is non-null/non-empty**. Don't show empty `()` when a course has no description.

**Process:**
- Branch off current `dev`: `feature/FP-78-course-name-description-fix`
- Re-run `npx tsx scripts/test-fp79-fp80-fp81-fp77-fp78-formation-completion.ts` — expect 17/17 unchanged (this is a display-layer addition, not a computation change)
- Run `npm run build` clean
- Open PR against `dev`, don't merge — same flow as always, no migration needed
