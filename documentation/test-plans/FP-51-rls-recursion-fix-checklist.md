# FP-51 — RLS Recursion Fix Test Checklist

## Audit — Policies with inline members subquery (complete list)

All 11 affected policies identified across 5 migrations. Three distinct check patterns:

| Policy | Table | Pattern |
|---|---|---|
| `members_select_admin_all` | members | admin check |
| `members_insert_admin` | members | admin check |
| `members_update_admin` | members | admin check |
| `groups_insert_admin` | groups | admin check |
| `assignments_insert_admin` | assignments | admin check |
| `assignments_update_admin` | assignments | admin check |
| `attendance_admin_upsert` | attendance | admin check |
| `rsvps_insert_self` | rsvps | self-member check |
| `rsvps_update_self` | rsvps | self-member check |
| `self_reports_insert_self` | member_attendance_reports | self-member check |
| `attendance_leader_insert` | attendance | leader/admin on specific member id |

## Migration (`000013_fix_rls_recursion.sql`)

### SECTION 1 — SECURITY DEFINER helper functions created

- [x] `caller_is_admin()` — queries members without triggering members' own RLS
- [x] `caller_owns_member(p_member_id UUID)` — verifies caller's auth.uid() owns the member row
- [x] `caller_member_is_leader_or_admin(p_member_id UUID)` — verifies caller's member is LEADER/ADMIN

### SECTIONS 2–7 — All 11 policies repointed

- [x] `members_select_admin_all` repoints to `caller_is_admin()`
- [x] `members_insert_admin` repoints to `caller_is_admin()`
- [x] `members_update_admin` repoints to `caller_is_admin()`
- [x] `groups_insert_admin` repoints to `caller_is_admin()`
- [x] `assignments_insert_admin` repoints to `caller_is_admin()`
- [x] `assignments_update_admin` repoints to `caller_is_admin()`
- [x] `rsvps_insert_self` repoints to `caller_owns_member(member_id)`
- [x] `rsvps_update_self` repoints to `caller_owns_member(member_id)`
- [x] `self_reports_insert_self` repoints to `caller_owns_member(member_id)`
- [x] `attendance_leader_insert` repoints to `caller_member_is_leader_or_admin(confirmed_by)`
- [x] `attendance_admin_upsert` repoints to `caller_is_admin()`

## Part 1 — FP-50 re-verification (read paths that previously failed with 42P17)

Run via `scripts/test-fp51-rls-recursion.ts`.

| # | Test | Result |
|---|---|---|
| 1 | `members` SELECT — non-admin | **PASS** (1 row) |
| 2 | `members` SELECT — admin | **PASS** (1 row) |
| 3 | `attendance` SELECT — non-admin | **PASS** (0 rows) |
| 4 | `attendance` SELECT — admin | **PASS** (0 rows) |

## Part 2 — Write-path tests (new surface, one per audited write policy)

| # | Policy | Test | Result |
|---|---|---|---|
| 5 | `members_insert_admin` | Admin INSERT → succeeds | **PASS** |
| 6 | `members_insert_admin` | Non-admin INSERT → 42501 denied | **PASS** |
| 7 | `members_update_admin` | Admin UPDATE → succeeds | **PASS** |
| 8 | `groups_insert_admin` | Admin INSERT → succeeds | **PASS** |
| 9 | `groups_insert_admin` | Non-admin INSERT → 42501 denied | **PASS** |
| 10 | `assignments_insert_admin` | Admin INSERT → succeeds | **PASS** |
| 11 | `assignments_insert_admin` | Non-admin INSERT → 42501 denied | **PASS** |
| 12 | `assignments_update_admin` | Admin UPDATE → succeeds | **PASS** |
| 13 | `rsvps_insert_self` | Member inserts own RSVP → succeeds | **PASS** |
| 14 | `rsvps_insert_self` | Member inserts other member's RSVP → 42501 denied | **PASS** |
| 15 | `rsvps_update_self` | Member updates own RSVP → succeeds | **PASS** |
| 16 | `rsvps_update_self` | Member updates another member's RSVP → 0 rows affected, row unchanged (USING filtered) | **PASS** |
| 17 | `self_reports_insert_self` | Member inserts own self-report → succeeds | **PASS** |
| 18 | `self_reports_insert_self` | Member inserts other member's self-report → 42501 denied | **PASS** |

**Total: 18/18 passed, 0 failed.**

**Note on UPDATE denial behavior (test 16):** For USING-guarded UPDATE policies, PostgREST returns HTTP 200 with 0 rows affected when the caller lacks access — the row is invisible to them, so the update silently matches nothing. Test 16 confirms the row was not modified by checking via service role after the attempt. This differs from WITH CHECK violations, which do raise 42501. Both are correct RLS behavior for their respective clause types.

## Out of scope (by design)

- `attendance_leader_insert` write-path test (requires OPEN event + self-report fixture state) — FP-49's scope
- `attendance_admin_upsert` write-path test (same reason) — FP-49's scope
- FP-49's full scope-matrix testing (leader-assignment checks, role restrictions, predicted gap) — separate story, separate DIP

## fpdb-dev

Same bug confirmed on remote — `get_tenant_id()` returns null for real authenticated users on `https://hqyttwmlefoijquhwtkg.supabase.co`. Both FP-50 and FP-51 migrations must be pushed to remote via `supabase db push` after merge.
