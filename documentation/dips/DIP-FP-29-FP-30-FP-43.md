DIP-FP-29-FP-30-FP-43 — Formation Structure, Event Linkage, and Completion Computation
Covers: STORY-7.1 (FP-29) — Link Formation Event to Talk Covers: STORY-7.2 (FP-30) — Compute Formation Progress from Confirmed Attendance Covers: FP-43 (TECH-DEBT — Add tenant-scoped FK constraint on events.talk_id) — folded in, not tracked separately Epic: EPIC-7 — Formation Tracking Engine (FP-28) Work Package: WP-9 (Developer Execution Packet — covers STORY-7.1 and STORY-7.2 as one unit)
Story Summary
This is the first piece of work touching formation structure — no migration has created `courses`, `modules`, or `talks` at any point this session. This DIP builds all three (with soft-delete, `sequence_order`, and tenant-scoped cross-references), links `events.talk_id` to the new `talks` table with a real FK plus tenant-safety and soft-delete rejection (this is FP-43's entire scope, arriving naturally as WP-9's own step 3, not as separate hardening), and implements the formation-completion computation the whole system has been building toward since RSVP: a Talk is complete only when there's a real, official, leader-confirmed `ATTENDED` attendance row — never from RSVP, never from a pending self-report, never from `DID_NOT_ATTEND`.
FP-43 is not tracked as separate work. It was already commented as resolved-by-this-DIP; this DIP is what actually resolves it.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Grounding Check

