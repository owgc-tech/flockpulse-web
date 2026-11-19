### DIP — FP-248 (Web): personal-data inventory of the current code and schema, for the legal documents (docs only)

### Not covered — deliberately excluded
- **Any code, migration or configuration change.** This is a read-and-document task only.
- **Legal wording.** Harvey writes the legal documents; this DIP only lists facts.
- **The mobile repository.** It is covered by a short mobile check in step 5 only if the mobile folder is available read-only. Otherwise list it as not checked.

### Story Summary
Harvey, Joseph's legal-drafting project, is writing FlockPulse's Privacy Policy and Terms. They must match what the product really collects and who it shares data with. Atlas wrote a briefing (`FLOCKPULSE-LEGAL-BRIEFING.md`), but could not read the current code this session, so several facts are marked [to confirm].

This DIP produces an exact inventory from the real migrations and code. It is saved as `documentation/legal/DATA-INVENTORY.md`, and Joseph gives it to Harvey with the briefing.

### Repo Target
Web (`owgc-tech/flockpulse-web`). It holds the shared database migrations and the API.

### Grounding Check
Not verified by Atlas this session (no repository access). Everything below must be found in the code; do not assume any of it:
- **Member profile columns.** Known so far: first and last name, email, role, birthdate, gender, marital status (from the FP-235 removal rules). Phone and any other fields are unknown.
- **The member-removal function** `remove_member()` (FP-235/FP-237): confirm exactly which fields it erases, reduces or keeps.
- **Third-party services** called from server code: Supabase, Mailtrap (Nodemailer SMTP), the Expo push API, and any others. Also check for analytics or tracking scripts: Vercel Analytics, Speed Insights, Google Analytics or any other.
- **Cookies** set by the web app.
- Whether registration includes a step to accept terms or a privacy notice.

### Implementation Plan
1. **Bootstrap.** Save this DIP verbatim to `documentation/dips/DIP-FP-248-web.md`. Create the branch `feature/FP-248-data-inventory` off current `dev`.
2. **Schema pass.** Rebuild the final schema from `supabase/migrations/` (a clean `supabase db reset` is fine). List every table in `public` that holds personal information, and for each one:
   - the table, its columns and their meaning in plain words;
   - whether a column is optional or required;
   - who can see it (from the API access rules);
   - what `remove_member()` does to it: deleted, anonymized, reduced or kept.

   Include auth data (`auth.users` fields used), MFA, push device tokens, notification records, audit log columns, view tracking, RSVP, self-report, attendance, tasks and responses, unavailability, announcements and acknowledgements, and community page content.
3. **Code pass.** Search `src/`, `app/` and configuration for:
   - every outbound service: name, purpose, and what personal data is sent (for example, the email body containing a member's name);
   - analytics, telemetry or error-tracking packages and scripts;
   - cookies and local storage keys set by the web app, and why;
   - registration and invitation flows: is there any consent or terms-acceptance step today?
   - any data-export or download feature.
4. **Environment pass, names only.** List the names of environment variables that point at external services, for example `SMTP_HOST`. **Never print values, keys or secrets.**
5. **Mobile, read-only, only if the folder `C:\projects\ai\owgctech\flockpulse-mobile` is available and not in use.** Without changing anything there, list:
   - phone permissions requested in `app.json` / `app.config`: notifications, camera, photos, contacts, location;
   - third-party SDKs in `package.json` that send data off the device;
   - any analytics or crash reporting.

   If you skip this step, say so.
6. **Write `documentation/legal/DATA-INVENTORY.md`** with these sections:
   1. Data stored per table, as a table.
   2. What removal does, per field.
   3. External services and the data each receives.
   4. Cookies and local storage.
   5. Analytics, tracking and crash reporting: say "none found" explicitly if none.
   6. Mobile permissions and SDKs.
   7. Consent and terms acceptance today.
   8. Gaps and surprises: anything that contradicts the Atlas briefing or looks risky. Examples: personal data in logs, data kept after removal that the briefing says is erased, an unexpected third-party script.

   Plain language. Every claim cites its file path (and migration name for schema facts).
7. **Checks.** No source change, so run only `git diff dev --stat`, which must list just the 2 documentation files. Commit, push, and run `gh pr create --base dev`.

### Files to Create/Modify
- Create: `documentation/dips/DIP-FP-248-web.md` (verbatim, then frozen) and `documentation/legal/DATA-INVENTORY.md`.
- Must stay untouched: everything else.

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-248-data-inventory

### Commit Message
FP-248: document personal-data inventory for the legal documents

### Pull Request Description
Plain GitHub markdown. Include:
- a summary of the inventory;
- the full "Gaps and surprises" section;
- whether the mobile check (step 5) ran;
- the statement that no code or configuration changed.

**Not tested:** none needed (documentation only).

**Steps for Joseph:**
1. Read the "Gaps and surprises" section and paste it to Atlas.
2. After merging, give `documentation/legal/DATA-INVENTORY.md` to Harvey together with `FLOCKPULSE-LEGAL-BRIEFING.md`.

### Jira Linkage
- PDEEpicID: FP-170
- PDEStoryID: FP-248

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-248-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Branch off current dev and open the PR with gh pr create --base dev; quote the base in your report and do NOT stack it on any other branch. Do not apply any migration to a remote database and do not merge: Joseph applies migrations after review, tests, and merges manually.

Include full diffs for every file in your completion report per Section 5, rule 13, not a summary.
