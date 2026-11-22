# FlockPulse — personal-data inventory (FP-248)

Facts only, for Harvey. Written from the real code and migrations on `dev` at `14b2f8c` (2026-11-18), with a read-only look at the mobile repository. It is not legal wording.

**How to read it.** Every claim names a file. Schema facts name the migration. "Not verified" marks things that cannot be seen from the code (hosted settings, regions, retention). The schema was rebuilt with a clean `supabase db reset` and read from the live local database; column lists below come from that.

**Reading guide for "Removal"** (the last column in section 1): what `remove_member()` does to the row when a member deletes their account or an Admin removes them. Source: `supabase/migrations/20261004000078_remove_member_function.sql`, extended by `20261004000079_removed_members_leave_no_live_links.sql` and `20261006000083_audit_ids_only_and_removed_member_text.sql`. Called from `src/features/members/service.ts` (line ~372), which then deletes the login with `auth.admin.deleteUser`.

Short key: **Kept** = untouched, still linked to the member's id. **Reduced** = value made less precise. **Replaced** = text replaced by a fixed placeholder. **Deleted** = row removed. **Detached** = row soft-deleted (`deleted_at` set) or the link removed.

---

## 1. Data stored per table

Only tables in `public` that hold information about a person, or that link a person to something. `*` = required (NOT NULL); everything else is optional. "Who sees it" is a plain summary of the API role checks (`src/lib/auth/middleware.ts`, `app/api/**`); the database itself refuses direct access from the apps (`20261004000075_api_only_data_access.sql`). Role names: Admin, Leader, Member.

### Identity and account

| Table / store | Columns (plain words) | Who sees it | Removal |
|---|---|---|---|
| `members` | `first_name*`, `last_name*`, `email*`, `gender*`, `marital_status*`, `role*` and `role_catalog_entry_id` (their role), `user_id*` (link to the login), `mfa_trust_duration_days*` (how long a verified browser is trusted; default 28), `created_at`, `deleted_at`. No phone number, address or photo column exists. | Admin: all members. Leader: their own led members and members of events they can open. Member: themselves (`app/api/members/me/route.ts`). | **Replaced**: name → "Self-deleted User" or "Deactivated User"; email → `deleted-<id>@deleted.invalid`. **Kept**: gender, marital status, role, `mfa_trust_duration_days`, `created_at`. `deleted_at` set. `user_id` is kept as a dead id (the login it pointed to is deleted). |
| `legal_document_versions` (FP-254) | One row: `terms_effective_date*`, `privacy_effective_date*`, `updated_at*`. Not personal data. Joseph changes the dates by hand when the documents change. | Nobody through the app or API (service role only, no policies). | n/a |
| `member_acceptances` (FP-254) | `tenant_id*`, `member_id*`, `terms_effective_date*` and `privacy_effective_date*` (the effective dates of the documents accepted), `confirmed_18_plus*` (always yes; a row cannot exist otherwise), `accepted_at*` (time), `id*`. One row per member per version; rows cannot be edited. Written in the same database step as registration (`complete_registration`, `create_tenant_and_founding_admin`) or by the one-time screen (`record_member_acceptance`). | Nobody through the app or API directly (service role only, no policies). The member only learns whether acceptance is still required (`GET /api/members/me/acceptance`). | **Kept** (the record that the person accepted and confirmed 18+ is not removed with the member; rows are deleted by hand only when a Community is closed). |
| `invitations` | `email*`, `role*`, `group_id`, `invited_by*` (member id), `auth_user_id*`, `status*`, `invited_at*`, `responded_at`, `role_catalog_entry_id` | Admin (`app/api/invitations`). | **Replaced**: email → placeholder; a pending invite is revoked. Other columns kept. |
| `auth.users` (Supabase Auth) | Email, password (stored as a hash by Supabase), `app_metadata` (`tenant_id`, `role`, `group_id`, `role_catalog_entry_id`, `member_id`), sign-in timestamps. Set in `src/features/invitations/invitation.service.ts` (line ~104) and `src/features/registration/registration.service.ts` (line ~79). Other fields Supabase keeps on its own (for example last sign-in, IP in its internal logs) are **not verified**. | The person; the server (service role). | **Deleted** (`auth.admin.deleteUser`, `members/service.ts` line ~386). |
| `auth.mfa_factors` (Supabase Auth) | Authenticator-app (TOTP) factor created by `supabase.auth.mfa.enroll` (`app/admin/mfa-enroll/actions.ts`). | The person. | **Deleted** with the login (Supabase removes factors with the user; not separately verified). |

