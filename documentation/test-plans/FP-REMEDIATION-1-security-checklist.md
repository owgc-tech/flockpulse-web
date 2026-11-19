FP-REMEDIATION-1 Security Test Checklist
Stories: FP-6, FP-7, FP-9, FP-10, FP-12

==============================================================
AUTH MIDDLEWARE (FP-6 / STORY-1.1)
==============================================================

[ ] TC-AUTH-01: Valid JWT with tenant_id claim
    Action:  GET /api/members with a well-formed Supabase JWT whose app_metadata.tenant_id
             matches an active member row.
    Expect:  200, member list scoped to that tenant only.

[ ] TC-AUTH-02: Missing Authorization header
    Action:  GET /api/members with no Authorization header.
    Expect:  401 { error: { code: "AUTH_REQUIRED" } }

[ ] TC-AUTH-03: Malformed token (random string, not a JWT)
    Action:  GET /api/members with Authorization: Bearer not-a-jwt
    Expect:  401 { error: { code: "INVALID_TOKEN" } }

[ ] TC-AUTH-04: Expired JWT
    Action:  GET /api/members with a syntactically valid but expired Supabase JWT.
    Expect:  401 { error: { code: "INVALID_TOKEN" } }

[ ] TC-AUTH-05: JWT missing tenant_id claim
    Action:  GET /api/members with a valid JWT whose app_metadata has no tenant_id.
    Expect:  401 { error: { code: "INVALID_TOKEN" } }
             Verify: server never reads tenant_id from request body or query string.

[ ] TC-AUTH-06: JWT for soft-deleted member
    Action:  GET /api/members with a valid JWT for a user whose member row has deleted_at set.
    Expect:  401 { error: { code: "INVALID_TOKEN" } } (no active member record)

==============================================================
RBAC — FORBIDDEN_ROLE (FP-7 / STORY-1.2)
==============================================================

[ ] TC-ROLE-01: MEMBER attempting Admin-only action (create member)
    Action:  POST /api/members with a MEMBER-role JWT.
    Expect:  403 { error: { code: "FORBIDDEN_ROLE" } }

[ ] TC-ROLE-02: LEADER attempting Admin-only action (create group)
    Action:  POST /api/groups with a LEADER-role JWT.
    Expect:  403 { error: { code: "FORBIDDEN_ROLE" } }

[ ] TC-ROLE-03: MEMBER calling /api/assignments/my-members
    Action:  GET /api/assignments/my-members with a MEMBER-role JWT.
    Expect:  403 { error: { code: "FORBIDDEN_ROLE" } }

[ ] TC-ROLE-04: LEADER calling /api/assignments/my-members
    Action:  GET /api/assignments/my-members with a LEADER-role JWT.
    Expect:  200, list of members assigned to that specific leader only.
             Verify: no other leader's assigned members appear.

[ ] TC-ROLE-05: ADMIN calling all Admin-only endpoints
    Action:  POST /api/members, POST /api/groups, POST /api/assignments, DELETE /api/members,
             POST /api/events, POST /api/events/:id/publish — all with ADMIN JWT.
    Expect:  2xx for each, no FORBIDDEN_ROLE.

[ ] TC-ROLE-06: LEADER reading shared read endpoints
    Action:  GET /api/members, GET /api/groups, GET /api/events with LEADER JWT.
    Expect:  200 for each (read is open to all authenticated roles, tenant-scoped).

==============================================================
CROSS-TENANT ACCESS (FP-6, FP-7)
==============================================================

[ ] TC-TENANT-01: Client-supplied tenant_id ignored
    Action:  POST /api/members with ADMIN JWT; include "tenantId": "<other-tenant-uuid>" in body.
    Expect:  Member is created under the JWT's tenant_id, not the body value.
             Verify: inserted row has tenant_id == JWT tenant, not body value.

[ ] TC-TENANT-02: Cross-tenant resource read attempt
    Action:  GET /api/members with a valid JWT for Tenant A; verify response contains only
             Tenant A members even if Tenant B has members with overlapping emails.
    Expect:  Only Tenant A members returned. No data leakage across tenants.

[ ] TC-TENANT-03: Cross-tenant resource mutation attempt
    Action:  PATCH /api/members?id=<member-id-from-tenant-B> with Tenant A ADMIN JWT.
    Expect:  404 or empty result (service layer scopes update to tenant from JWT).
             Verify: Tenant B member row unchanged.

[ ] TC-TENANT-04: Leader cross-tenant scope
    Action:  GET /api/assignments/my-members with LEADER JWT for Tenant A.
    Expect:  Only Tenant A members returned. No Tenant B members, even if Tenant B has
             assignments where leader_member_id happens to match the calling member's id UUID.

==============================================================
MEMBER SOFT-DELETE (FP-9 / STORY-2.1)
==============================================================

