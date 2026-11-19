# DIP-FP-42

## Story Summary

Adds a new "Audit Logs" page to the web admin shell — query and filter existing audit log entries (`entity_type`, `entity_id`, `action`, `actor`, date range), tenant-scoped, Admin-tier access (which already includes Senior Coordinator as a synonym per FP-113). Purely a read/query feature — the write side (`write_audit_log()`) is already fully implemented and in active use across RSVP, self-report, event, and group actions.

## Repo Target

Web (Next.js) — owgc-tech/flockpulse-web. No mobile involvement — audit logs have always been admin-only.

## Grounding Check

- Confirmed live: `audit_logs(id, tenant_id, entity_type, entity_id, action, actor_id, before_value, after_value, created_at)` already exists (migration `20260629000017_audit_logs.sql`), with `actor_id` deliberately having no FK — "audit records preserve actor_id permanently (no nullification on member delete)," per the migration's own comment. This means actor-name resolution must handle the case where `actor_id` no longer matches any current member row — display something like "Deleted Member" or the raw id, not an error or a silent blank, same non-fatal-fallback principle already used for FP-120's booked-by lookup.
- Confirmed `write_audit_log()` is genuinely live and actively called from multiple existing flows (RSVP, self-report, event create/update, group CRUD) — STORY-10.1 is done, nothing to build on the write side.
- Confirmed existing indexes: `(tenant_id, entity_type, entity_id)` and `(tenant_id, actor_id)`. No index on `created_at` — the date-range filter (an explicit AC) needs one; add it rather than relying on the existing two.
- Confirmed a cross-tenant safety trigger already validates `actor_id` belongs to the same tenant on write — nothing needed there for the read side, but confirms `actor_id` is safe to join against `members` without a separate tenant check (a match found is guaranteed same-tenant already).
- RBAC: "Senior Coordinator or authorized admin roles" resolves to standard `isAdminTier()` gating — SR_COORDINATOR is already an Admin-tier synonym (FP-113), identical access to ADMIN. No new, narrower role check needed; reuse the same pattern already gating Members/Groups/Formation/Restore.
- No Section 4 invariant rules touched — this is read-only over already-correct, already-written audit data.

## Implementation Plan

1. Migration: `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(tenant_id, created_at);` — supports the date-range filter.
2. New `src/features/audit/audit.repository.ts` — `getAuditLogs(tenantId, { entityType?, entityId?, action?, actorId?, dateFrom?, dateTo? })`: query `audit_logs` filtered by the provided params, left-joined to `members` on `actor_id` for the actor's name, with the null/deleted-actor fallback from the Grounding Check.
3. New `src/features/audit/audit.service.ts` — thin pass-through (this feature has no RBAC scoping variance like Leader-vs-Admin does for Reports; it's simply Admin-tier-or-nothing, enforced at the route level).
4. New `app/api/audit-logs/route.ts` — GET, withAuth, requireRole at Admin-tier (`isAdminTier` gate, mirroring the existing pattern in e.g. `app/admin/members`'s route handlers).
5. New `app/admin/(shell)/audit-logs/page.tsx` + `AuditLogBrowser.tsx` — filter controls (entity type, entity id, action, actor, date range) + results table showing timestamp, entity, action, actor name (or fallback), and a way to inspect `before_value`/`after_value` (e.g., expandable JSON view per row — this is genuinely useful audit data, don't just hide it). Model the overall shape on `RsvpReportBrowser.tsx`/`AttendanceReportBrowser.tsx` from FP-37/FP-38 rather than inventing a third admin-page convention.
6. `AdminSidebar.tsx` — new "Audit Logs" nav entry, `adminOnly: true` (unlike Reports/Formation Progress, which are Leader-tier-reachable — this one is genuinely Admin-tier-only per the AC).

## Files to Create/Modify

```
supabase/migrations/[timestamp]_audit_log_created_at_index.sql   (new)
src/features/audit/audit.repository.ts                            (new)
src/features/audit/audit.service.ts                               (new)
app/api/audit-logs/route.ts                                       (new)
app/admin/(shell)/audit-logs/page.tsx                              (new)
app/admin/(shell)/audit-logs/AuditLogBrowser.tsx                   (new)
src/components/admin/AdminSidebar.tsx                              (modified — new nav entry)
```

## Migration Files

As detailed in Implementation Plan step 1 — one index, no schema changes, no new tables, no changes to the write side.

## Branch Name

`feature/FP-42-web-audit-log-query`

## Commit Message

`FP-42-web: add Audit Logs query page to admin shell`

## Pull Request Description

Maps to STORY-10.2's ACs: filterable by `entity_type`/`entity_id`/`action`/`actor_id`/date range; Admin-tier-only access (Senior Coordinator included via the existing Admin-tier-synonym rank system, no new role check); tenant-scoped (inherent to the existing `audit_logs.tenant_id` column plus explicit `.eq('tenant_id', ...)` in the repository query, since the service-role client bypasses RLS). No changes to the write side — `write_audit_log()` and all its existing callers are untouched.

## Jira Linkage

- PDEEpicID: FP-40
- PDEStoryID: FP-42

## Stop Point

Save this DIP verbatim to `documentation/dips/DIP-FP-42.md`. Full implementation (migration, repository/service, route, admin page, nav entry) — commit, push, and open the PR against `dev`. Do not merge — the user reviews, merges, then tests in the browser the same way as Reports.