### Community structure

| Table | Columns | Who sees it | Removal |
|---|---|---|---|
| `assignments` | `member_id*`, `assignment_type*` (LEADER link or GROUP membership), `leader_member_id` (their leader), `group_id`, `deleted_at` | Admin; the member's own leader; the member. | **Detached**: all the member's rows soft-deleted. Rows where the removed person is the leader are not handled by `remove_member()` (the leader guard blocks removing a leader who still leads people: `members/service.ts`). |
| `groups` | `name*`, `owner_member_id` (leader), `created_by`, `updated_by`, `deleted_at`, `system_key` | Admin; group owner. | **Kept**. Owner links are blocked while the member still owns a group (`20260719000049_...`). |
| `role_catalog` | role names per community (not personal) | All members. | n/a |
| `member_unavailability_ranges` | `member_id*`, `start_date*`, `end_date*` | Admin, the member's leader, the member. | **Deleted**. |

### Events and participation

| Table | Columns | Who sees it | Removal |
|---|---|---|---|
| `events` | `name*`, description/`announcement_body`, `start_datetime*`, `end_datetime*`, `location_name*`, `location_address*`, `online_meeting_url`, `owner_member_id`, `created_by_member_id`, `status*`, `target*` | Admin; Leaders for events they own, are invited to or are assigned to (FP-239, `20261006000082_event_visibility_and_leader_scope.sql`); invited Members. | **Kept**. Owner and creator ids stay (they are ids, not names). |
| `event_series` | recurrence details, `created_by`, `location_name*`, `location_address*` | Admin, owner. | **Kept**. |
| `meeting_resources` | `name*`, `join_url*` (online meeting links) | Admin and event viewers. | n/a |
| `event_attendees` | `event_id*`, `member_id*` (who is invited) | People who can open the event; removed members hidden in roster views (`app/api/events/[id]/roster/route.ts`). | **Kept**. |
| `rsvps` | `rsvp_status*` (Yes/No/Tentative), `rsvp_reason` (free text, required for No), `guest_count`, `responded_at*` | Reason: Admin, the person's own leader, the person only. Status/roster: people who can open the event. | **Replaced**: `rsvp_reason` → `[removed]`. Status, guest count and dates **kept**. |
| `member_attendance_reports` (self-report after an event) | `self_report_status*` (Yes/No), `reason` (free text), `feedback` (free text, up to 1,000 characters), `star_rating` (1–5), `confirmation_status*`, `submitted_at*` | Admin; the person's leader; the person. | **Replaced**: `reason`, `feedback` → `[removed]`. Status, rating, dates **kept**. |
| `attendance` (official record) | `attendance_status*`, `confirmed_by` (member id), `confirmed_at*`, `confirmation_type*`, `leader_note` (free text), `self_report_id` | Admin, leader, the person. | **Replaced**: `leader_note` → `[removed]`. The rest **kept**. |
| `talk_completions` (program progress) | `member_id*`, `talk_id*`, `completed_at*`, `source*`, `recorded_by` | Admin, leader, the person (`app/api/formation/progress`). | **Kept**. |
| `courses`, `modules`, `talks` | program content, not personal (`talks` carries audience flags `for_single_men`, `for_single_women`, `for_married_men`, `for_married_women`) | All members. | n/a |
| `event_member_views` | `member_id*`, `event_id*`, `last_seen_version*`, `last_seen_at*` ("what changed" tracking) | Only used by the server to compute indicators for that member. | **Deleted**. |

### Tasks and announcements

