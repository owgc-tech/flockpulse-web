# DIP-FP-113-web

### Story Summary

Expands the role model from a flat three-value enum (`ADMIN`/`LEADER`/`MEMBER`) to seven values across the same two ranks: Admin-tier gains `SR_COORDINATOR`, `COORDINATOR`, `COMMUNITY_SERVANT` (identical access to `ADMIN`); Leader-tier gains `PASTORAL_LEADER`, permanently coexisting alongside `LEADER` with identical access. This is the foundational piece FP-114 (web permission scoping) and FP-115 (mobile event creation) both depend on.

### Repo Target

Web only. Mobile requires no changes — confirmed its role checks already use the inclusive `role !== 'MEMBER'` pattern, not exact-match comparisons against `'ADMIN'`/`'LEADER'`.

### Grounding Check

* Confirmed live: `src/lib/auth/middleware.ts` defines `type Role = 'ADMIN' | 'LEADER' | 'MEMBER'` and `ROLE_HIERARCHY: Record<Role, number> = { ADMIN: 3, LEADER: 2, MEMBER: 1 }`. `requireRole(minimumRole)` compares by rank (`ROLE_HIERARCHY[ctx.role] < ROLE_HIERARCHY[minimumRole]`), not exact string — meaning once this type and map are widened, every existing `requireRole('ADMIN')`/`requireRole('LEADER')` call site across the API continues working correctly with zero changes, since e.g. `SR_COORDINATOR` at rank 3 will correctly satisfy a `requireRole('ADMIN')` check.
* Confirmed real risk, with concrete evidence: RLS policies compare roles as literal strings — `AND m.role = 'ADMIN'` appears six times in `20260629000003_remediate_rbac_and_assignments.sql` alone. This DIP could not exhaustively search every migration file for this pattern — GitHub's API rate-limited heavily during this session's grounding. CC must run a full local grep (`grep -rn "role = '" supabase/migrations/`, and equivalently for `'LEADER'`) as the actual first implementation step, treating what's found here as a confirmed minimum, not a complete list.
* Not confirmed, flagged rather than assumed: whether `members.role` is `TEXT` with a `CHECK` constraint (the established pattern for every other enum-like column in this schema — `gender`, `marital_status`, `self_report_status` all follow this) or a native Postgres `ENUM` type. Every other precedent points to `TEXT` + `CHECK`, but this DIP could not directly confirm the original column definition. Verify before writing the migration — the two approaches need different SQL (`DROP CONSTRAINT`/`ADD CONSTRAINT` vs `ALTER TYPE ... ADD VALUE`, and the latter has real transactional restrictions worth knowing about if it turns out to apply).
* The fix for RLS: a single shared SQL function, `is_admin_tier(role_value TEXT) RETURNS BOOLEAN` (and `is_leader_tier_or_above(role_value TEXT) RETURNS BOOLEAN`), mirroring the app layer's `ROLE_HIERARCHY` exactly. Every RLS policy currently comparing `role = 'ADMIN'` gets rewritten to call this function instead — one place to maintain both layers' logic going forward, not scattered literals.
* Scope boundary, deliberately: this DIP only makes the schema and permission-checking layer support the new roles correctly. It does not change who can log into web (still `ADMIN`-only today) or add any new UI — that's FP-114's job entirely. This DIP's success criterion is "existing behavior for existing accounts is providably unchanged, and new role values are now valid and correctly ranked" — nothing user-facing changes yet.
* JWT claim write path: wherever `app_metadata.role` gets set (invitation creation, registration completion) needs checking for a hardcoded `ADMIN`/`LEADER`/`MEMBER` dropdown or type that would need widening too — not yet located in this grounding pass, first thing to check during implementation.

### Implementation Plan

1. Local grep audit first (per Grounding Check) — enumerate every literal `role = 'ADMIN'` / `role = 'LEADER'` occurrence across all migrations before writing any new SQL, so the actual scope is known rather than assumed from this DIP's partial findings.
2. Migration: widen `members.role`'s constraint (pending the CHECK-vs-ENUM confirmation) to accept all seven values. Add `is_admin_tier(role_value TEXT)` and `is_leader_tier_or_above(role_value TEXT)` SQL functions.
3. Rewrite every RLS policy found in step 1 to call the new shared functions instead of literal string comparisons.
4. `src/lib/auth/middleware.ts`: widen `Role` type to all seven values; widen `ROLE_HIERARCHY` to assign matching ranks (`SR_COORDINATOR`/`COORDINATOR`/`COMMUNITY_SERVANT`: 3, `PASTORAL_LEADER`: 2).
5. Check and widen the JWT-claim write path (invitation/registration) per the Grounding Check's flagged gap.
6. Regression coverage: confirm existing `ADMIN`/`LEADER`/`MEMBER` accounts behave identically before and after — this is a widening, not a behavior change for current data.

### Files to Create/Modify

```
supabase/migrations/<new>_expand_role_model.sql     (new)
src/lib/auth/middleware.ts                          (modified)
[JWT claim write path — exact file(s) TBD at implementation]

```

### Migration Files (if applicable)

Per Implementation Plan steps 1–3 — written and applied locally first, never directly to remote, per standing convention.

### Branch Name

`feature/FP-113-web-role-model-expansion`

### Commit Message

`FP-113-web: expand role model — Admin-tier synonyms + Pastoral Leader, RLS via shared rank functions`

### Pull Request Description

* Adds `SR_COORDINATOR`, `COORDINATOR`, `COMMUNITY_SERVANT` (Admin-tier) and `PASTORAL_LEADER` (Leader-tier, permanently coexisting with `LEADER`).
* Every RLS policy doing literal `role = 'ADMIN'` comparison now calls a shared `is_admin_tier()` function instead — single source of truth alongside the app layer's `ROLE_HIERARCHY`.
* No behavior change for existing `ADMIN`/`LEADER`/`MEMBER` accounts; no new UI; login gate still `ADMIN`-only (FP-114's scope).

### Jira Linkage

* PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control)
* PDEStoryID: FP-113

### Stop Point

Save this DIP verbatim to `documentation/dips/DIP-FP-113-web.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Merge once reviewed here; test against deployed `dev` afterward.

Include full diffs for every file in the completion report per Section 5, rule 12 — not a summary, and explicitly include the full local grep output from step 1 so the actual RLS scope is visible, not just asserted.
