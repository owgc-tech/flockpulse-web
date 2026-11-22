### DIP — FP-213 (Web): neutral wording: "Formation" → "Training", "Talk" → "Session" (labels and admin URLs)

### Not covered — deliberately excluded
- **The mobile app.** It has its own DIP, `DIP-FP-213-mobile`, which is independent and can run in parallel. Note: the mobile "what changed" banner gets its labels from this server, so the `talk_id` label change here reaches the phone automatically.
- **The database:** tables `courses`, `modules`, `talks`, `talk_completions`, all columns (`talk_id` and so on), functions and migrations. Decided 2026-11-19 (Joseph): no schema rename before the production data copy (FP-209).
- **API paths:** `/api/talks`, `/api/courses`, `/api/modules`, `/api/formation/progress`. The mobile app calls them.
- **Code identifiers, file and component names, and comments:** `FormationBrowser`, `talk.service.ts`, `src/features/formation/` and so on.
- **The event type code `FORMATION`,** and any tenant's event type *named* "Formation". Event type names are tenant data that an Admin can rename on the Event Types page.
- **`CORE_TASK_NAMES`** in `EventForm.tsx`. This is a separate decision, left as is.
- **Historical documents:** `documentation/dips/*` and `documentation/test-plans/*`.

### Story Summary
FlockPulse serves any kind of organization. "Formation" and "Talk" read as faith-specific. This DIP changes every **user-visible** occurrence in the web app:
- "Formation" becomes **"Training"**;
- "Talk(s)" becomes **"Session(s)"**;
- the three admin URLs that contain the old words are renamed, and the old URLs redirect to the new ones.

Data, APIs and code names stay the same. Decided 2026-11-19 (Joseph): scope is labels plus web URLs; the words are Training and Session.

### Repo Target
Web (`owgc-tech/flockpulse-web`). No dependency on mobile, and no migration.

### Grounding Check
**Verified by Atlas this session** (read from `origin/dev` at `f363cc1`). These are the known user-visible strings; this list is not exhaustive (see step 2):
- `src/components/admin/AdminSidebar.tsx`:
  - line 63, group label `'Formation'`, whose children are `/admin/formation-progress` "Member Progress" and `/admin/formation` "Courses";
  - line 84, `{ href: '/admin/restore/talks', label: 'Talks' }`.
- `app/admin/(shell)/formation/page.tsx:24`: h1 `Formation`.
- `app/admin/(shell)/formation-progress/page.tsx:34`: h1 `Formation Progress`.
- `app/admin/(shell)/formation/FormationBrowser.tsx:407`: `title="Talks"`.
- `app/admin/(shell)/formation/FormationOverlay.tsx:51`: `ENTITY_LABELS.talk = 'Talk'`.
- `app/admin/(shell)/events/EventForm.tsx:583`: "Formation talk"; line 594: option "Talk…".
  - The block is shown when `selectedEventType?.code === 'FORMATION'` (line 169). Keep that logic.
- `app/admin/(shell)/restore/talks/page.tsx:24`: "Deleted Talks".
- `src/features/events/modifiedFields.ts`:
  - `COLUMN_LABELS.talk_id = 'Talk'` (line 59);
  - `'Talk'` inside `LABEL_ORDER` (line 71).

  These labels are computed when read (not stored), and they are sent to the mobile app in `modified_fields`.
- `src/features/formation/talk.service.ts`: error messages "Talk not found" (lines 47, 62, 81, 133, 148) and "Talk is not deleted" (line 134). Error **codes** stay; only the message text changes.
- **Two example placeholders** found by Atlas's wider scan for faith-specific words (added to this DIP on 2026-11-19):
  - `app/admin/(shell)/event-types/EventTypesTable.tsx:139`: `placeholder="e.g. Bible Study"` → `placeholder="e.g. Bible Study, Workshop"`. Keep the existing example and add a neutral one.
  - `app/register/founder/complete/FounderCompleteForm.tsx:197`: `placeholder="e.g. Grace Community Church"` → `placeholder="e.g. Grace Community Church, Riverside Community Association"`. Keep the existing example and add a neutral one (Joseph, 2026-11-19).
- **Out of scope here, tracked separately (FP-262 for roles, FP-261 for tasks):**
  - the default "Pastoral Leader" role, seeded for every new community by the `create_role_catalog_for_new_tenant()` trigger;
  - `CORE_TASK_NAMES` ("Prayer Leader", "Food Assignment", "Music") on web and mobile.

  Both need a product decision. Do not change them in this DIP.
- **Routes:** `app/admin/(shell)/formation/`, `app/admin/(shell)/formation-progress/` and `app/admin/(shell)/restore/talks/` exist.

**Not verified. Check first and report:**
1. Every other user-visible string containing Formation, formation, Talk, Talks, talk or talks in `app/` and `src/`:
   - JSX text, `placeholder`, `aria-label`, `title`, `alt`, `metadata` titles;
   - confirm dialogs, empty states, success and error messages, CSV or export headers.
2. Every `href`, `router.push`, `redirect(`, `revalidatePath(` and `Link` that points at the three old routes.
3. The current contents of `next.config.*`. Is there an existing `redirects()`?
4. Which existing `scripts/test-*.ts` assert the `'Talk'` label. `test-fp222-adj1-what-changed.ts` likely does.