1. FP-29's AC and FP-43's AC are the same requirement, confirmed via WP-9's own implementation steps. FP-29: "Invalid or soft-deleted talk_id is rejected." WP-9 step 3: "Validate talk_id on event creation and update: must be active, non-deleted, tenant-scoped." These describe one piece of work, not two. Building it once, here.
2. `events.talk_id` validation touches existing, already-shipped application code, not just a new migration. `src/features/events/service.ts` (`createEvent`, `publishEvent`, `updateEvent`) already exists from prior EPIC-3 work. `updateEvent` in particular already has `talk_id` immutability logic (post-notification-dispatch, from FP-14). This DIP adds validation on top of that existing logic — confirm the current file contents before editing, don't assume its shape from this DIP alone.
3. Formation completion is query-derived, not materialized — per WP-9 step 7 and no contrary requirement found in the Engineering Spec. Implement as TypeScript service logic performing separate queries and in-memory joins, following the same pattern established in `confirmation.repository.ts` (`getPendingConfirmations`'s RSVP merge) rather than a PostgREST embed — the join path here (talk → events → attendance, filtered by member) is multi-hop and not embeddable via a single FK relationship anyway.
4. Talk deletion-blocking (WP-9 step 2) covers two distinct concerns with one rule, confirmed deliberately with the user. The narrow reading (don't orphan an event's `talk_id`) and the broader one (don't let a member's demonstrated `ATTENDED` completion history silently vanish from formation-progress reporting) turn out to be the same check: block soft-delete if any event, of any status — not just non-cancelled — currently references this talk. This works for the completion-history case specifically because `talk_id` becomes immutable once an event's notifications are dispatched (existing FP-14 behavior) — so any attendance row tracing through an event always traces through an event whose `talk_id` still points here. This protection is inherited from that immutability guarantee, not independently enforced — if FP-14's immutability logic is ever weakened, this guard's completion-history protection silently weakens with it. Comment this dependency explicitly in the trigger so it isn't invisible to whoever touches `talk_id` immutability later.
5. `sequence_order` "enforcement" (WP-9 step 1) means uniqueness within parent scope, not just a plain integer column — partial unique indexes scoped to non-deleted rows, matching the `assignments`/`rsvps` precedent of partial unique indexes for "one active X per Y" rules.
6. Empty module/course completion is an assumption, not a spec-stated rule — flag it, don't silently decide. Neither the PDD nor Engineering Spec addresses whether a module with zero active Talks counts as "complete." This DIP treats it as vacuously complete (all-of-an-empty-set is true) since that's the standard mathematical reading of "all talks in the module are complete" — but this is a judgment call worth surfacing, not asserting as settled.
7. Canonical error code corrected on a closer re-read of Engineering Spec §6's list — `INVALID_FORMATION_LINK` exists specifically for this, and was missed in the first draft. `events.talk_id` being invalid, soft-deleted, or cross-tenant maps to `INVALID_FORMATION_LINK`, not the generic `INVALID_TARGET` used in the original draft — this is precisely a formation-link validation failure, and the canonical list names it exactly. `INVALID_STATE_TRANSITION` remains the closest available fit for the separate delete-blocked-by-reference case (no exact canonical match exists for that one) — still a judgment call, but more defensible now that the actually-correct formation-specific code is properly assigned to the case it was written for.
8. Pre-existing naming collision risk, flagged not fixed. `src/features/events/service.ts`'s existing `publishEvent()` uses a string `INVALID_TRANSITION` (non-canonical, already shipped) — nearly identical to but distinct from the canonical `INVALID_STATE_TRANSITION` this DIP introduces in the same file. Use the canonical spelling precisely in new code; do not "helpfully" rename the existing one to match without explicit sign-off — that's a separate decision, out of scope here.
9. Audit TODO hooks extend beyond FP-48's originally-scoped list, on purpose. FP-41/FP-48's acceptance criteria list RSVP, self-report, leader confirmation, admin override, and event create/update/cancel as required audit points — Course/Module/Talk CRUD isn't explicitly named. Add TODO(EPIC-10) hooks here anyway, consistent with this session's standing practice of flagging rather than silently omitting — and note in the PR that FP-48's scope should be reconciled to include these when it's actually built.
10. No conflicts with Section 4 invariants. This is the formation-completion invariant (Rule 4) being implemented for the first time, exactly as specified — `ATTENDED` and only `ATTENDED` completes a Talk.
Implementation Plan

1. Migration — `courses`, `modules`, `talks` tables:
   * `courses`: `id, tenant_id, name, sequence_order, deleted_at, created_at, updated_at`. Partial unique index on `(tenant_id, sequence_order) WHERE deleted_at IS NULL`.
   * `modules`: `id, tenant_id, course_id (FK → courses), name, sequence_order, deleted_at, created_at, updated_at`. Partial unique index on `(course_id, sequence_order) WHERE deleted_at IS NULL`. Cross-tenant safety trigger (module's `tenant_id` must match its `course_id`'s tenant).
   * `talks`: `id, tenant_id, module_id (FK → modules), name, sequence_order, deleted_at, created_at, updated_at`. Partial unique index on `(module_id, sequence_order) WHERE deleted_at IS NULL`. Cross-tenant safety trigger (talk's `tenant_id` must match its `module_id`'s tenant).
   * RLS: tenant-wide `SELECT` on all three (matches established pattern); `INSERT`/`UPDATE` restricted to Admin via `caller_is_admin()` (reused from FP-51/52, not reimplemented).
2. Migration — Talk deletion guard: `BEFORE UPDATE` trigger on `talks` — if `NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL` (transitioning to soft-deleted) and any `events` row has `talk_id = NEW.id AND status <> 'CANCELLED'`, raise an exception. This is the DB-layer half of WP-9 step 2; the app layer should map this to `INVALID_STATE_TRANSITION` per Grounding Check item 7.
3. Migration — `events.talk_id` FK and tenant/soft-delete safety:
   * `ALTER TABLE events ADD CONSTRAINT events_talk_id_fkey FOREIGN KEY (talk_id) REFERENCES talks(id)` — plain FK for structural existence, matching every other table's pattern.
   * New or extended trigger: when `NEW.talk_id IS NOT NULL`, confirm the referenced `talks` row has `tenant_id = NEW.tenant_id AND deleted_at IS NULL` — raise otherwise. This closes FP-43 and FP-29's second AC together.
   * Before applying the tightened check, confirm no existing `events.talk_id` values would violate it (none should exist yet, since nothing has ever written to this column, but verify rather than assume).
4. `src/features/formation/` — Course/Module/Talk CRUD (`course.service.ts`/`.repository.ts`, same for `module`, `talk`), Admin-only per PDD. Each: create, update (including soft-delete via `deleted_at`), list, get-by-id. Soft-delete on `talks` routes through the deletion-guard trigger from step 2 — map its exception to `INVALID_STATE_TRANSITION`. Validation errors (missing `name`, non-integer `sequence_order`, duplicate `sequence_order` within parent) map to `VALIDATION_ERROR`.
5. `src/features/events/service.ts` — extend existing `createEvent`/`updateEvent` with `talk_id` validation. Read the current file first (Grounding Check item 2). Add: if `talk_id` provided, confirm it references an active, non-deleted, tenant-scoped Talk — `INVALID_FORMATION_LINK` otherwise (canonical code, corrected on re-read of Engineering Spec §6 — see Grounding Check item 7; matches FP-29's "invalid or soft-deleted talk_id is rejected" AC precisely). This is app-layer defense-in-depth on top of the DB trigger from step 3, same dual-layer pattern as everywhere else.
6. `src/features/formation/formation-completion.service.ts` — the actual STORY-7.2 logic:
   * Given `member_id` and `course_id`: fetch non-deleted `modules` for the course, non-deleted `talks` for those modules.
   * Fetch `events` where `talk_id` is in that Talk set, `status <> 'CANCELLED'`, tenant-scoped.
   * Fetch `attendance` where `event_id` is in that event set, `member_id` matches, `attendance_status = 'ATTENDED'`.
   * A Talk is complete iff any of its linked events appears in the `ATTENDED` set.
   * Module complete iff all its Talks are complete (vacuously true if none, per Grounding Check item 6).
   * Course complete iff all its Modules are complete.
   * Explicitly do not read `rsvps` or `member_attendance_reports` anywhere in this computation — the whole point of STORY-7.2 is that neither RSVP nor a pending/self-reported Yes completes anything.
7. `GET /api/formation/progress` — response shape per Engineering Spec §7 exactly: `{items:[{member_id, course_id, completed_talk_count, total_talk_count, course_completed, modules:[{module_id, module_completed, talks:[{talk_id, completed, attendance_recorded_at}]}]}]}`. RBAC: Member queries only their own `member_id` (default to self if omitted); Leader can query self or their assigned members (`getAssignedMemberIds`, reused); Admin can query any tenant member — same scoping pattern as `GET /api/confirmations/pending`.
8. Audit TODO hooks at Course/Module/Talk create/update/soft-delete, per Grounding Check item 8.
9. Regression guard: confirm no code path in this DIP reads `rsvps.rsvp_status` or `member_attendance_reports.self_report_status`/`confirmation_status` when computing completion — only `attendance.attendance_status = 'ATTENDED'` counts, per invariant Rule 4.
Files to Create/Modify

* `supabase/migrations/20260629000015_formation_structure_and_completion.sql`
* `src/features/formation/course.types.ts`, `course.repository.ts`, `course.service.ts`
* `src/features/formation/module.types.ts`, `module.repository.ts`, `module.service.ts`
* `src/features/formation/talk.types.ts`, `talk.repository.ts`, `talk.service.ts`
* `src/features/formation/formation-completion.service.ts`, `formation-completion.repository.ts`
* `src/features/events/service.ts` (modify — add `talk_id` validation to `createEvent`/`updateEvent`)
* `app/api/courses/route.ts`, `app/api/courses/[id]/route.ts`
* `app/api/modules/route.ts`, `app/api/modules/[id]/route.ts`
* `app/api/talks/route.ts`, `app/api/talks/[id]/route.ts`
* `app/api/formation/progress/route.ts`
* `documentation/test-plans/FP-29-30-43-formation-checklist.md`
Migration File
`supabase/migrations/20260629000015_formation_structure_and_completion.sql`

```sql
-- DIP-FP-29-FP-30-FP-43: Formation structure (Course/Module/Talk), event-talk linkage
-- with tenant-scoped FK safety and soft-delete rejection (closes FP-43), and Talk
-- deletion-blocking when referenced by active (non-cancelled) events.


-- ==============================================================
-- SECTION 1: courses, modules, talks
-- ==============================================================

CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sequence_order INT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_unique_sequence
    ON courses(tenant_id, sequence_order) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id),
    name TEXT NOT NULL,
    sequence_order INT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE modules ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_unique_sequence
    ON modules(course_id, sequence_order) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS talks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    module_id UUID NOT NULL REFERENCES modules(id),
    name TEXT NOT NULL,
    sequence_order INT NOT NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE talks ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_talks_unique_sequence
    ON talks(module_id, sequence_order) WHERE deleted_at IS NULL;


-- ==============================================================
-- SECTION 2: Cross-tenant safety triggers (module → course, talk → module)
-- ==============================================================

CREATE OR REPLACE FUNCTION public.validate_module_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM courses WHERE id = NEW.course_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'modules.course_id % does not belong to tenant %', NEW.course_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_module_tenant_scope ON modules;
CREATE TRIGGER trigger_validate_module_tenant_scope
BEFORE INSERT OR UPDATE ON modules
FOR EACH ROW EXECUTE FUNCTION validate_module_tenant_scope();

CREATE OR REPLACE FUNCTION public.validate_talk_tenant_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM modules WHERE id = NEW.module_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'talks.module_id % does not belong to tenant %', NEW.module_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_talk_tenant_scope ON talks;
CREATE TRIGGER trigger_validate_talk_tenant_scope
BEFORE INSERT OR UPDATE ON talks
FOR EACH ROW EXECUTE FUNCTION validate_talk_tenant_scope();


-- ==============================================================
-- SECTION 3: Talk deletion guard (WP-9 step 2)
--
-- Blocks soft-delete if ANY event references this talk, regardless of
-- status — not just non-cancelled. This deliberately covers two concerns
-- with one rule: (a) don't orphan an event's talk_id, and (b) don't let
-- a member's demonstrated ATTENDED completion history silently vanish
-- from formation-progress reporting.
--
-- (b) depends entirely on talk_id becoming IMMUTABLE once an event's
-- notifications are dispatched (existing FP-14 behavior, src/features/
-- events/service.ts). Because of that immutability, any attendance row
-- tracing through an event always traces through an event whose talk_id
-- still points here — so this guard's completion-history protection is
-- INHERITED from that immutability guarantee, not independently enforced.
-- If FP-14's talk_id immutability logic is ever weakened or removed,
-- this protection silently weakens with it. Do not remove or loosen
-- talk_id immutability without re-examining this guard.
-- ==============================================================

CREATE OR REPLACE FUNCTION public.block_talk_deletion_if_referenced()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM events WHERE talk_id = NEW.id) THEN
      RAISE EXCEPTION 'Cannot soft-delete talk %: referenced by one or more events (any status) — see trigger comment for why this also protects member completion history', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_block_talk_deletion_if_referenced ON talks;
CREATE TRIGGER trigger_block_talk_deletion_if_referenced
BEFORE UPDATE ON talks
FOR EACH ROW EXECUTE FUNCTION block_talk_deletion_if_referenced();


-- ==============================================================
-- SECTION 4: events.talk_id FK + tenant/soft-delete safety (closes FP-43, FP-29 AC 2)
-- ==============================================================

ALTER TABLE events
    ADD CONSTRAINT events_talk_id_fkey FOREIGN KEY (talk_id) REFERENCES talks(id);

CREATE OR REPLACE FUNCTION public.validate_event_talk_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.talk_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM talks
      WHERE id = NEW.talk_id AND tenant_id = NEW.tenant_id AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'events.talk_id % is invalid, soft-deleted, or belongs to a different tenant', NEW.talk_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_validate_event_talk_id ON events;
CREATE TRIGGER trigger_validate_event_talk_id
BEFORE INSERT OR UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION validate_event_talk_id();


-- ==============================================================
-- SECTION 5: RLS — tenant-wide SELECT, Admin-only INSERT/UPDATE
--
-- Deliberately SELECT/INSERT/UPDATE only, never FOR ALL or a DELETE
-- policy — same standing rule as members/assignments since migration
-- 000003: "No DELETE policy is created intentionally: soft-delete via
-- UPDATE is the only supported removal path." FOR ALL would combine
-- with migration 000011's blanket DELETE grant to allow real hard-delete
-- via direct Supabase access, breaking every soft-delete guarantee this
-- DIP otherwise builds (including the talk deletion guard in Section 3,
-- which only fires on UPDATE, not DELETE).
-- ==============================================================

CREATE POLICY "courses_select" ON courses FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "courses_admin_insert" ON courses FOR INSERT
    WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());
CREATE POLICY "courses_admin_update" ON courses FOR UPDATE
    USING (tenant_id = get_tenant_id() AND caller_is_admin())
    WITH CHECK (tenant_id = get_tenant_id());

CREATE POLICY "modules_select" ON modules FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "modules_admin_insert" ON modules FOR INSERT
    WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());
CREATE POLICY "modules_admin_update" ON modules FOR UPDATE
    USING (tenant_id = get_tenant_id() AND caller_is_admin())
    WITH CHECK (tenant_id = get_tenant_id());

CREATE POLICY "talks_select" ON talks FOR SELECT USING (tenant_id = get_tenant_id());
CREATE POLICY "talks_admin_insert" ON talks FOR INSERT
    WITH CHECK (tenant_id = get_tenant_id() AND caller_is_admin());
CREATE POLICY "talks_admin_update" ON talks FOR UPDATE
    USING (tenant_id = get_tenant_id() AND caller_is_admin())
    WITH CHECK (tenant_id = get_tenant_id());

```

Branch Name
`feature/FP-29-30-43-formation-structure`
Commit Message
`FP-29, FP-30, FP-43: Implement formation structure, event-talk linkage, and completion computation`
Pull Request Description
Implements STORY-7.1 (FP-29):

* ✅ Formation event requires valid `talk_id` — FK + trigger validation
* ✅ Invalid or soft-deleted `talk_id` rejected — `INVALID_TARGET` app-layer, exception DB-layer
* ✅ One event maps to at most one talk — single nullable column, structurally guaranteed
Implements STORY-7.2 (FP-30):

* ✅ Talk complete only via official `ATTENDED` on a non-cancelled linked event
* ✅ RSVP Yes, pending self-report, and `DID_NOT_ATTEND` all confirmed not to complete a talk — regression-tested explicitly
* ✅ Module/course completion aggregation implemented per spec
Resolves FP-43 (not tracked separately) — tenant-scoped FK constraint on `events.talk_id`, same pattern as `assignments`/`rsvps`/`attendance` cross-tenant triggers.
Flagged assumptions, not silently decided:

* `events.talk_id` invalid/soft-deleted/cross-tenant uses `INVALID_FORMATION_LINK` (canonical, corrected from an initial `INVALID_TARGET` draft on re-read of Engineering Spec §6)
* `INVALID_STATE_TRANSITION` used for delete-blocked-by-reference — no exact canonical match exists for this specific case, closest available fit
* Existing `INVALID_TRANSITION` string in `publishEvent()` (non-canonical, pre-existing) is not touched by this DIP despite the near-identical name to the canonical code introduced here — flagged as a future cleanup decision, not fixed now
* Audit TODO hooks added for Course/Module/Talk CRUD beyond FP-48's currently-scoped list — FP-48 should be reconciled to include these
* Empty module/course (zero active Talks) is vacuously complete — confirmed safe with the user: `events.talk_id` only ever links directly to a Talk, never a Module or Course, so an empty Module structurally cannot have contributed to any member's completion history regardless of its own completion status
* Talk deletion is blocked by any referencing event regardless of status (not just non-cancelled) — deliberately broadened with the user to also protect member completion history, which works because `talk_id` is immutable post-notification-dispatch (see migration comment)
Jira Linkage

* PDEEpicID: FP-28 (EPIC-7 — Formation Tracking Engine)
* PDEStoryID: FP-29 (STORY-7.1 — Link Formation Event to Talk)
* PDEStoryID: FP-30 (STORY-7.2 — Compute Formation Progress from Confirmed Attendance)
* Resolves: FP-43 (folded in, not separately tracked)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-29-FP-30-FP-43.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description.
Create the feature branch, read `src/features/events/service.ts` before editing it, implement, run full regression including the explicit RSVP/pending-self-report/DID_NOT_ATTEND-do-not-complete tests, commit, push, and open the PR against `dev`.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
