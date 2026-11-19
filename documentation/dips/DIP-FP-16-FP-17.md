DIP-FP-16-FP-17 — RSVP Submission with Reason Enforcement
Covers: STORY-4.1 (FP-16) — Submit RSVP Response Covers: STORY-4.2 (FP-17) — Enforce RSVP No Reason Requirement Epic: EPIC-4 — RSVP Management (FP-15) Work Package: WP-5 (Developer Execution Packet)
Story Summary
Members need to record pre-event attendance intent — Yes or No — before an event starts. This is intent only: it is a separate concept from post-event self-report and official leader-confirmed attendance, and must never write to, read from, or influence any attendance-confirmation table (none of which exist yet — they land in EPIC-5/6). A "No" response requires a stored reason; "Yes" does not. Submitting again before the event starts overwrites the prior response rather than creating a new row (upsert on tenant + event + member).
This is also the first real caller of `block_actions_on_cancelled_or_locked()`, a guard function built during FP-13 that has had zero callers until now — migration `20260629000005` explicitly names `POST /api/events/:id/rsvp` as its intended first consumer. Wiring it up here is in scope and should be treated as validating that earlier work, not as optional.
Repo Target
Web — `owgc-tech/flockpulse-web`, working branch `dev`.
Per the PIB/PDD, RSVP submission is conceptually a Member-facing action intended for the mobile app. The mobile (Expo) repo does not exist yet. This DIP builds the backend contract only — migration + Next.js Route Handler — in the shared web repo, consistent with how EPIC-1/2/3 backend logic (auth, RBAC, event lifecycle) was already implemented without a corresponding mobile screen. No RSVP UI is in scope here. A future mobile-UI DIP for FP-16/FP-17 remains blocked until the mobile repo is created — do not attempt to build any UI as part of this DIP.
Grounding Check
Checked against PDD/Engineering Spec §4 invariants and current schema state (verified directly against uploaded migrations 000000–000006):