| Table | Columns | Who sees it | Removal |
|---|---|---|---|
| `tasks` | task names (not personal) | Admin, leaders. | n/a |
| `event_tasks_assignments` | `assignee` (list of member ids), `task_id*`, `event_id*` | Admin, event owner; assignee sees their own. | **Detached**: the removed id is pruned from the list (trigger in `20261004000076_prune_deleted_members_from_assignments.sql`). |
| `event_task_assignment_responses` | `member_id*`, `status*` (Commit/Refuse), `responded_at*`, `is_current*`, `cleared_at`, `cleared_reason` | Names of people who refused: event owner and Admins only. | **Current answer cleared** (`is_current=false`, reason `REMOVED_FROM_ASSIGNMENT`, via the pruning above and `20261003000074_...`). **History kept**, still carrying the member id. |
| `announcement_acknowledgements` | `event_id*`, `member_id*`, `acknowledged_at*` | Admin and announcement owner (`app/api/announcements/[eventId]/roster`). | **Kept**. |

### Community, security and records

| Table | Columns | Who sees it | Removal |
|---|---|---|---|
| `tenants` (the community) | `name*`, `tagline`, `description`, `logo_url`, timezone, RSVP and task settings, `invite_email_subject`, `invite_email_body` (the Admin-written invitation email). Community page text is rich text edited in `app/admin/(shell)/community/RichTextEditor.tsx`. | Community page: members. Settings: Admin. | n/a (not about one person). |
| `audit_logs` | `entity_type*`, `entity_id*`, `action*`, `actor_id` (member id), `before_value`, `after_value` (JSON), `created_at*` | Admin only (`app/api/audit-logs/route.ts`). | **Kept** (append-only). Since FP-236 (`20261006000083_...`) member entries keep only id, tenant id, role and role-catalog id; invitation entries keep no email or auth id. A removed member's free text inside entries is replaced by `[removed]`. |
| `event_types` | names (not personal) | All. | n/a |

### Not in the web schema (important)

There is **no table for push-notification tokens, device identifiers, notification delivery records or notification settings**. See section 6 and Gaps.

Supabase **Storage**: one public bucket, `tenant-logos`, holds a community's logo (`<tenant-id>/logo`, PNG/JPEG, max 2 MB). `src/features/tenant/service.ts` lines ~206–231. It is a community image, not member data, but its URL is public.

---

## 2. What removal does, per field

Same routine for in-app self-deletion (`DELETE /api/members/me`, `app/api/members/me/route.ts`) and for Admin removal. Source files in the intro. Removal is permanent; there is no reactivation in code.

| Field / data | Result |
|---|---|
| Login (`auth.users`, MFA factor) | **Deleted** after the database step succeeds. If the login delete fails the API returns `AUTH_DELETE_FAILED` (500) and the member row is already scrubbed. |
| First and last name | **Replaced** by "Self-deleted User" / "Deactivated User". |
| Email (member row and any invitation row) | **Replaced** by `deleted-<member id>@deleted.invalid`. |
| Terms / Privacy acceptance record (`member_acceptances`) | **Kept** (member id, effective dates, 18+ yes, time). |
| Gender, marital status | **Kept** (briefing: "for statistics"). |
| Role, `mfa_trust_duration_days`, `created_at`, `user_id` (dead id) | **Kept**. |
| Leader link, group memberships | **Detached** (soft-deleted). |
| Unavailability dates | **Deleted**. |
| "Seen" tracking (`event_member_views`) | **Deleted**. |
| RSVP reason, self-report reason, self-report feedback, leader note | **Replaced** by `[removed]`, in the tables and in their audit entries. |
| RSVP status, guest count, star rating, attendance status, dates | **Kept**. |
| Event invitations (`event_attendees`), attendance, talk completions, announcement acknowledgements | **Kept** with the member id so event totals and statistics do not change. |
| Task assignments | Removed from the assignee lists. Current Commit/Refuse answer cleared; past answers **kept** under the member id. |
| Audit log entries | **Kept**, ids only. |
| Backups, hosting logs, email already sent | **Not touched by the code** (see Gaps). |

