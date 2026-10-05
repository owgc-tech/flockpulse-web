### DIP — FP-222-adj-1 (Web) v3: what changed, which task, who refused, and a Needs Attention marker on the web events list

### Not covered — deliberately excluded
- Mobile UI: the mobile follow-up (showing who refused on the detail screen) is written after this ships.
- Recently Modified on the web events list: the last-viewed tracking is recorded only from the mobile app, so the web has nothing to compare against.
- Any new table or trigger: this change reads the existing audit log and refusal data. If you find you need a migration, stop and explain why in the PR instead of adding one.
- Old and new VALUES of a changed field: labels only. Pruning or redacting audit entries. Any change to what bumps events.version.

### Story Summary
Part 1 of FP-222 (merged) added needs_attention and is_modified to the event list and detail responses, the per-member last-viewed tracking, and POST /api/events/:id/view. A first device test showed four gaps. (1) The mobile card cannot say WHAT changed or WHICH task is refused: add modified_fields and needs_attention_tasks to the same responses, built on the existing audit log and refusal data. (2) The mobile detail screen cannot say WHO refused, unlike the web event page: carry the refusing people's names on the event's task assignments, for the event owner and Admins only. (3) The web admin events list shows nothing for an event with outstanding refusals, only the web detail page does: add a Needs attention marker to the web list. (4) The view endpoint answers 204 with no body, which the mobile app's network helper cannot read: return the standard JSON envelope instead.

### Repo Target
Web (Next.js). Branch from current dev.

### Grounding Check
Verified this session, not assumed (re-verify; read the merged part 1 code first: the flag computation in src/features/events/service.ts, event_member_views and last_seen_version, the view route app/api/events/[id]/view/route.ts, the response types in src/features/events/event.types.ts):
- update_event_with_audit (latest definition, migration 20260810000069) bumps events.version and ends with write_audit_log(p_tenant_id, 'event', v_row.id, 'update', p_actor_member_id, v_before, to_jsonb(v_row)); v_row comes from RETURNING *, so after_value carries the NEW version number and before_value the old one. audit_logs has an index on (tenant_id, entity_type, entity_id).
- The task-assignment writers (bump_event_version_for_task_change, migration 20261003000074, which RETURNS VOID) and the FP-234 pruning of a removed member from tasks (migration 20261004000076) bump the version but write NO audit entry. List EVERY code path that bumps events.version and whether it writes an audit entry.
- Needs Attention data: event_task_assignment_responses (is_current, status = 'REFUSED', event_id, task_id, assignment_id); task names come from tasks.name; events_with_outstanding_refusals() (migration 20261005000080) is the set-based lookup behind the flag.
- The web event page shows "Refused: Name" through app/admin/(shell)/events/[id]/page.tsx, which calls listOutstandingRefusalsForEvent(tenantId, event.id) (src/features/tasks/eventTaskAssignment.service.ts) only when the caller can manage the event (canManage), and EventDetail.tsx renders it in red bold.
- The admin events list: app/admin/(shell)/events/page.tsx calls listEvents(tenantId, {...}) (src/features/events/service.ts) and passes the result to the client component EventsTable.tsx.
- The mobile event detail screen's Tasks section calls GET /api/event-tasks-assignments?event_id=X (app/api/event-tasks-assignments/route.ts, listTaskAssignmentsForEvent).
- The mobile app's apiFetch always does response.json() and expects the standard envelope { data }, so it cannot read an empty body. The view route currently returns 204 with no body.

### Implementation Plan
1. modified_fields and needs_attention_tasks on the mobile list and detail responses (GET /api/events/mine and GET /api/events/:id) and in the row types, computed in batch (no per-event queries):
   - modified_fields: string[]. Only for events where is_modified is true (otherwise []). Read the audit entries (entity_type 'event', action 'update') of the modified events whose after_value version is greater than the caller's last_seen_version, in ONE batched query. For each entry compare before_value and after_value column by column, ignore version, updated_at and other system columns, and map each differing column to a label from the fixed vocabulary below. Then add 'Tasks' when one or more version numbers between last_seen_version and the event's current version have NO matching audit entry (each such bump came from a non-audited source: a task assignment change, or pruning a removed member from tasks; list the sources you found). De-duplicate and keep a fixed display order. If is_modified is true and nothing can be derived, return ['Details'].
   - needs_attention_tasks: string[]. Only when needs_attention is true (otherwise []). The names of the tasks that have at least one current refusal on the event, reusing the data that already decides needs_attention. Task names only, never people.
   Vocabulary (map the REAL columns and list the mapping in the PR): name -> 'Name'; description -> 'Description'; start and end datetime -> 'Date & time'; every location column -> 'Location'; event type -> 'Event type'; meeting platform or link columns -> 'Online meeting'; talk or resource columns -> 'Talk'; RSVP closure and guest settings -> 'RSVP settings'; target (invitees) -> 'Invitees'; status -> 'Status'; anything else -> 'Details'.
