# FP-48 — Audit Logging: audit_logs Table and Atomic Audit Writes

Branch: `feature/FP-48-audit-logs`
Migration: `20260629000017_audit_logs.sql`
Date: 2026-07-03
Tester: CC (manual DB inspection + full regression)

---

### Group 1 — Migration correctness

| # | Check | Result |
|---|-------|--------|
| 1.1 | `audit_logs` table created with correct schema (`id, tenant_id, entity_type, entity_id, action, actor_id, before_value, after_value, created_at`) | PASS |
| 1.2 | `actor_id` is plain UUID (no FK) — preserves actor permanently even after member deletion | PASS |
| 1.3 | Indexes on `(tenant_id, entity_type, entity_id)` and `(tenant_id, actor_id)` created | PASS |
| 1.4 | Cross-tenant trigger on `actor_id` fires on INSERT | PASS |
| 1.5 | `REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, service_role` applied | PASS |
| 1.6 | UPDATE trigger (`block_audit_log_update`) fires — UPDATE blocked regardless of grants | PASS |
| 1.7 | RLS enabled — SELECT policy for Admin only, no INSERT/UPDATE/DELETE policies | PASS |
| 1.8 | `write_audit_log()` shared helper created | PASS |

### Group 2 — Immutability (verified against service_role)

| # | Check | Result |
|---|-------|--------|
| 2.1 | UPDATE via service_role client → `permission denied for table audit_logs` | PASS |
| 2.2 | DELETE via service_role client → `permission denied for table audit_logs` (code 42501) | PASS |

Both confirmed via `scripts/test-fp48-audit-logs.ts` tests 1.1 and 1.2.

### Group 3 — Regression: all prior scripts

All scripts verified clean after RSVP upsert and self-report Yes paths rewired to SQL functions.

| Script | Tests | Result |
|--------|-------|--------|
| `test-smoke-rsvp-selfreport.ts` | 4/4 | PASS |
| `test-fp51-rls-recursion.ts` | 18/18 | PASS |
| `test-fp49-rls-isolation.ts` | 9/9 | PASS |
| `test-fp23-25-gaps.ts` | 3/3 | PASS |
| `test-list-pending-confirmations.ts` | 3/3 | PASS |
| `test-fp29-30-43-formation.ts` | 17/17 | PASS |

**Total prior-script regression: 54/54 PASS**

### Group 4 — Audit row content (scripts/test-fp48-audit-logs.ts — 10/10 PASS)

| # | Check | Result |
|---|-------|--------|
| 4.1 | RSVP YES → `audit_logs` row: `entity_type=rsvp`, `action=create`, `actor_id=member`, `before_value=null`, `after_value` populated | PASS |
| 4.2 | RSVP NO upsert → `action=update`, `before_value.rsvp_status=YES`, `after_value.rsvp_status=NO` | PASS |
| 4.3 | self_report Yes → `entity_type=self_report`, `action=create`, `actor_id=member`, `before_value=null` | PASS |
| 4.4 | submit_self_report_no → two rows: `self_report/create actor=member` + `attendance/auto_resolve actor=NULL` | PASS |
| 4.5 | leader CONFIRM → two rows: `self_report/confirm actor=leader` + `attendance/leader_confirm actor=leader` | PASS |
| 4.6 | admin_override (first insert, no prior row) → `before_value=null` | PASS |
| 4.7 | admin_override (second call, ON CONFLICT) → `before_value=prior row`, before.attendance_status matches prior state | PASS |
| 4.8 | createEvent → `entity_type=event`, `action=create`, `actor_id=null`, `before_value=null`, `after_value` populated | PASS |

### Design decisions flagged in migration

- `created_at` used instead of spec's literal `timestamp` column name (shadows SQL type name — deliberate deviation)
- `actor_id` is a plain UUID, no FK — `ON DELETE SET NULL` would conflict with UPDATE immutability trigger; permanent preservation is better audit behavior anyway
- DELETE immutability relies on REVOKE (not trigger) — allows postgres-superuser cascade deletes from tenant cleanup; UPDATE trigger catches the more dangerous silent-mutation case
- No RLS INSERT policy — audit_logs writable only through SECURITY DEFINER functions
- `upsert_rsvp_with_audit` uses `RETURNS SETOF rsvps` (not `RETURNS TABLE`) — PL/pgSQL output column names would shadow SQL column names in `ON CONFLICT (tenant_id, ...)` conflict target, causing 42702 ambiguity

### Out of scope (documented in PR)

- Event cancel audit: no cancel endpoint exists anywhere in the codebase. Future story implementing cancellation must add its own audit hook.
- updateEvent audit: `actorMemberId` is optional and passes `null` until a route layer exists — audit row records the event mutation but actor is null. Correct behavior for now.
