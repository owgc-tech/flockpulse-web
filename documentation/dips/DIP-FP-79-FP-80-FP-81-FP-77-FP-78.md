# DIP-FP-79-FP-80-FP-81-FP-77-FP-78 — Formation Completion Tracking Overhaul

**Covers:** FP-79 (talk_completions Table), FP-80 (Atomic Writes from Confirmation/Override), FP-81 (Admin Manual Completion Entry), FP-77 (Member-Relevant Denominator), FP-78 (Member Formation Progress Screen)
**Epic:** FP-28 (EPIC-7 — Formation Tracking Engine)

---

## Not Covered — Deliberately Excluded

- **EPIC-9 Reports aggregate/multi-member dashboard.** FP-78's own description explicitly reserves this for Reports; this DIP builds single-member progress lookup only. **Binding note for whenever EPIC-9 is built:** Reports must call into this DIP's completion computation rather than reinvent its own, or the two could quietly disagree over time — this is stated in FP-78's Jira description and repeated here so it isn't lost.
- **Bulk/CSV historical import.** FP-81 is explicitly single-record entry; bulk Excel-history import is a real, separate future need (same boundary drawn when CSV member-import was cancelled earlier in this project).
- **Backfill migration of existing `ATTENDED` rows into `talk_completions`.** FP-79's own description flags this as a future concern *if* real attendance data exists by the time this ships — confirmed this session that no real production attendance data exists yet (pre-launch), so no backfill step is included.
- **Fixing the `marital_status` UI/DB mismatch found during grounding.** `FounderCompleteForm.tsx` offers five marital-status options (Single/Married/Widowed/Divorced/Separated), but the `members.marital_status` `CHECK` constraint and `complete_registration()` function only accept `SINGLE`/`MARRIED` — selecting Widowed/Divorced/Separated today would hard-fail registration. This is real and pre-existing, discovered while grounding this DIP, and completely unrelated to formation completion. **Report to Atlas for a separate tech-debt ticket — do not fix as part of this DIP.**

---

## Story Summary

Five stories forming one linear dependency chain, confirmed by FP-77's own Jira description ("Depends on FP-79 and FP-80"): **FP-79** creates `talk_completions`, a durable, portable "member completed this Talk" fact independent of event/attendance bookkeeping. **FP-80** wires the two already-shipped attendance `SECURITY DEFINER` functions (`resolve_leader_confirmation`, `admin_override_attendance`) to write/remove completion rows atomically alongside their existing attendance writes. **FP-81** adds a second write path for Admin-entered historical completions with no event involved at all (the Excel-backfill use case). **FP-77** rewrites the completion *computation* to read from `talk_completions` instead of the old events/attendance join, and — a bigger piece than its description alone suggests — builds member-relevant-talk filtering from scratch (it doesn't exist anywhere in the codebase yet), using FP-76's demographic columns on `talks` against the member's `gender`/`marital_status`. **FP-78** is the UI consuming all of the above — lighter than it sounds, since `/api/formation/progress` and its full RBAC already exist and work; this DIP adds the missing screen and a member picker (reusing the already-existing `listMembers`).

---

## Repo Target

**Web — `owgc-tech/flockpulse-web`**, working branch `dev`. Admin-facing UI; shared backend touches Formation domain only.

---

## Grounding Check

1. **`talk_completions` schema, exactly per FP-79:** `id, tenant_id, member_id, talk_id, completed_at, source ('event_attendance' | 'manual'), source_event_id (nullable, FK events), recorded_by (nullable, FK members), created_at`. `UNIQUE (tenant_id, member_id, talk_id)` — one durable completion per member per Talk, never a log of every attendance. Confirmed no such table exists yet.

2. **No backfill needed — confirmed, not assumed.** No real `ATTENDED` attendance data exists in this project yet (pre-launch, confirmed this session). FP-79's own description flags backfill as a future concern only if real data already exists by ship time; it doesn't.

3. **Demographic-relevance logic must be built new — it does not exist anywhere in the codebase today.** Confirmed via direct read of `formation-completion.service.ts` this session: zero gender/marital_status filtering logic exists. FP-77's description references "the demographic filtering elsewhere in this story" as if already established — it isn't; this DIP builds it, using `talks.for_single_men` / `for_single_women` / `for_married_men` / `for_married_women` (FP-76, already shipped) against `members.gender` (`MALE`/`FEMALE`) and `members.marital_status` (`SINGLE`/`MARRIED` — see item 4). Mapping: `gender=MALE, marital_status=SINGLE → for_single_men`; `FEMALE, SINGLE → for_single_women`; `MALE, MARRIED → for_married_men`; `FEMALE, MARRIED → for_married_women`.