Not removed by code: anything held by Supabase outside `public` and `auth` (backups), Vercel request logs, Mailtrap's sent-email log, and the invitation email in the person's own inbox.

---

## 3. External services and the data each receives

Only services called from web server code or the browser. Found in `package.json`, `src/`, `app/`, `proxy.ts`.

| Service | Called from | Purpose | Personal data sent |
|---|---|---|---|
| **Supabase** (database, Auth, Storage) | `src/lib/supabase/*`, most of `src/features/**`, `proxy.ts` | Stores all data; login, passwords, MFA; logo storage. | Everything in section 1; login email and password at sign-in; MFA codes. The server uses the service-role key for data access. |
| **Mailtrap** (SMTP via Nodemailer 10) | `src/lib/email/mailer.ts`, called only by `src/features/invitations/invitation.service.ts` | Sends the invitation email. | Recipient email, community name, invite link, and whatever the Admin wrote in the template. Default template: `src/features/invitations/invitation.service.ts` and `20260809000068_tenant_invite_email_template.sql`. It does not include the invitee's name. |
| **Supabase Auth email** | `app/reset-password/actions.ts` (`resetPasswordForEmail`) | Password-reset email. Sent by Supabase's own mail settings, outside this repo. The SMTP provider used in production is **not verified** (`supabase/config.toml` has the SMTP block commented out). | Recipient email, reset link. |
| **Geocodio** (`api.geocod.io`) | `src/lib/geocodio.ts`, called from `app/api/events/route.ts` and `app/api/events/[id]/route.ts` | Checks that an event's address is real when an event is created or edited. | The event's `location_address` text (a street address typed by an Admin or Leader). No member names. Fails open on error or missing key. **Not in the Atlas briefing.** |
| **Google Maps** (link only) | `src/features/events/event.types.ts` line ~210 | Builds a "map" link from the event address; the browser opens it only when a person clicks. | Event address inside the URL, when clicked. |
| **Expo / EAS Update** (mobile only) | `flockpulse-mobile/app.json` (`updates.url`) | Delivers app updates. | Standard update request (app version, device platform). See section 6. |

Not found anywhere in the web or mobile code: Expo push API, Apple/Google push (token registration), Stripe, Vercel Analytics, any email service besides Mailtrap and Supabase Auth.

---

## 4. Cookies and local storage (web app)

| Name | Where it lives | Set by | Why | Notes |
|---|---|---|---|---|
| Supabase session cookies (names set by `@supabase/ssr`, typically `sb-<project>-auth-token...`) | Cookie | `src/lib/supabase/server.ts`, `proxy.ts` | Keeps the person logged in. | Names and options are chosen by the library, not by this repo (not verified in a browser). |
| `fp_mfa_expires_at` | Cookie: httpOnly, secure, sameSite=lax, path `/`, lifetime = the member's `mfa_trust_duration_days` (default 28 days) | `app/login/mfa-challenge/actions.ts`, `app/admin/mfa-enroll/actions.ts`; read in `proxy.ts`; deleted in `app/reset-password/confirm/actions.ts` | Remembers that an Admin passed MFA in this browser. | Holds only an expiry timestamp. |
| `fp_community_name` | `localStorage` | `app/register/founder/complete/FounderCompleteForm.tsx`, `app/admin/(shell)/invitations/InvitationsTable.tsx`; read in `app/login/LoginForm.tsx` | Pre-fills the community name on the login screen. | Not secret. |
| `fp_reg_token` | `sessionStorage` | `app/register/set-password/page.tsx`; read in `app/register/complete/CompleteProfileForm.tsx` | Carries the registration access token between steps. | A login access token held in the page storage for the tab's lifetime. |
| `fp_founder_token` | `sessionStorage` | `app/register/founder/FounderRegistrationForm.tsx`; removed in `FounderCompleteForm.tsx` | Same, for founder registration. | Same note. |

No advertising, preference or analytics cookies were found. No cookie banner exists in the code.

---

## 5. Analytics, tracking and crash reporting

