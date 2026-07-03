# FP-49 — RLS Verification Checklist

## Scope

Covers the three areas explicitly left open after FP-51:
1. Cross-tenant isolation — Tenant A user cannot read or write Tenant B data
2. Leader scope on `attendance` — leader can only confirm their assigned members
3. Admin override — admin can confirm any member in own tenant; cannot cross-tenant

Test script: `scripts/test-fp49-rls-isolation.ts`
Branch: `feature/FP-49-cross-tenant-and-scope-verification`

---

## Group 1 — Cross-tenant isolation

Two real Supabase Auth users across two real tenants. Tenant A user authenticated with anon-key + JWT throughout.

| # | Test | Expected | Result |
|---|---|---|---|
| 1.1 | Tenant A user SELECT from `members` — filtered by Tenant B member ID | 0 rows (RLS USING filters) | **PASS** |
| 1.2 | Tenant A user SELECT from `member_attendance_reports` — filtered by Tenant B report ID | 0 rows (RLS USING filters) | **PASS** |
| 1.3 | Tenant A user INSERT into `rsvps` with `tenant_id = TENANT_B` (Tenant B event + member as FK targets) | 42501 — `rsvps_insert_self` WITH CHECK `tenant_id = get_tenant_id()` fails | **PASS** |
| 1.4 | Tenant A user INSERT into `member_attendance_reports` with `tenant_id = TENANT_B` (Tenant B FK targets) | 42501 — `self_reports_insert_self` WITH CHECK `tenant_id = get_tenant_id()` fails | **PASS** |

**All 4 cross-tenant isolation tests pass.**

Note on test structure for 1.3/1.4: all FK values (event_id, member_id) reference Tenant B's own data to let the cross-tenant referential-safety trigger pass, making RLS WITH CHECK the actual backstop under test. Defense-in-depth is real regardless — both the trigger and RLS independently deny cross-tenant writes.

---

## Group 2 — Leader scope on `attendance`

One tenant, one leader, two members. Leader has an `assignments` row for Member A only (not Member B). One event (status `SCHEDULED`) with `PENDING_CONFIRMATION` self-reports for both members.

| # | Test | Expected | Result |
|---|---|---|---|
| 2.1 | Leader confirms Member A (assigned to leader) via `leader_confirm` | Success — leader has assignment for Member A | **PASS** |
| 2.2 | Leader confirms Member B (NOT assigned to leader) via `leader_confirm` | **Denied** — leader has no assignment for Member B | **GAP — INSERT SUCCEEDED** |

**Predicted gap confirmed.**

`attendance_leader_insert` WITH CHECK:
```sql
(tenant_id = get_tenant_id())
AND (confirmation_type IN ('leader_confirm', 'leader_reject'))
AND caller_member_is_leader_or_admin(confirmed_by)
```

`caller_member_is_leader_or_admin(confirmed_by)` only checks that `confirmed_by` maps to the caller's own member record with role `LEADER`/`ADMIN`. It does **not** verify that the row's `member_id` is in the leader's `assignments` set. A leader can confirm any member in their tenant.

**Tech-debt ticket filed: [FP-52](https://owgctech.atlassian.net/browse/FP-52)** — do not fix inline. Requires a new DIP and migration.

---

## Group 3 — Admin override

Same tenant. Admin confirmed Member B (not their own assignment — admins have none) via `admin_override`. Admin in Tenant A attempted cross-tenant write into Tenant B via `admin_override`.

| # | Test | Expected | Result |
|---|---|---|---|
| 3.1 | Admin confirms Member B with `admin_override` | Success — admin unrestricted within tenant | **PASS** |
| 3.2 | Tenant A admin INSERT into `attendance` with `tenant_id = TENANT_B` (Tenant B FK targets) | 42501 — `attendance_admin_upsert` WITH CHECK `tenant_id = get_tenant_id()` fails | **PASS** |

**Both admin override tests pass.**

---

## Overall Results

| Group | Tests | Passed | Failed | Gaps |
|---|---|---|---|---|
| 1 — Cross-tenant isolation | 4 | 4 | 0 | 0 |
| 2 — Leader scope | 2 | 1 | 1 | **1 (FP-52)** |
| 3 — Admin override | 2 | 2 | 0 | 0 |
| **Total** | **8** | **7** | **1** | **1** |

**7/8 tests pass. 1 confirmed policy gap (test 2.2) — filed as [FP-52](https://owgctech.atlassian.net/browse/FP-52). No inline fix per DIP stop protocol.**

---

## Previously verified (FP-51 — not re-run here)

FP-51's 18-test suite covers:
- Members SELECT/INSERT/UPDATE (admin vs non-admin)
- Groups INSERT (admin vs non-admin)
- Assignments INSERT/UPDATE (admin vs non-admin)
- RSVPs INSERT/UPDATE (self vs other member)
- member_attendance_reports INSERT (self vs other member)

All 18 passed. See `documentation/test-plans/FP-51-rls-recursion-fix-checklist.md`.
