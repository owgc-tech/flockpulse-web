# FP-45 — Add event_types Table and FK Constraint on events.event_type_id
## Test Checklist

Branch: `feature/FP-45-event-types-fk`
Migration: `20260629000016_event_types_and_fk.sql`
Date: 2026-07-03
Tester: CC (manual DB inspection + full prior-script regression)

---

### Group 1 — Migration correctness

| # | Check | Result |
|---|-------|--------|
| 1.1 | `event_types` table created with correct schema (`id, tenant_id, name, code, deleted_at, created_at, updated_at`) | PASS |
| 1.2 | Partial unique index `(tenant_id, code) WHERE deleted_at IS NULL` created | PASS |
| 1.3 | `events_event_type_id_fkey` FK constraint exists on `events` | PASS |
| 1.4 | `validate_event_event_type_id` trigger fires on INSERT/UPDATE to events | PASS |
| 1.5 | RLS enabled on `event_types` — SELECT/INSERT/UPDATE only, no FOR ALL, no DELETE | PASS |

### Group 2 — Seed and backfill

| # | Check | Result |
|---|-------|--------|
| 2.1 | Seed inserts GENERAL type for both seed tenants (`...001`, `...002`) after `db reset` | PASS (verified via `SELECT count(*) FROM event_types` = 2) |
| 2.2 | Section 2 `INSERT ... SELECT FROM tenants` handles production case (runs post-tenant-creation in prod) | PASS by design |
| 2.3 | Section 3 backfill UPDATE repoints stale `event_type_id` values before FK applied | PASS — no pre-existing rows in local; logic verified correct |

### Group 3 — Regression: prior test scripts with events rows

All scripts previously used `gen_random_uuid()` for `event_type_id`. Each was updated to look up or insert the tenant's GENERAL type and substitute its real ID.

| Script | Tests | Result |
|--------|-------|--------|
| `test-fp29-30-43-formation.ts` | 17/17 | PASS |
| `test-fp51-rls-recursion.ts` | 18/18 | PASS |
| `test-smoke-rsvp-selfreport.ts` | 4/4 | PASS |
| `test-fp23-25-gaps.ts` | 3/3 | PASS |
| `test-list-pending-confirmations.ts` | 3/3 | PASS |
| `test-fp49-rls-isolation.ts` | 9/9 | PASS |

**Total prior-script regression: 54/54 PASS**

---

### Group 4 — App-layer validation (`validateEventTypeId`)

| # | Check | Result |
|---|-------|--------|
| 4.1 | Valid `event_type_id` accepted — `service_role` reads `event_types` via `serviceClient()` | PASS |
| 4.2 | Invalid `event_type_id` (non-existent UUID) → `INVALID_TARGET` thrown by `createEvent` | PASS |

Confirmed via `scripts/test-fp45-validate-event-type.ts` (2/2 PASS).

---

### Security fix (post-initial-PR review)

`anon` grant removed from migration 000016 Section 5. Original: `GRANT SELECT ON event_types TO anon, authenticated`. Fixed to `GRANT SELECT ON event_types TO authenticated`, consistent with migration 000011's deliberate design (no unauthenticated endpoints). `service_role` access is covered by `ALTER DEFAULT PRIVILEGES` in 000011 — no explicit grant needed.

---

### Flagged assumptions (not tested, carried into PR)

- `event_types` rows auto-seeded for tenants created before this migration only — new-tenant seeding is a known gap, deferred to future tenant-onboarding work.
- AC #5 CRUD decision: Admin CRUD for `event_types` not built in this DIP. Deferred until something real requires custom event types.
- App-layer `INVALID_TARGET` validation added to `createEvent` only (`updateEvent` doesn't accept `event_type_id` as an updatable field — DB trigger covers the direct-DB bypass path for that table).
