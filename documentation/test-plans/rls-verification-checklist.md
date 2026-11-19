# RLS Verification Checklist

Covers the complete RLS verification arc across FP-49, FP-50, FP-51, and FP-52.

---

## FP-51 — Recursion fix regression (18 tests)

Migration `000013`. Test script: `scripts/test-fp51-rls-recursion.ts` (gitignored). Full results in `documentation/test-plans/FP-51-rls-recursion-fix-checklist.md`.

**18/18 passed on FP-51 branch. Re-run on FP-52 branch: 18/18 passed — no regression.**

---

## FP-49 — Cross-tenant isolation, leader scope, admin override (9 tests)

Test script: `scripts/test-fp49-rls-isolation.ts` (gitignored). First run on `feature/FP-49-cross-tenant-and-scope-verification` confirmed 7/8 pass and one gap (test 2.2). Re-run on `feature/FP-52-fix-attendance-leader-scope` after FP-52 fix: 9/9 pass (test 2.2 now correctly denied, test 2.3 is new).

### Group 1 — Cross-tenant isolation

Two real tenants, two real Auth users. Tenant A user authenticated throughout.

| # | Test | Expected | Result |
|---|---|---|---|
| 1.1 | Tenant A user SELECT — cannot see Tenant B member row | 0 rows (RLS USING filters) | **PASS** |
| 1.2 | Tenant A user SELECT — cannot see Tenant B self-report row | 0 rows (RLS USING filters) | **PASS** |
| 1.3 | Tenant A user INSERT into `rsvps` with `tenant_id = TENANT_B` | 42501 — `rsvps_insert_self` WITH CHECK `tenant_id = get_tenant_id()` | **PASS** |
| 1.4 | Tenant A user INSERT into `member_attendance_reports` with `tenant_id = TENANT_B` | 42501 — `self_reports_insert_self` WITH CHECK `tenant_id = get_tenant_id()` | **PASS** |

Note on test structure for 1.3/1.4: all FK values reference Tenant B's own data to let the cross-tenant referential-safety trigger pass cleanly, making RLS WITH CHECK the actual backstop under test.

### Group 2 — Leader scope on `attendance`

One tenant, leader assigned to Member A only (not Member B). One `SCHEDULED` event, `PENDING_CONFIRMATION` self-reports for both.

| # | Test | Expected | Result |
|---|---|---|---|
| 2.1 | Leader confirms Member A (assigned) via `leader_confirm` | Success | **PASS** |
| 2.2 | Leader confirms Member B (NOT assigned) via `leader_confirm` | 42501 denied | **PASS** (was GAP on FP-49 branch — fixed by FP-52) |
| 2.3 | Admin confirms Member B (no assignment) via `leader_confirm` | Success — admin bypass | **PASS** (new test, DIP-FP-52 Grounding Check item 6) |

### Group 3 — Admin override

| # | Test | Expected | Result |
|---|---|---|---|
| 3.1 | Admin confirms Member B with `admin_override` | Success — admin unrestricted within tenant | **PASS** |
| 3.2 | Tenant A admin INSERT into `attendance` with `tenant_id = TENANT_B` | 42501 — `attendance_admin_upsert` WITH CHECK `tenant_id = get_tenant_id()` | **PASS** |

---

## FP-52 — attendance_leader_insert gap (confirmed and fixed)

### Gap confirmed (FP-49 original run)

`attendance_leader_insert` WITH CHECK before FP-52:
```sql
(tenant_id = get_tenant_id())
AND (confirmation_type IN ('leader_confirm', 'leader_reject'))
AND caller_member_is_leader_or_admin(confirmed_by)
```

`caller_member_is_leader_or_admin(confirmed_by)` verified caller role only — never checked that `member_id` was in the caller's `assignments` set. Test 2.2 confirmed a leader could insert `leader_confirm` for any tenant member.

Tech-debt ticket filed: [FP-52](https://owgctech.atlassian.net/browse/FP-52).

### Fix (migration `000014`)

New `caller_is_leader_for_member(p_member_id UUID)` SECURITY DEFINER function queries `assignments` for an active `LEADER`-type link between the caller's member record and `p_member_id`, tenant-scoped and soft-delete-aware.

Updated `attendance_leader_insert` WITH CHECK:
```sql
(tenant_id = get_tenant_id())
AND (confirmation_type IN ('leader_confirm', 'leader_reject'))
AND caller_member_is_leader_or_admin(confirmed_by)
AND (caller_is_admin() OR caller_is_leader_for_member(member_id))
```

Admin bypass (`caller_is_admin()`) preserves additive-RBAC (Admin ⊇ Leader, STORY-6.2). The normal shipped confirm/reject flow calls `resolve_leader_confirmation()` which is SECURITY DEFINER and bypasses RLS; the bypass here is a defense-in-depth guard for direct-DB access.

### Route-path discrepancy in FP-52 ticket

FP-52's Background section cited `app/api/attendance/leader/route.ts` — this file does not exist. The correct route is `app/api/confirmations/[selfReportId]/route.ts`. Minor factual error in the ticket; no impact on the fix.

### Fix verification results

| Test | Result |
|---|---|
| FP-51 18 tests (regression) | **18/18 PASS** |
| 2.1 Leader confirms assigned member | **PASS** |
| 2.2 Leader confirms non-assigned member (gap, now fixed) | **PASS (42501 denied)** |
| 2.3 Admin confirms non-assigned member via leader_confirm (admin bypass) | **PASS (success)** |
| 3.1 Admin admin_override unrestricted within tenant | **PASS** |
| 3.2 Admin cross-tenant write denied | **PASS** |

**All tests pass. FP-52 closed.**
