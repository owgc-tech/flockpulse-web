DIP-REMEDIATION-1 (rev 3)
Story Summary
Remediation pass, not new feature work. Stories FP-6/FP-7/FP-9/FP-10/FP-12 (STORY-1.1, 1.2, 2.1, 2.2, 3.1) were previously implemented via a prior Gemini CLI-driven workflow as migration-only — no API routes, no server logic, several latent schema defects (including a soft-delete-but-not-enforced pattern repeated in two places, not one), and all five incorrectly marked Done in Jira while their parent epics remain To Do. This DIP fixes the schema, closes the soft-delete enforcement gap consistently across members and the newly-added assignments.deleted_at, removes ambiguity around hard-delete intent, builds the missing application layer, and adds a leader-scoped read endpoint so FP-7's assigned-members AC is genuinely testable.
Repo Target
Web — owgc-tech/flockpulse-web (verified via git remote -v; corrected from the prior revision's stale flockpulse reference). Next.js App Router, src/features/... convention. All five stories are admin/tenant-config surface area — web-only per Section 3.
Grounding Check
Cross-checked all five against live Jira (cloudId 7d4ab0b6-2656-4632-b83c-b8ac55beb9c5, project FP) and Epics & Stories v3 JSON — verbatim match, no drift. Epic parentage independently re-verified via getJiraIssue with fields: ["parent"] this session (not inferred):

FP-6, FP-7 → parent FP-5 (EPIC-1 — Tenant & Access Control)
FP-9, FP-10 → parent FP-8 (EPIC-2 — Member & Group Management)
FP-12 → parent FP-11 (EPIC-3 — Event Lifecycle Management)

No conflicts against Section 4 invariants. Flags:

get_tenant_id() redefinition — still blocking, not cosmetic; every RLS policy depends on it, including future attendance/self-report tables under Section 4 Rule 3.
FP-7 AC scope — "leader restricted to assigned members for confirmation workflows" is partially satisfied: schema (leader_member_id FK + RLS) and a testable enforcement point (/assignments/my-members) are delivered; full enforcement inside an actual confirmation-workflow context is pending EPIC-6 and is not claimed as done.
Status mismatch, expanded — FP-6/7/9/10/12 all show Done while their parent epics (FP-5, FP-8, FP-11) show To Do. That's an internal Jira inconsistency on top of the original premature-Done flag; worth surfacing both, not just the story-level one.
Soft-delete enforcement gap, now caught in two places — members had this bug (Section 3 of the remediation backstory); the new assignments.deleted_at column introduced in this same migration would have silently reintroduced an identical gap if the SELECT policy weren't updated alongside it. Fixed in step 4 below.

Implementation Plan
Phase 0 — Branch & history check

Create branch feature/FP-REMEDIATION-1-schema-and-app-layer off dev.
Check documentation/dips/ for any prior DIP-FP-6.md / DIP-FP-7.md / DIP-FP-9.md / DIP-FP-10.md / DIP-FP-12.md from the Gemini workflow; read for context before changing anything. Note in PR whether found.
Persist this DIP verbatim to documentation/dips/DIP-FP-REMEDIATION-1.md before any other change.

Phase 1 — Schema remediation (single new migration file)
4. Write supabase/migrations/20260629000003_remediate_rbac_and_assignments.sql:

members policies: drop the SELECT-only policy from 20260629000001; recreate as SELECT/INSERT/UPDATE only — no hard DELETE policy. Soft-delete is performed via UPDATE ... SET deleted_at = now(), Admin-gated, tenant-scoped. There is no legitimate product path that hard-deletes a member row, so no DELETE policy is created — this is intentional, not an oversight, and prevents CC from scaffolding an unused/unintended hard-delete endpoint. SELECT for non-Admin roles filters deleted_at IS NULL; Admin's UPDATE policy must be reachable regardless of deleted_at state (to perform the soft-delete itself).
Add INSERT policies to groups and assignments, tenant-scoped, Admin-only.
Redesign assignments.target_id: add deleted_at TIMESTAMPTZ (soft-delete, consistent with members/groups convention — same no-hard-DELETE-policy reasoning applies here too), split into group_id UUID REFERENCES groups(id) and leader_member_id UUID REFERENCES members(id), CHECK constraint enforcing exactly one populated based on assignment_type. Partial unique indexes: (member_id, group_id) WHERE deleted_at IS NULL AND assignment_type = 'GROUP' and (member_id, leader_member_id) WHERE deleted_at IS NULL AND assignment_type = 'LEADER'.
Update the existing assignments SELECT policy to add AND deleted_at IS NULL. This is the gap caught in review: the column was being added and correctly used in the new unique indexes, but the read-path policy wasn't updated alongside it — without this, a soft-deleted (removed) assignment would still appear in every listing query as if active, defeating the purpose of adding the column. Same category of bug as the original members regression; fix it in the same migration that introduces the column, not as a follow-up.
Backfill existing assignments rows from target_id into the new columns based on assignment_type before dropping target_id.
Fix handle_event_scheduling(): add AND assignments.assignment_type = 'GROUP' AND assignments.deleted_at IS NULL to the roster materialization WHERE clause (the deleted_at filter here matters for the same reason as the SELECT policy fix above — a removed group assignment shouldn't still pull members onto an event roster), reference group_id not target_id, and re-append SET search_path = public, pg_catalog since CREATE OR REPLACE FUNCTION drops prior SET clauses if not restated.
Expand events.status CHECK to ('DRAFT','SCHEDULED','ACTIVE','COMPLETED','LOCKED','CANCELLED').
Document get_tenant_id()'s auth.jwt() ->> 'tenant_id' extraction method via comment block; if Phase 2 testing reveals any policy still assumes the old current_setting() approach, fix it here.


supabase db reset (or migration up on a fresh stack) — validate full chain.
Manually exercise RLS via psql/local REST as a non-service-role JWT: member insert/update (no delete path to test, by design), group insert, assignment insert + duplicate-prevention + soft-delete-then-confirm-it's-excluded-from-SELECT, before Phase 2.

Phase 2 — Application layer
7. Auth middleware: validate JWT, extract user_id/role/tenant_id/member_id; AUTH_REQUIRED/INVALID_TOKEN for missing/invalid tokens; FORBIDDEN_ROLE for hierarchy violations; CROSS_TENANT_ACCESS for tenant mismatches. tenant_id server-derived only.
8. Member CRUD: create/update/soft-delete (no hard-delete endpoint, matching the no-DELETE-policy decision in step 4); unique active email per tenant; soft-deleted excluded from active queries.
9. Group/assignment CRUD: group create/list/remove; assignment create/remove (soft-delete via deleted_at, no hard-delete endpoint) for member↔group and member↔leader; duplicate-assignment constraint surfaced as a clean error.
10. Leader-scoped read endpoint: GET /api/assignments/my-members — returns the calling user's assigned members where assignments.leader_member_id matches their member_id, assignments.deleted_at IS NULL, tenant-scoped. Returns FORBIDDEN_ROLE for Members.
11. Event create + publish: POST /events → DRAFT; POST /events/:id/publish validates required fields, end_datetime > start_datetime, transitions to SCHEDULED, triggers fixed handle_event_scheduling(), creates notification schedule rows (creation only — dispatch is STORY-8.x).
Phase 3 — Security test checklist
12. Produce documentation/test-plans/FP-REMEDIATION-1-security-checklist.md covering:
- Valid JWT → correct user_id/role/tenant_id/member_id resolved
- Missing/expired/malformed JWT → AUTH_REQUIRED/INVALID_TOKEN
- Member attempting Leader/Admin-scoped action → FORBIDDEN_ROLE
- Client-supplied tenant_id differing from JWT's → ignored/rejected
- Cross-tenant resource access attempt → CROSS_TENANT_ACCESS
- Leader calling /assignments/my-members → only their assigned members, never another Leader's
- Duplicate active assignment creation → rejected cleanly, not a 500
- Soft-deleted member → excluded from active list/RSVP/self-report/confirmation-eligible queries
- Soft-deleted (removed) assignment → excluded from /assignments/my-members and from event roster materialization (new — directly covers the gap fixed in step 4)
13. If time allows, convert the highest-risk subset (JWT validation, FORBIDDEN_ROLE, CROSS_TENANT_ACCESS) into automated integration tests under src/features/auth/__tests__/. Should, not must.
Files to Create/Modify

supabase/migrations/20260629000003_remediate_rbac_and_assignments.sql (new)
src/lib/auth/middleware.ts (new/modified)
src/features/members/api/route.ts, src/features/members/service.ts (new)
src/features/groups/api/route.ts, src/features/groups/service.ts (new)
src/features/assignments/api/route.ts, src/features/assignments/api/my-members/route.ts, src/features/assignments/service.ts (new)
src/features/events/api/route.ts, src/features/events/api/[id]/publish/route.ts, src/features/events/service.ts (new)
documentation/dips/DIP-FP-REMEDIATION-1.md (new, verbatim)
documentation/test-plans/FP-REMEDIATION-1-security-checklist.md (new)
Optionally: src/features/auth/__tests__/*.test.ts (new)

Migration Files
supabase/migrations/20260629000003_remediate_rbac_and_assignments.sql — per Implementation Plan step 4. Local-only validation via Supabase CLI. Never run against remote/production directly.
Branch Name
feature/FP-REMEDIATION-1-schema-and-app-layer
Commit Message
FP-REMEDIATION-1: fix RLS/assignment schema defects (incl. soft-delete read-path gap), implement auth/member/group/event application layer, add leader-scoped read endpoint and security test checklist
Pull Request Description

FP-6 (STORY-1.1): Satisfied — auth middleware returns AUTH_REQUIRED/INVALID_TOKEN, tenant_id server-derived only, all responses tenant-scoped.
FP-7 (STORY-1.2): Partially satisfied. Additive RBAC, FORBIDDEN_ROLE, CROSS_TENANT_ACCESS fully implemented and testable. "Leader restricted to assigned members for confirmation workflows" is schema-ready and proven via /assignments/my-members, but full confirmation-workflow enforcement is pending EPIC-6 (FP-related, STORY-6.x) — not claimed as done here.
FP-9 (STORY-2.1): Satisfied — member CRUD, soft-delete (no hard-delete path, by design), unique active email enforced.
FP-10 (STORY-2.2): Satisfied — group/assignment CRUD, duplicate-assignment prevention, groups usable for event targeting. Assignment soft-delete is now actually enforced at the read layer (regression-pattern gap caught and fixed in this same PR, not shipped broken).
FP-12 (STORY-3.1): Satisfied — DRAFT→SCHEDULED publish flow, field validation, expected-member materialization via fixed trigger (now also respecting assignment soft-delete), notification schedule rows created.

Also: restored members RLS with explicit no-hard-delete design decision documented inline; groups/assignments INSERT policies; target_id polymorphic redesign with data backfill; assignments SELECT policy updated for deleted_at (closes a soft-delete-not-enforced gap in the same migration that introduced the column, rather than as a follow-up bug); handle_event_scheduling() SET search_path fix plus deleted_at filter; documented get_tenant_id() method; expanded events.status CHECK; mandatory security test checklist.
Note to reviewer: Jira shows FP-6/7/9/10/12 as Done while their parent epics (FP-5, FP-8, FP-11) show To Do — both inconsistencies predate this remediation and should be revisited post-merge. FP-7 specifically should be reopened/flagged partial, not Done, given the confirmation-workflow scoping gap above.
Jira Linkage

PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control) for FP-6, FP-7; FP-8 (EPIC-2 — Member & Group Management) for FP-9, FP-10; FP-11 (EPIC-3 — Event Lifecycle Management) for FP-12. Three epics, independently verified live via Jira parent field this session — not inferred.
PDEStoryID: FP-6 (STORY-1.1), FP-7 (STORY-1.2), FP-9 (STORY-2.1), FP-10 (STORY-2.2), FP-12 (STORY-3.1)

Stop Point
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.