4. **`members.marital_status` only ever holds `SINGLE` or `MARRIED` at the database level** (confirmed via direct migration read — `CHECK (marital_status IN ('SINGLE', 'MARRIED'))`), despite the UI offering more options (see Not Covered). This DIP's demographic-relevance mapping only needs to handle these two real values — the four-way mapping in item 3 is exhaustive for what the database can actually contain.

5. **`/api/formation/progress` already exists, fully built, with correct RBAC** (confirmed via direct read this session): Member restricted to own `member_id`; Leader restricted to self + assigned members via `getAssignedMemberIds`; Admin unrestricted within tenant. **Do not rebuild this route or its RBAC — extend `computeCourseProgress`/`computeAllCoursesProgress` in place**, since the route already calls them correctly.

6. **Practical scoping finding: only the Admin path is reachable via web today.** The web app has no login path for MEMBER or LEADER roles (`/login` requires `role === 'ADMIN'`, confirmed in `login/actions.ts`) — Members/Leaders have no way to reach any web screen at all until a mobile app exists. FP-78's self-view and leader-scoped-view RBAC paths are real and already correctly implemented at the API level, but have no reachable web UI consumer today. **This DIP builds the screen as an Admin-only lookup tool** (Admin selects any member via a picker, using the existing `listMembers(tenantId)` — already returns `id, email, first_name, last_name, role`, no new backend needed for this). Self-view stays dormant, correctly-built, unused until mobile exists or web login opens to other roles — not a gap in this DIP, a correct reflection of what's actually reachable.