**None found.**

Searched `package.json`, `app/`, `src/`, `proxy.ts` and `next.config.ts` for Vercel Analytics, Speed Insights, Google Analytics / Tag Manager, Sentry, PostHog, Mixpanel, Segment, Hotjar, Clarity, LogRocket, Bugsnag, Datadog, Plausible. No package and no script tag. The only logging is `console.warn` / `console.error` lines in `src/lib/geocodio.ts`, `src/features/events/service.ts` and `src/features/tasks/autoAssign.service.ts`; none prints member names or emails (they print error codes and messages). Vercel and Supabase keep their own platform request logs; those are outside this repo and **not verified**.

---

## 6. Mobile permissions and SDKs

Read-only look at `C:\projects\ai\owgctech\flockpulse-mobile` (`app.json`, `package.json`, `src/`). Nothing was changed there.

- **Permissions asked.** Android: `SCHEDULE_EXACT_ALARM` (for reminders), `USE_BIOMETRIC`, `USE_FINGERPRINT`. iOS: a Face ID usage text ("to unlock the app on this trusted device"). The `expo-notifications` plugin implies the notification permission prompt. **No** camera, photos, contacts or location permission and no package for them.
- **Notifications are local, not push.** The app schedules reminders on the phone with `scheduleNotificationAsync` (`src/features/notifications/services/*.ts`). It never requests an Expo push token and never calls an Expo or Apple/Google push service. Text that appears on the lock screen includes event names (for example "Please respond to your RSVP for <event name>"); it is built on the device.
- **Data stored on the phone.** Supabase session in AsyncStorage (`src/lib/supabase.ts` line ~17); reminder time slots, last-checked time and theme in AsyncStorage; a per-user "trusted device" flag in SecureStore (`expo-secure-store`) for Face ID.
- **SDKs that talk off the device.** `@supabase/supabase-js` (to Supabase), `expo-updates` (to `u.expo.dev`, EAS Update). Everything else in `package.json` is local UI or device features.
- **Analytics / crash reporting.** None found.
- **Backend address.** The app calls the web API through `EXPO_PUBLIC_API_BASE_URL` and Supabase through `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

### Environment variable names that point at external services (names only, never values)
Web (`.env.example` and `process.env` use in `src/`, `app/`, `proxy.ts`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`, `MAILTRAP_HOST`, `MAILTRAP_PORT`, `MAILTRAP_USER`, `MAILTRAP_PASS`, `MAILTRAP_FROM_EMAIL`, `GEOCODIO_API_KEY`. Mobile: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_BASE_URL`.

---

## 7. Consent and terms acceptance today

**Since FP-254:** new registration (invitee: `app/register/complete/CompleteProfileForm.tsx`; founder: `app/register/founder/complete/FounderCompleteForm.tsx`) requires two unticked-by-default boxes, "I confirm I am 18 or older." and "I accept the Terms of Service and the Privacy Policy." (links to `/terms` and `/privacy`). Both server actions refuse without both, and the database functions `complete_registration` and `create_tenant_and_founding_admin` refuse too. The acceptance is stored in `member_acceptances` with the effective dates of the two documents and a timestamp, in the same database step as the member row.

**Existing members** see a one-time screen (`app/accept-terms`) the first time they open the web admin after this ships: "Please confirm to continue", the same two boxes, "Continue". It is a gate in the admin shell layout (`app/admin/(shell)/layout.tsx`), not a block on every API route: a client that calls the API directly is not stopped. If the check itself fails the shell is shown normally. The mobile app has its own screen (separate story). When Joseph changes the effective dates in `legal_document_versions`, every member is asked again.

**No birthdate is collected** (registration, founder registration, profile page and API). There is still **no data-export or download feature** (no CSV/export/download code and no export API route); access and correction requests would be handled outside the product.

---

## 8. Gaps and surprises

Things that contradict the Atlas briefing, or look risky. Ordered by how much they matter for the documents.

1. **No push tokens or notification records exist.** The briefing (section 4) says "Push notification tokens for the phone app" and "Notification scheduling and delivery records" are confirmed, and the sub-processor table lists Expo for push with "member names in leader alerts". In the code there is no token table, no token registration, no push API call, and no notification table. Reminders are scheduled locally on the phone. Expo is only used for EAS app updates. Apple (APNs) and Google (FCM) are therefore not data recipients in the current code. Before app-store answers are written, Joseph should confirm that remote push is not planned for launch; if it is, this section changes.
2. **Geocodio is a third-party recipient the briefing does not list.** Every event create/edit sends the event's street address to Geocodio (`src/lib/geocodio.ts`). It is a venue address typed by an Admin or Leader; it can be a private home. No member name is sent.
3. **Removal keeps more than the briefing implies.** After removal the code still holds, tied to the member id: gender, marital status, role, RSVP status and guest count, star ratings, attendance records, program completions, announcement acknowledgements, event invitations, past Commit/Refuse answers, and audit entries (ids only). The briefing says the record "becomes an anonymous shell"; that matches the name, email and free text, but not "everything about them is anonymous": the shell keeps a stable id and these facts, and gender + marital status together are quasi-identifiers in a small community. Harvey should not promise that the remaining record "cannot identify the person".
4. **The briefing says current Commit/Refuse answers are cleared on removal.** True, but through a side effect: the pruning trigger on assignments (`20261004000076`), not `remove_member()` itself. If someone removes a member by editing the table directly, the same trigger still fires; I did not test every path.
5. **`user_id` stays on the removed member row** as a dead identifier. Harmless today (the login is gone); worth knowing if the documents say "all identifiers are deleted".
6. **Briefing says Mailtrap sends "invitation and notification emails".** The web code sends only invitation emails through Mailtrap. Password reset uses Supabase Auth's email settings (production SMTP provider not verified). No other email is sent from code. Also: the Admin-edited invitation template is stored in `tenants.invite_email_body`; whatever an Admin puts there is sent as written.
7. **Registration tokens sit in browser storage.** `sessionStorage` keeps `fp_reg_token` / `fp_founder_token`, which are login access tokens, until the tab closes. Not a policy item, but a security note for any claim about token handling.
8. **Mobile keeps the Supabase session in AsyncStorage**, not in SecureStore (only the Face ID "trusted device" flag is in SecureStore). Relevant to any statement about how the phone protects the login.
9. **No age check exists in code, by design.** Since FP-254 no birthdate is collected, so nothing can be checked against a minimum age. The "I confirm I am 18 or older." box is the person's own confirmation, stored with the time and the document versions (`member_acceptances`). There is still no export feature (section 7).
10. **Phone number: not collected.** The briefing marks it "to confirm". There is no phone column in any table and no phone field in any form. Other profile fields: only gender and marital status beyond name and email.
11. **Birthdate column is gone.** FP-254 migration `20261121000091` was applied to the hosted database (fpdb-dev) on 2026-11-21, and the column no longer exists (checked live). Backups taken before it may still hold old birthdates until they are replaced; the retention of backups is outside the repo and not verified.
12. **Logs.** No code logs names or emails. Platform logs (Vercel, Supabase, Mailtrap) and backups are outside the repo; their retention, region and contents are **not verified** and still need Joseph's answer (briefing "to confirm" items on regions, retention and backups are unchanged by this inventory).
13. **Public logo.** Community logos live in a public Supabase Storage bucket (`tenant-logos`). Not personal data, but publicly reachable by URL.
14. **Audit log scope.** Audit entries for non-member records (events, groups, tasks, etc.) are not stripped of free text other than the removed-member rule; an Admin-written event description or note edited in an event would appear in `before_value` / `after_value` for Admins. Joseph may want to check what Admins type there. Only readable by Admins.

## Appendix: what this inventory did not cover

- Hosted Supabase and Vercel settings (regions, backup length, log retention, who has dashboard access).
- The deployed site's real cookies (listed from code, not from a browser).
- Anything in the Supabase `auth` schema beyond what the code reads or writes.
- Rows and content actually stored for OWGC.