2. Who refused, for the mobile detail: on GET /api/event-tasks-assignments?event_id=X add to each assignment row a field refused_by: { member_id: string; name: string }[] listing the current outstanding refusals on that assignment (reuse listOutstandingRefusalsForEvent), ONLY when the caller may manage the event (the same rule the web event page uses for canManage: the event's owner and Admin tier); for every other caller return an empty array. Names are the members' first and last names, as on the web page.
3. Web admin events list: add needs_attention (boolean) and needs_attention_tasks (string[]) to each row returned by listEvents, computed in batch for the page of rows (no per-row queries) with the SAME rule as the mobile flag: only for Admin tier, or a Leader for the events they own; the event must have a current refusal whose person still resolves as an assignee (events_with_outstanding_refusals) and must be live (not draft, cancelled or ended). In EventsTable show, under the event name of such a row, a marker with a warning icon and the text "Needs attention: Food Assignment" (the task names, comma separated) in the same red bold style as the "Refused:" line on the detail page (text-red-600 dark:text-red-400, font-bold); never color alone. Pagination, filters and sorting must keep working, and the marker must not change row heights for rows without it.
4. Change POST /api/events/[id]/view to return 200 with the standard envelope { data: { version: <the version recorded by this call, after clamping to the event's current version> } } instead of 204 with no body. Keep every other behavior (access rule, error codes, body handling) as it is, and update the part 1 tests that expect 204.
5. Add a code comment and a test that enumerate the known non-audited version-bump sources, so a future bump source added without an audit entry is noticed.
6. Tests (extend the part 1 script or add one): a date edit gives ['Date & time']; a location edit and a name edit together give both labels in the fixed order; a task reassignment gives ['Tasks']; removing a member who was assigned a task gives ['Tasks']; two edits since the last view union their labels; an edit plus a task change gives both; after the viewer opens the event modified_fields is []; needs_attention_tasks lists only tasks with current refusals and is [] for callers who are neither owner nor Admin; refused_by is filled for the owner and for an Admin and is an empty array for a Leader who does not own the event, a plain member, and the refuser; a refusal that was cleared (replaced person, changed mind, removed member) is not listed; the web list marker data is true only for Admin or the owning Leader and only for live events, and the number of database queries for a page of rows does not grow with the number of rows; an event whose audit entries are missing for part of the range never errors and falls back as specified; the view endpoint returns 200 with the envelope; part 1's tests and the existing scripts still match their baselines.

### Files to Create/Modify
- src/features/events/service.ts and src/features/events/event.types.ts (modify)
- src/features/tasks/eventTaskAssignment.service.ts and app/api/event-tasks-assignments/route.ts (modify)
- app/api/events/[id]/view/route.ts (modify)
- app/admin/(shell)/events/page.tsx and app/admin/(shell)/events/EventsTable.tsx (modify)
- The part 1 test script (extend) or a new scripts/test-fp222-adj1-*.ts

### Migration Files (if applicable)
None expected.

### Branch Name
feature/FP-222-web-adj-1-what-changed-and-refusals

### Commit Message
FP-222-web-adj-1: what changed, which task, who refused, web list marker, JSON view response

### Pull Request Description
Maps to the FP-222 requirements found in the first device test: the card says what changed and which task needs attention, the mobile detail can say who refused, the web events list shows Needs attention, and the view endpoint returns JSON. Include the label mapping from real columns, the list of version-bump sources and whether each is audited, an example response for an Admin, an owner and a plain member (list, detail and the assignments endpoint), a description or screenshot of the web list marker, the test results above, and what you could not test.

### Jira Linkage
- PDEEpicID: FP-31
- PDEStoryID: FP-222 (adj-1 to part 1)

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-222-adj-1-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not merge. Joseph merges after review.

Include full diffs for every file in your completion report per Section 5, rule 12, not a summary.