**Rules check:**
- No change to data, access rules, API contracts or error codes.
- The mobile app tolerates the label change, because labels are display strings.
- The coming-soon gate in `proxy.ts` is unaffected. Do not touch `proxy.ts`.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-213-web.md`. Create `feature/FP-213-neutral-wording` off current `dev`. Report the four unverified items before editing.
2. **Labels.** Change every user-visible occurrence found in grounding item 1, using these rules:
   - "Formation" → "Training";
   - "Formation Progress" → "Training Progress";
   - "Formation talk" → "Training session";
   - "Talk" → "Session", "Talks" → "Sessions", "Talk…" → "Session…", "Deleted Talks" → "Deleted Sessions";
   - lower-case and possessive forms follow the same rule.

   Keep "Course(s)", "Module(s)" and "Member Progress" as they are. Do not change identifiers, keys, comments, SQL or API paths. In `modifiedFields.ts`, change both the `talk_id` label and the `LABEL_ORDER` entry to `'Session'`.
3. **Route folders (moves only, contents unchanged except links):**
   - `app/admin/(shell)/formation/` → `app/admin/(shell)/training/`
   - `app/admin/(shell)/formation-progress/` → `app/admin/(shell)/training-progress/`
   - `app/admin/(shell)/restore/talks/` → `app/admin/(shell)/restore/sessions/`

   Use `git mv` so history follows. Update every link, `revalidatePath` and `redirect` found in grounding item 2, including the sidebar hrefs.
4. **Redirects from the old URLs:** add `redirects()` to `next.config.*`, or extend the existing one.
   - `/admin/formation` → `/admin/training`
   - `/admin/formation/:path*` → `/admin/training/:path*`
   - `/admin/formation-progress` → `/admin/training-progress`
   - `/admin/formation-progress/:path*` → `/admin/training-progress/:path*`
   - `/admin/restore/talks` → `/admin/restore/sessions`

   Use `permanent: false`, which gives a 307. Change nothing else in the config. If the config has something unusual, STOP and report.
5. **Tests.** Update the expectations of any existing test script that asserts `'Talk'` as a label to `'Session'`. Change nothing else in those scripts. Add `scripts/test-fp213-wording.ts` (force-added) that:
   - imports `LABEL_ORDER` and checks that it contains `'Session'` and not `'Talk'`;
   - scans `app/` and `src/` and fails if any **user-visible string literal or JSX text** still contains `\bFormation\b` or `\bTalks?\b`. Skip import lines, comments and the `FORMATION` event type code, and keep an explicit allowlist with a reason for each entry.

   Print what it found.

   **Report-only (does not fail):** also list every user-visible string in `app/` and `src/` containing any of these words: Pastoral, Prayer, Church, Bible, Scripture, Worship, Ministry, Fellowship, Parish, Congregation, Sermon, Pastor, Faith, God, Spirit, Shepherd, Retreat, Gospel, Holy, Devotion, Praise. Expected hits are the `roleLabels.ts` "Pastoral Leader" label, `CORE_TASK_NAMES`, and the kept "Bible Study" and "Church" placeholder examples. Paste the full list in the PR so Atlas can confirm nothing else is left.
6. **Checks.**
   - Run `npx tsc --noEmit`, lint, `npm run build`, the new script, and every test script you changed.
   - Run locally with `npm run dev`:
     - `curl -I` on each of the 5 old paths returns 307 with the right `Location`;
     - signed in as an Admin in the browser, the sidebar shows "Training" → "Member Progress", "Courses", and Record Restorations → "Sessions";
     - each renamed page loads;
     - the event form for a FORMATION-type event shows "Training session" with "Session…".

     Report what you could and couldn't check (MFA may block the browser checks; if so, say so).
   - `git diff dev --stat`, plus `git diff dev [branch] -- proxy.ts src/lib/site-gate.ts supabase` with zero output.
   - Stop the dev server when done.
7. **Commit, push, and open the PR** with `gh pr create --base dev`.

### Files to Create/Modify
- **Create:**
  - `documentation/dips/DIP-FP-213-web.md` (verbatim, then frozen);
  - `scripts/test-fp213-wording.ts` (force-added).
- **Move:** the three route folders above.
- **Modify:**
  - `src/components/admin/AdminSidebar.tsx`;
  - `app/admin/(shell)/events/EventForm.tsx`;
  - `src/features/events/modifiedFields.ts`;
  - `src/features/formation/talk.service.ts` (message text only);
  - `next.config.*` (redirects only);
  - files inside the moved folders (labels and links);
  - any other file found in grounding items 1 and 2;
  - test scripts asserting `'Talk'`.
- **Must stay untouched:** `supabase/`, `app/api/` paths (message text inside services only), `proxy.ts`, `src/lib/site-gate.ts`, `src/lib/auth/`.

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-213-neutral-wording

### Commit Message
FP-213: rename Formation/Talk to Training/Session in web labels and admin URLs

### Pull Request Description
Plain GitHub markdown. Include:
- **A table of every string changed:** file, old text, new text.
- **The three route moves and the redirects.**
- **The grounding answers.**
- **The test output,** including the scanner's allowlist.
- **What was deliberately not renamed, and why** (see the "Not covered" section).
- **Not tested:** the hosted preview, and the mobile app.

**Steps for Joseph:**
1. Merge into `dev`, and wait for Vercel to show Ready.
2. On preview.flockpulse.ca, check:
   - the sidebar shows "Training";
   - Member Progress and Courses open;
   - an old bookmark such as `/admin/formation` lands on `/admin/training`;
   - a FORMATION-type event's form shows "Training session";
   - Record Restorations shows "Sessions".
3. On the phone, change a session on an event. The "what changed" banner should say "Session".
4. Optional: rename OWGC's "Formation" event type on the Event Types page if you want it neutral too. That is tenant data, not code.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-213

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-213-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