[ ] TC-MEMBER-01: Soft-deleted member excluded from active list
    Action:  Admin soft-deletes Member X (DELETE /api/members?id=X).
             Then GET /api/members.
    Expect:  Member X not in response. deleted_at is set in DB.

[ ] TC-MEMBER-02: Soft-deleted member cannot authenticate as active
    Action:  Member X is soft-deleted. Attempt GET /api/members with Member X's JWT.
    Expect:  401 { error: { code: "INVALID_TOKEN" } } (no active member record).

[ ] TC-MEMBER-03: Unique email enforced across active members only
    Action:  Soft-delete Member with email foo@example.com, then create a new member
             with the same email.
    Expect:  201 — email is allowed since original is soft-deleted.

[ ] TC-MEMBER-04: Duplicate active email rejected
    Action:  POST /api/members with email foo@example.com when an active member already
             has that email in the same tenant.
    Expect:  409 { error: { code: "DUPLICATE_EMAIL" } }

==============================================================
ASSIGNMENT SOFT-DELETE (FP-10 / STORY-2.2)
==============================================================

[ ] TC-ASSIGN-01: Duplicate active assignment rejected
    Action:  Create GROUP assignment for Member M → Group G.
             Attempt to create the same assignment again (same member_id + group_id).
    Expect:  409 { error: { code: "DUPLICATE_ASSIGNMENT" } } — not a 500.

[ ] TC-ASSIGN-02: Soft-deleted assignment excluded from /api/assignments
    Action:  Admin soft-deletes Assignment A (DELETE /api/assignments?id=A).
             Then GET /api/assignments.
    Expect:  Assignment A not in response. deleted_at set in DB.

[ ] TC-ASSIGN-03: Soft-deleted assignment excluded from /api/assignments/my-members
    Action:  Create LEADER assignment: Member M → Leader L.
             Leader L calls GET /api/assignments/my-members — sees Member M.
             Admin soft-deletes the assignment.
             Leader L calls GET /api/assignments/my-members again.
    Expect:  Member M no longer in response after soft-delete.

[ ] TC-ASSIGN-04: Soft-deleted assignment can be re-created
    Action:  Soft-delete GROUP assignment for Member M → Group G.
             Create the same assignment again.
    Expect:  201 — partial unique index allows re-creation after soft-delete.

[ ] TC-ASSIGN-05: Soft-deleted assignment excluded from event roster materialization
    Action:  Create GROUP assignment: Member M → Group G. Soft-delete it.
             Create event targeting Group G. Publish event (DRAFT → SCHEDULED).
    Expect:  Member M does NOT appear in event_attendees for this event.
             (Covers the handle_event_scheduling() deleted_at filter fix.)

==============================================================
EVENT LIFECYCLE (FP-12 / STORY-3.1)
==============================================================

[ ] TC-EVENT-01: Create event defaults to DRAFT
    Action:  POST /api/events with valid fields.
    Expect:  201, status = "DRAFT".

[ ] TC-EVENT-02: Publish transitions DRAFT → SCHEDULED
    Action:  POST /api/events/:id/publish on a DRAFT event.
    Expect:  200, status = "SCHEDULED".
             Verify: event_attendees populated for target group's active members.
             Verify: event_notifications rows created for PRE_EVENT_REMINDER,
                     POST_EVENT_SELF_REPORT, LEADER_CONFIRMATION.

[ ] TC-EVENT-03: Publish rejects non-DRAFT events
    Action:  POST /api/events/:id/publish on an already-SCHEDULED event.
    Expect:  422 { error: { code: "INVALID_TRANSITION" } }

[ ] TC-EVENT-04: end_datetime validation
    Action:  POST /api/events with end_datetime <= start_datetime.
    Expect:  422 { error: { code: "INVALID_DATETIME" } }

[ ] TC-EVENT-05: Publish missing required fields
    Action:  Attempt to publish an event missing name or event_type_id (e.g., set to null
             via direct DB update before calling publish).
    Expect:  422 { error: { code: "MISSING_FIELD" } }

[ ] TC-EVENT-06: Non-admin cannot create or publish events
    Action:  POST /api/events and POST /api/events/:id/publish with MEMBER or LEADER JWT.
    Expect:  403 { error: { code: "FORBIDDEN_ROLE" } } for both.

==============================================================
NOTES
==============================================================

- TC-ASSIGN-05 is new in this remediation — directly validates the handle_event_scheduling()
  deleted_at filter fix and the assignments SELECT policy update. Both would silently fail
  (removed assignments appearing active) without this test case.
- FP-7 "leader restricted to assigned members for confirmation workflows" is verified via
  TC-ROLE-03, TC-ROLE-04, TC-ASSIGN-03, and TC-TENANT-04. Full confirmation-workflow
  enforcement requires EPIC-6 (pending) and is not tested here.
- All tests should be run with a local Supabase stack (supabase start) against migration
  20260629000003_remediate_rbac_and_assignments.sql applied.