7. **`resolve_leader_confirmation()` and `admin_override_attendance()` are both already-shipped, already-revised-once `SECURITY DEFINER` functions** (both originally in migration `20260629000010`, both `CREATE OR REPLACE`'d again in `20260629000017` to add audit logging). Confirmed via direct read of the current (`000017`) versions this session: both upsert into `attendance` via `INSERT ... ON CONFLICT (tenant_id, event_id, member_id) DO UPDATE`, `admin_override_attendance` additionally calls `write_audit_log(...)`. **Extend via `CREATE OR REPLACE` preserving every existing line — add the new `talk_completions` sync as an additional step, not a rewrite.** `attendance.attendance_status` is a strict two-value `CHECK ('ATTENDED', 'DID_NOT_ATTEND')` — no third state to handle.

8. **Shared helper function to avoid duplicating sync logic in two places.** Both functions need identical logic: look up `events.talk_id` for the event (may be `NULL` — not every event is Talk-linked), and if not null, either upsert or delete the completion row depending on the new `attendance_status`. Propose a new `SECURITY DEFINER` helper `sync_talk_completion_for_attendance(p_tenant_id, p_event_id, p_member_id, p_attendance_status, p_confirmed_at)`, called from both `resolve_leader_confirmation` and `admin_override_attendance` after their existing attendance upsert/audit-log block, before their `RETURN QUERY`. DRY, and any future third write-path (if one ever exists) gets the same correct behavior automatically.

9. **Source-precedence policy for `talk_completions` conflicts — a real design decision, stated explicitly rather than silently picked:**
   - **Event-attendance path (FP-80, via the helper in item 8) always wins on `ATTENDED`:** `ON CONFLICT (tenant_id, member_id, talk_id) DO UPDATE` — real, currently-happening attendance is more authoritative than anything already on file, including a prior manual entry. This lets a later real event upgrade/correct a manually-backfilled record.
   - **Event-attendance path on `DID_NOT_ATTEND` (reject or override-away-from-ATTENDED) only deletes the completion row if it was *this exact event* that produced it** — `WHERE source = 'event_attendance' AND source_event_id = p_event_id`. This is important: it must never delete a completion that came from a different event or from a manual entry just because *this* event's attendance flipped away from ATTENDED.
   - **Manual entry path (FP-81) never overwrites an existing row** — `ON CONFLICT DO NOTHING`, then check whether the row that exists is the one just attempted; if a conflict occurred, surface a clear message naming the existing source (e.g. "Already recorded via event attendance on [date]" or "Already manually recorded") rather than silently no-op-ing or throwing a raw constraint error. A manual backfill should only ever fill a genuine gap, never downgrade a real record.

10. **Canonical error codes.** `VALIDATION_ERROR` for manual-entry conflicts/bad input, `NOT_FOUND` for unknown member/talk, `FORBIDDEN_SCOPE` (already the code used by the existing `/api/formation/progress` RBAC — reuse, don't invent a new one). No new ad hoc codes.

11. **No conflicts with Section 4 invariants — this DIP is a direct implementation of Rule 4, not a deviation from it.** "Talk completion requires official `attendance_status = ATTENDED`" remains true: the only two write paths into `talk_completions` are (a) the `sync_talk_completion_for_attendance` helper, which only fires from confirmed attendance transitions, and (b) FP-81's manual entry, which represents a real historical fact an Admin is attesting to (the same authority an Admin already has via `admin_override_attendance` today). Neither RSVP nor a pending/unconfirmed self-report can produce a row.

12. **Live-computation requirement (FP-77's added AC) — a guardrail against a future regression, not new work today.** Relevant-talk determination must be computed live against the member's *current* `gender`/`marital_status` at query time, never cached or materialized. The current codebase already queries live on every request (no caching layer exists anywhere in `formation-completion.service.ts`) — this requirement is naturally satisfied as long as this DIP doesn't introduce one. **Do not add a caching layer to this computation, even for performance, without re-confirming this constraint with the user first** — per FP-77's own AC, this is a hard constraint, not a nice-to-have to revisit later.

13. **Prior work check:** no `documentation/dips/DIP-FP-77*.md`/`FP-78*`/`FP-79*`/`FP-80*`/`FP-81*` exists. No `talk_completions` table, no demographic-relevance logic, no Formation Progress screen exist in the repo (confirmed via direct clone-and-grep this session).

---

## Implementation Plan

### Step 1 — Migration
Single new migration file (verify actual next sequence number at execution time; latest confirmed this session is `20260707000025`):

1. `CREATE TABLE talk_completions` per Grounding Check item 1, with the cross-tenant safety trigger pattern already established for other Formation tables (validate `member_id` and `talk_id` both belong to `tenant_id` — mirror `validate_module_tenant_scope`'s structure).
2. RLS: tenant-wide `SELECT` (app-layer RBAC in `/api/formation/progress` already handles the member-scope restriction, matching how that route already works — RLS here is tenant isolation only, not member-scope). No client-facing `INSERT`/`UPDATE`/`DELETE` policies — all writes go through the `SECURITY DEFINER` helper (item 8 below) or the service-role client (FP-81's Server Action), consistent with every other table in this codebase.
3. `CREATE OR REPLACE FUNCTION sync_talk_completion_for_attendance(...)` per Grounding Check items 8–9.
4. `CREATE OR REPLACE FUNCTION resolve_leader_confirmation(...)` — copy the full current body from migration `20260629000017` verbatim, add one call to `sync_talk_completion_for_attendance(...)` after the existing attendance upsert/audit-log block, before `RETURN QUERY`.
5. `CREATE OR REPLACE FUNCTION admin_override_attendance(...)` — same pattern, copy current body from `20260629000017` verbatim, add the same call.
6. No RLS/grants changes needed on `attendance` or `events` — read-only lookups from within the `SECURITY DEFINER` helper bypass RLS by definition.

### Step 2 — Backend: completion computation rewrite
`src/features/formation/formation-completion.repository.ts`:
- Remove/replace `fetchEventsForTalks` and `fetchAttendedRows` with a new `fetchCompletionsForTalks(memberId, talkIds, tenantId)` — a single query against `talk_completions`, far simpler than the old two-table join.
- Add `fetchMemberDemographics(memberId, tenantId)` — `SELECT gender, marital_status FROM members WHERE id = ... AND tenant_id = ...`.

`src/features/formation/formation-completion.service.ts`:
- `computeCourseProgress`: fetch member demographics once; for each Talk, determine relevance via the mapping in Grounding Check item 3; **irrelevant talks are excluded from the denominator entirely** (not counted as incomplete, not shown) for self-view and for Admin/Leader-viewing-another-member alike — filtering chosen over an "N/A" label per FP-77's AC allowing either, for consistency across both viewing contexts; module/course completion computed only over the member's relevant talks (an all-irrelevant module is vacuously complete, same reasoning already established for an all-empty module).
- Completion source: `talk_completions` row exists for `(member_id, talk_id)` → complete. Nothing else.

### Step 3 — Manual completion entry (FP-81)
`src/features/formation/talk-completions.service.ts` (new): `recordManualCompletion(tenantId, adminMemberId, memberId, talkId, completedAt)` — validates member and talk both belong to the tenant and talk is active (not soft-deleted), attempts insert with `source = 'manual'`, `recorded_by = adminMemberId`; on unique-violation (`23505`), fetch the existing row and surface a message naming its actual source per Grounding Check item 9's precedence policy; on success, calls `write_audit_log(...)` via `.rpc(...)`, same pattern already established in the SQL functions (Section 4 Rule "audited" requirement).

### Step 4 — Server Actions and UI
- `app/admin/(shell)/formation-progress/actions.ts`: `listMembersAction` (thin wrapper over existing `listMembers`), `getMemberProgressAction` (calls `computeAllCoursesProgress`), `recordManualCompletionAction`.
- `app/admin/(shell)/formation-progress/page.tsx`: Server Component, standard auth pattern, initial member list fetch.
- `app/admin/(shell)/formation-progress/FormationProgressBrowser.tsx`: Client Component — member picker (search/filter over the already-fetched list, no new search backend needed for this list size), expandable Course → Module → Talk tree with completion checkmarks, and an inline "Record completion manually" action per incomplete Talk row, opening a small form (talk pre-filled from context, just needs a completion date) that calls `recordManualCompletionAction` — this is FP-81's actual entry point, embedded in FP-78's screen rather than a disconnected standalone page, since FP-81's own description doesn't specify an entry point and this is the natural one (member + talk already in context).
- Add "Formation Progress" to `AdminSidebar.tsx` (FP-104's component) as a new nav item.

### Step 5 — Regression check
Confirm existing formation-completion consumers (`/api/formation/progress`, called by nothing else in the current codebase besides itself — confirmed via grep) still return correctly-shaped responses. Confirm FP-83's browse screen and FP-85/86/87's guard/reorder/restore logic are entirely unaffected (they operate on `courses`/`modules`/`talks` structure, not completion data). Confirm `resolve_leader_confirmation`/`admin_override_attendance`'s existing behavior (attendance upsert, audit logging, `self_report_id` preservation, `version` increment) is byte-for-byte unchanged aside from the one new call each.

---

## Files to Create/Modify

**Migration:**
- `supabase/migrations/[next-number]_talk_completions_and_atomic_writes.sql` (new)

**Backend (modify):**
- `src/features/formation/formation-completion.repository.ts`
- `src/features/formation/formation-completion.service.ts`

**Backend (new):**
- `src/features/formation/talk-completions.service.ts`
- `src/features/formation/talk-completions.repository.ts`

**Frontend (new):**
- `app/admin/(shell)/formation-progress/page.tsx`
- `app/admin/(shell)/formation-progress/actions.ts`
- `app/admin/(shell)/formation-progress/FormationProgressBrowser.tsx`

**Frontend (modify):**
- `src/components/admin/AdminSidebar.tsx` (add nav item)

**Test plan:**
- `documentation/test-plans/FP-77-78-79-80-81-formation-completion-checklist.md`

---

## Branch Name

`feature/FP-79-FP-80-FP-81-FP-77-FP-78-formation-completion`

---

## Commit Message

`FP-79,80,81,77,78: Formation completion overhaul — talk_completions table, atomic write paths, demographic-relevant progress screen`

---

## Pull Request Description

Maps to each story's AC:
- **FP-79:** `talk_completions` table exactly per spec, unique per member/talk, no backfill needed (confirmed no real data exists).
- **FP-80:** both attendance functions extended via `CREATE OR REPLACE` (existing behavior preserved verbatim), new shared helper syncs completion atomically on `ATTENDED`/`DID_NOT_ATTEND`, source-scoped delete prevents cross-contamination between event/manual records.
- **FP-81:** single-record manual entry, audited, never silently overwrites an existing completion — surfaces its actual source instead.
- **FP-77:** computation now reads `talk_completions`; demographic-relevant filtering built from scratch (didn't exist before); live-computed, no caching introduced.
- **FP-78:** Admin-only member-lookup screen (states explicitly why self-view/leader-view, while correctly RBAC'd at the API level, have no reachable web UI today), expandable progress tree, manual-completion entry embedded inline.

States explicitly how Grounding Check item 9 (source-precedence policy) was resolved, since it was a real design decision made by Atlas and not dictated by the original story text.

---

## Jira Linkage

- PDEEpicID: FP-28 (EPIC-7 — Formation Tracking Engine)
- PDEStoryID: FP-79, FP-80, FP-81, FP-77, FP-78

---

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-FP-79-FP-80-FP-81-FP-77-FP-78.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.

**Before writing any code:** re-verify the exact current bodies of `resolve_leader_confirmation()` and `admin_override_attendance()` against migration `20260629000017` (or later, if anything has changed since) — do not reconstruct them from this DIP's summary, copy the real current source.

**If the `marital_status` UI/DB mismatch (Not Covered) or any other finding needs a Jira ticket, do not file it directly — report it back for Atlas to file.**

**Standing requirement:** since this DIP touches `.ts`/`.tsx` application code, `npm run build` must pass cleanly before pushing/opening the PR.

All changes go through a feature branch and a PR — no direct pushes to `dev`, no exceptions.
