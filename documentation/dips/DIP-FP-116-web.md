DIP-FP-112-web
Story Summary
Adds two self-service endpoints so a member can view and edit their own profile from mobile — `GET /api/members/me` and `PATCH /api/members/me`. Neither exists today; the only member-update endpoint is Admin-only and doesn't cover `gender`/`marital_status`/`birthdate` at all.
Repo Target
Web (Next.js) — `owgc-tech/flockpulse-web`.
Grounding Check

* Confirmed exact editable field set by reading `complete_registration()` directly (`20260629000020_registration_completion.sql`, widened by `20260708000027_widen_marital_status.sql`): `first_name`, `last_name`, `gender` (`MALE`/`FEMALE`), `marital_status` (`SINGLE`/`MARRIED`/`WIDOWED`/`DIVORCED`/`SEPARATED`), `birthdate`. Matches exactly what the user asked for — "what was entered during registration."
* RLS already permits this: `members_update_self` (from the remediation migration) already allows a member to `UPDATE` their own row (`user_id = auth.uid()`), with the comment explicitly noting role escalation is prevented at the application layer, not the RLS policy. This endpoint is that application-layer enforcement — it will only ever accept the five fields above from the request body, silently ignoring anything else (role, email, tenant_id) rather than erroring, consistent with existing patterns elsewhere (tenant_id always server-derived, never client-supplied).
* No existing "my groups" endpoint — the closest existing function (`getGroupMembers`) goes the opposite direction (given a group, list its members). Folding a `groups: {id, name}[]` array into `GET /api/members/me`'s response avoids a second new endpoint, consistent with the "one purpose-built response" pattern already used for `reminder-context`.
* Web's own registration form is stale relative to FP-105 (`CompleteProfileForm.tsx` still only offers Single/Married) — not in scope to fix here, flagging for awareness since the new mobile edit screen should offer the full current five-value set, unlike that form.
Implementation Plan

1. New `src/features/members/service.ts` function `getMyProfile(memberId, tenantId)`: selects `id, first_name, last_name, email, gender, marital_status, birthdate` from `members`, plus a joined query against `assignments` (`assignment_type = 'GROUP'`, `deleted_at IS NULL`) → `groups` for `{id, name}[]`.
2. New `updateMyProfile(memberId, tenantId, input)`: accepts only `firstName?, lastName?, gender?, maritalStatus?, birthdate?`; validates `gender` against `('MALE','FEMALE')` and `maritalStatus` against the full five-value set, mirroring `complete_registration()`'s own validation; updates via the service client, scoped to `id = memberId AND tenant_id = tenantId`.
3. New `app/api/members/me/route.ts` — `GET` and `PATCH`, both plain `withAuth` (no role restriction — this is inherently self-scoped via `ctx.memberId`), no `id` param needed from the client at all.
Files to Create/Modify

```
app/api/members/me/route.ts          (new)
src/features/members/service.ts      (modified — two new functions)
```

Migration Files (if applicable)
None — no schema change, only new read/write paths against existing columns.
Branch Name
`feature/FP-112-web-self-service-member-profile`
Commit Message
`FP-112-web: add self-service GET/PATCH /api/members/me with groups`
Pull Request Description

* `GET /api/members/me` — returns the calling member's own profile plus their group memberships, no `id` param needed.
* `PATCH /api/members/me` — updates only `firstName`/`lastName`/`gender`/`maritalStatus`/`birthdate`; role/email/tenant_id are never accepted from the body, matching the existing self-update RLS policy's documented intent.
Jira Linkage

* PDEEpicID: FP-5 (EPIC-1 — Tenant & Access Control)
* PDEStoryID: new story, to be filed once this is reviewed
Stop Point
Save this DIP verbatim to `documentation/dips/DIP-FP-112-web.md` and do not append executor notes, observations, or any other content to that file after the initial save. Open the PR against `dev` and stop. Merge once reviewed here; test against deployed `dev` afterward, per standard web-repo workflow.
Include full diffs for every file in the completion report per Section 5, rule 12 — not a summary.