1. RSVP is intent-only (invariant Rule 1): Confirmed no attendance-confirmation table exists yet in any migration. This DIP creates `rsvps` as a fully standalone table — no FK, trigger, or join touches any future `attendance` or `member_attendance_reports` table. That separation must remain true after this DIP; do not add speculative columns anticipating EPIC-5/6.
2. Tenant isolation (invariant Rule 3): `tenant_id` is derived server-side from `get_tenant_id()` (JWT claim), never from the client body — matches the established pattern in every prior migration.
3. Cross-tenant referential safety: A plain `REFERENCES events(id)` / `REFERENCES members(id)` FK does not verify the referenced row belongs to the same tenant as the RSVP row — a bug class distinct from missing RLS. This DIP adds an explicit `BEFORE INSERT OR UPDATE` trigger that validates `event.tenant_id = NEW.tenant_id` and `member.tenant_id = NEW.tenant_id`, following the same defense-in-depth spirit as the `assignments_typed_fk_check` remediation in FP-REMEDIATION-1. This is the same class of gap flagged (for a different table) in FP-43 — do not skip it here just because it's not the ticket that named it.
4. Guard function reuse: `block_actions_on_cancelled_or_locked(event_id)` (from `20260629000005`) must be called and must return 422 with an `INVALID_STATE`-style error if true, per that migration's own documented contract.
5. Audit logging gap — flagged, not silently patched: Engineering Spec §6 requires RSVP create/update to be audited (`RSVP submissions and updates logged`). No `audit_logs` table exists in any migration (EPIC-10/WP-2 foundational work was never built, despite being Phase 1 in the Manifest's build order). Do not invent an ad-hoc audit table as a side effect of this DIP — that's out of scope and would fragment EPIC-10 when it's eventually built properly. Instead, leave an explicit code-level TODO hook (see Implementation Plan step 5) so this isn't silently forgotten.
6. No conflicts found between FP-16/FP-17's acceptance criteria and the PDD/PIB/BA Pack invariants. Proceed as scoped.
7. Jira hygiene note (not actionable in this DIP): EPIC-4 (FP-15) still shows "To Do" while FP-16/FP-17 show "In Progress" — same pattern already flagged for FP-5/8/11 in the prior session's manifest. Leave for the pending hygiene pass; do not change Jira status as part of this DIP.
Implementation Plan

1. Migration — create `rsvps` table with a DB-level CHECK mirroring the app-layer reason-required rule (defense in depth, not a substitute for the app-layer `RSVP_REASON_REQUIRED` error), a tenant-scoped upsert-target unique index, and the cross-tenant validation trigger described above. RLS: tenant-wide SELECT (matches the existing pattern on `events`/`event_attendees`), INSERT/UPDATE restricted to the authenticated user's own resolved `member_id` row.
2. Repository/service layer — `src/features/rsvps/`, following the existing `src/features/...` convention. Service function performs, in this order:
   * Resolve `tenant_id` and `member_id` from the authenticated session — never trust client-supplied values for either.
   * Confirm the member is an expected attendee of the event (row exists in `event_attendees` for this member + event). If not, reject — do not allow RSVP on an event the member wasn't targeted for.
   * Call `block_actions_on_cancelled_or_locked(event_id)`. If true, return 422 `INVALID_STATE`.
   * Validate `event.status IN ('SCHEDULED', 'ACTIVE')` AND `now() < event.start_datetime`. If not, return `RSVP_CLOSED`.
   * If `rsvp_status = 'NO'` and `rsvp_reason` is missing/empty, return `RSVP_REASON_REQUIRED`. `rsvp_status = 'YES'` must never require a reason.
   * Upsert into `rsvps` on `(tenant_id, event_id, member_id)`, setting `responded_at = now()`.
3. Route Handler — `POST /api/rsvps`, body `{ event_id, rsvp_status: 'YES' | 'NO', rsvp_reason?: string }`. Response shape per Engineering Spec §7: `{ id, event_id, member_id, rsvp_status, rsvp_reason, responded_at, is_late }`. `is_late` has no defined semantics in FP-16/FP-17's acceptance criteria or any open question — hardcode `false` and note this as an assumption in the PR description; do not invent lateness logic.
4. Error codes — reuse the shared error-code module if one already exists in the repo (check before creating); add `RSVP_REASON_REQUIRED`, `RSVP_CLOSED` if missing. Do not duplicate an existing error-shape convention.
5. Audit TODO hook — at the point where the upsert commits, add an explicit code comment: `// TODO(EPIC-10): write audit_logs entry (before/after RSVP state) once audit_logs table and audit.service exist — see Engineering Spec §6`. This is intentional scope discipline, not an oversight — do not build the audit table here.
6. Regression guard — confirm (and note in the PR description) that no code path in this DIP references, joins, or writes to any table named `attendance`, `member_attendance_reports`, or similar. This table doesn't exist yet, but the check costs nothing and documents the boundary explicitly for future reviewers.
Files to Create/Modify

* `supabase/migrations/20260629000007_rsvps.sql`
* `src/features/rsvps/rsvp.types.ts`
* `src/features/rsvps/rsvp.repository.ts`
* `src/features/rsvps/rsvp.service.ts`
* `src/app/api/rsvps/route.ts`
* Existing shared error-code file — extend only if `RSVP_REASON_REQUIRED` / `RSVP_CLOSED` are not already present
* `src/features/rsvps/__tests__/rsvp.service.test.ts` (or match whatever test convention already exists in `src/features/events/` — check first, mirror it)
Migration File
`supabase/migrations/20260629000007_rsvps.sql` — per Implementation Plan step 1. Local-only validation via Supabase CLI. Never run against remote/production directly.
Branch Name
`feature/FP-16-17-rsvp-submission`
Commit Message
`FP-16, FP-17: Implement RSVP submission with reason enforcement and tenant-scoped validation`
Pull Request Description
Implements STORY-4.1 (FP-16):

* ✅ Member can submit RSVP Yes or No before event start — enforced via `event.status IN ('SCHEDULED','ACTIVE')` + `now() < start_datetime` check (`RSVP_CLOSED` otherwise)
* ✅ Response stored with `responded_at` timestamp
* ✅ Latest RSVP overwrites previous — upsert on `(tenant_id, event_id, member_id)` via unique index
* ✅ RSVP never creates or modifies official attendance — confirmed no reference to any attendance table exists in this codebase; structurally impossible for this change to violate that boundary
Implements STORY-4.2 (FP-17):

* ✅ RSVP No without reason rejected with `RSVP_REASON_REQUIRED` (app layer, primary path) + DB CHECK constraint (defense-in-depth, secondary path)
* ✅ Reason stored with the RSVP record (`rsvp_reason` column)
* ✅ RSVP Yes does not require a reason — CHECK constraint and app validation both permit null `rsvp_reason` when `rsvp_status = 'YES'`
Also included (not separately ticketed, but load-bearing):

* First live caller of `block_actions_on_cancelled_or_locked()` (built in FP-13, previously unused) — wired per that migration's documented contract
* Cross-tenant referential safety trigger on `rsvps` (event/member tenant match), same defense-in-depth class as the `assignments_typed_fk_check` remediation
* Explicit TODO hook flagging the missing `audit_logs` table rather than silently skipping the Engineering Spec §6 audit requirement or building an out-of-scope audit table
Known assumptions (flag for review):

* `is_late` field in the response is hardcoded `false` — no lateness semantics are defined anywhere in the current spec/ACs/open-questions
* Leader/Admin RSVP-context read access uses the same blanket tenant-scoped SELECT policy as `events`; no separate confirmation-screen-specific policy was added since that's EPIC-6 scope
Jira Linkage

* PDEEpicID: FP-15 (EPIC-4 — RSVP Management) — currently "To Do" in Jira while children are "In Progress"; pre-existing hygiene gap, not caused by this DIP
* PDEStoryID: FP-16 (STORY-4.1 — Submit RSVP Response)
* PDEStoryID: FP-17 (STORY-4.2 — Enforce RSVP No Reason Requirement)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-16-FP-17.md` before any other work. Create the feature branch, apply the migration locally via `supabase db reset` (or `migration up`) and confirm it runs cleanly, implement the application code, commit, push, and open the PR against `dev` using `gh pr create --base dev`.
Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it, and merge manually.

Implementation Notes (executor observations, not part of original DIP)
- No shared error-code module exists in the repo — error codes are inline strings throughout. No new module created; codes added inline following the established pattern.
- No test files exist anywhere in src/features/ — no test convention to mirror. rsvp.service.test.ts not created; noted in PR description.
- Migration numbered 000007 (confirmed at runtime: highest on dev after PR#7 merge was 000006).
- No attendance, member_attendance_reports, or similar table referenced anywhere in this DIP's code — regression boundary confirmed.
