DIP-FP-96-web
Not covered — deliberately excluded: The actual local-notification scheduling, permissions, and mobile UI are FP-96's mobile-side work, covered in a follow-up `DIP-FP-96-mobile.md`. This DIP is the backend prerequisite only — one new endpoint that returns everything a reminder needs in a single call.
Story Summary
FP-96's reminders need Course/Module/Talk names (with `alias` falling back to `name`) plus the Talk's description for Formation events, alongside basic event details. No existing endpoint returns this in one call — `GET /api/events/:id` only exposes the raw `talk_id` foreign key. Rather than have the mobile app chain three separate calls (talk → module → course) at the exact moment a notification is about to fire, this DIP adds one purpose-built endpoint that resolves the whole chain server-side.
Repo Target
Web (Next.js) — `owgc-tech/flockpulse-web`.
Grounding Check

* Confirmed live: `talks`, `modules`, and `courses` all follow the identical column pattern — `id, tenant_id, <parent_id>, name, alias, description, sequence_order, deleted_at, created_at, updated_at` — verified directly in all three repository files' `COLS` constants, not assumed from one and extrapolated to the others.
* Reusable lookups already exist and need no changes: `getCourse(id, tenantId)`, `getModule(id, tenantId)`, `getTalk(id, tenantId)` (formation repository layer) and `getEventById(id, tenantId)` (events service, already returns `talk_id` and `effective_status`). This DIP only adds a thin new function that chains these existing reads — no new repository code, no new tables.
* Scope, per direct clarification: only the Talk's `description` is needed, not the Module's or Course's — those levels contribute their resolved name only (alias-or-name), not their description text.
* No new access restriction: `GET /api/events/:id` today has no attendee-scoping check — any authenticated tenant member can fetch any event's details via `withAuth` alone, no role requirement. This new endpoint follows the same precedent rather than introducing a stricter rule inconsistent with its sibling endpoint.
* Cross-tenant safety / atomicity / canonical error codes: not applicable — no writes, no new tables; `NOT_FOUND` (already the established code for a missing/cross-tenant event) covers the only real failure case.
Implementation Plan

1. In `src/features/events/service.ts`, add `getEventReminderContext(eventId: string, tenantId: string)`:
   * Call `getEventById(eventId, tenantId)` (throws `NOT_FOUND` already, nothing new to handle here).
   * If `talk_id` is null, return `{ ...event, formation: null }`.
   * If `talk_id` is set: `getTalk(talk_id, tenantId)` → then `getModule(talk.module_id, tenantId)` → then `getCourse(module.course_id, tenantId)`. Resolve each name as `row.alias || row.name`. Return `{ ...event, formation: { course_name, module_name, talk_name, talk_description: talk.description } }`.
   * If any of the three formation lookups unexpectedly returns null (a soft-deleted or orphaned parent), treat it the same as `talk_id` being absent — omit `formation` cleanly rather than erroring, consistent with FP-96's own AC ("If a Formation event has no Talk assigned yet... the section is omitted cleanly — no placeholder, no error").
2. New route `app/api/events/[id]/reminder-context/route.ts` — `GET`, plain `withAuth` (no role restriction, matching `GET /api/events/:id`'s existing precedent), calls `getEventReminderContext(id, ctx.tenantId)`, maps `NOT_FOUND` to 404 the same way the sibling route does.
Files to Create/Modify

```
app/api/events/[id]/reminder-context/route.ts     (new)
src/features/events/service.ts                    (modified — new function only)

```

Migration Files (if applicable)
None — reads existing tables only.
Branch Name
`feature/FP-96-web-reminder-context`
Commit Message
`FP-96-web: add event reminder-context endpoint with resolved Course/Module/Talk names`
Pull Request Description

* New `GET /api/events/:id/reminder-context` returns an event's core details plus, for Formation events, its resolved `course_name`/`module_name`/`talk_name` (alias-or-name) and the Talk's `description` — everything FP-96's mobile reminders need in one call, no client-side chaining across three endpoints.
* Non-Formation events (no `talk_id`) get `formation: null`, cleanly, no error.
* No changes to any existing endpoint or admin screen — purely additive.
Jira Linkage

* PDEEpicID: FP-31 (EPIC-8 — Notification System)
* PDEStoryID: FP-96 (backend prerequisite portion only)
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-96-web.md` and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against `dev` and stop. Merge once reviewed here and confirmed the diffs look right; test against the deployed `dev` Vercel environment afterward, per standard web-repo workflow.
Include full diffs for every file in the completion report per Section 5, rule 12 — not a summary.
