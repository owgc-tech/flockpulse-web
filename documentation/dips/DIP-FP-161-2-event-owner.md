DIP-FP-161-2-event-owner.md
Story Summary
Phase 2 of 5 for FP-161. Adds a transferable owner_member_id to events, mirroring FP-146's Group Owner precedent exactly (deactivation guard, single + bulk reassignment, Admin-only). Unlike Groups, this isn't purely additive: events.created_by_member_id (added under FP-114-web) is already functioning as a live permission gate — Leader-tier's ability to edit/publish/cancel/manage an event is currently determined by created_by_member_id === callerId, across six separate real code sites spanning both repos. This DIP's core work is migrating all six from created_by_member_id to the new owner_member_id, so that reassigning an event's owner actually transfers real permissions — not just a display label — while created_by_member_id becomes purely historical from this point forward, exactly matching how Groups' created_by stopped being used for anything functional once owner_member_id existed.
Repo Target
Both flockpulse-web and flockpulse-mobile — this is not a web-only DIP, since one of the six permission gates lives on mobile.
Grounding Check
Confirmed live against dev (both repos):
All six functional permission-gate sites, individually confirmed — not a "find them all" instruction, this is the complete list:

Web, app/admin/(shell)/events/[id]/edit/page.tsx:34 — if (!isAdminTier(role) && event.created_by_member_id !== memberId).
Web, app/admin/(shell)/events/[id]/page.tsx:40 — canManage = isAdminTier(role) || event.created_by_member_id === memberId.
Web, src/features/events/service.ts, publishEvent() (~line 273) — if (scopeToOwnerMemberId && event.created_by_member_id !== scopeToOwnerMemberId).
Web, src/features/events/service.ts, updateEvent() (~line 354) — same pattern.
Web, src/features/events/service.ts, cancelEvent() (~line 690) — if (event.created_by_member_id !== scopeToOwnerMemberId).
Mobile, app/(app)/events/[id].tsx (~line 307-311) — canEdit = ... && (isAdminTier || event.created_by_member_id === myProfileId), gating whether the Edit button even renders. Confirmed via a second, deliberately more careful sweep after an initial pass undercounted this — the first pass bucketed three separate service.ts functions as one and missed mobile's gate entirely.

How created_by_member_id is actually set today: not inside insert_event_with_audit()'s own INSERT (would require a RETURNS TABLE shape change) — instead via a follow-up, separately-scoped .update({ created_by_member_id: input.actorMemberId }) call in createEvent() (service.ts ~line 237-245), explicitly documented as a deliberate tradeoff to avoid a riskier RPC signature change. This DIP follows the same pattern for setting owner_member_id at creation time — extending that same follow-up UPDATE to also set owner_member_id = input.actorMemberId in the same call, not a second round trip.
Legacy-data fallback, must be preserved exactly: events predating FP-114-web have created_by_member_id = NULL by design (that migration's own comment: "No backfill... a natural consequence of data that predates ownership tracking, not something to retroactively invent"). This DIP's backfill for owner_member_id follows the same philosophy — backfilled from created_by_member_id where it exists, left NULL where it doesn't. A NULL owner_member_id must continue to mean "Admin-tier only can manage this event," exactly matching today's behavior — not silently changed.
Mobile type surface: EventDetail and the derived ScreenEvent type (app/(app)/events/[id].tsx) both carry created_by_member_id today, fetched only via GET /api/events/:id (confirmed absent from /api/events/mine, per that type's own existing comment) — owner_member_id needs the identical treatment: added to EventDetail, threaded through the same Partial<Pick<...>> merge pattern in ScreenEvent, confirmed present on the detail endpoint's select list, confirmed absent from the list endpoint (matching created_by_member_id's exact existing asymmetry, not a new inconsistency to introduce).
Precedent to mirror for the new mechanics (FP-146, Groups): deactivation guard as a third, independent BEFORE UPDATE ON members trigger (alongside the existing Pastoral Leader and Group Owner guards — not merged into either), single-event reassignment RPC, bulk reassignment RPC mirroring bulk_reassign_group_owner_with_audit()'s exact structure, both Admin-only.
Domain rules: no conflict — permission-model refactor and new ownership mechanics, no RSVP/attendance/formation invariant touched.
Implementation Plan

Migration: ALTER TABLE events ADD COLUMN IF NOT EXISTS owner_member_id UUID REFERENCES members(id); backfill UPDATE events SET owner_member_id = created_by_member_id WHERE owner_member_id IS NULL; (leaves NULL where created_by_member_id is itself NULL, per the legacy-fallback requirement above). New reassign_event_owner_with_audit(...) and bulk_reassign_event_owner_with_audit(...) RPCs, mirroring reassign_group_owner_with_audit/bulk_reassign_group_owner_with_audit exactly. New block_member_deactivation_if_owns_events() trigger function + its BEFORE UPDATE ON members trigger, mirroring block_member_deactivation_if_owns_groups() exactly (message: 'Cannot deactivate member %: still owns % event(s) — reassign ownership first').
src/features/events/service.ts: extend the existing follow-up .update() in createEvent() to also set owner_member_id. Migrate all five web permission-check sites (items 1-5 above) from created_by_member_id to owner_member_id. Add reassignEventOwner/bulkReassignEventOwner wrapper functions calling the new RPCs.
src/features/members/service.ts: extend softDeleteMember's P0001 catch with a third branch for 'still owns' + 'event(s)' in the message (distinguishing from the existing 'group(s)' branch — both map to INVALID_STATE_TRANSITION, distinguished by a new ownedEventCount field, same pattern as ownedGroupCount).
New API routes: app/api/events/reassign-owner/route.ts and app/api/events/bulk-reassign-owner/route.ts, Admin-only, mirroring the Groups equivalents exactly.
Web UI: add an Admin-only "Owner" section to the Event edit page (current owner + reassign picker), mirroring GroupEditForm.tsx's Owner section.
app/api/members/route.ts: extend the INVALID_STATE_TRANSITION response serialization to also include ownedEventCount, alongside the existing assignedMemberCount/ownedGroupCount.
Mobile: add owner_member_id: string | null to EventDetail and the ScreenEvent merge in app/(app)/events/[id].tsx, matching created_by_member_id's exact existing pattern. Migrate the sixth gate (canEdit, item 6 above) from created_by_member_id to owner_member_id.
app/admin/(shell)/members/[id]/edit/MemberEditForm.tsx: add a third guard-message branch (mirroring the ownedGroupCount block added under FP-153) for ownedEventCount, linking to /admin/events since — matching Groups' precedent — no dedicated bulk-reassign UI page is planned for this either.

Files to Create/Modify
Web:

supabase/migrations/20260720000052_event_owner_transfer_and_deactivation_guard.sql (new)
src/features/events/service.ts, event.types.ts
src/features/members/service.ts
app/api/events/reassign-owner/route.ts, app/api/events/bulk-reassign-owner/route.ts (new)
app/api/members/route.ts
app/admin/(shell)/events/[id]/edit/EventEditForm.tsx (or equivalent — verify exact filename), app/admin/(shell)/events/[id]/edit/page.tsx, app/admin/(shell)/events/[id]/page.tsx
app/admin/(shell)/members/[id]/edit/MemberEditForm.tsx

Mobile:

src/features/events/types.ts
app/(app)/events/[id].tsx

Migration Files
SQL to be written by CC following the Implementation Plan above, mirroring 20260719000049_group_owner_transfer_and_deactivation_guard.sql's exact structure (backfill pattern, RPC shapes, trigger shape) adapted for events/owner_member_id per this DIP's specifics.
Branch Name
feature/FP-161-2-event-owner (web), feature/FP-161-2-event-owner-mobile (mobile) — two separate PRs, one per repo, given this spans both.
Commit Message
FP-161 (2/5): transferable Event Owner, migrating 6 live permission checks off created_by_member_id
Pull Request Description
Maps to acceptance criteria: new owner_member_id, deactivation guard, single + bulk reassignment (all mirroring FP-146 exactly), plus — the core of this phase — all six confirmed live permission-gate sites (five web, one mobile) migrated from the old immutable created_by_member_id to the new, reassignable owner_member_id. Explicitly list each of the six sites in the PR description with a checkmark, so the reviewer can verify each one individually rather than trusting a summary claim.
Jira Linkage

PDEEpicID: FP-11 (EPIC-3 — Event Lifecycle Management)
PDEStoryID: FP-161

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-161-2-event-owner.md in both repos (it governs work in both). Frozen after save in each. npm run build must pass cleanly in both. Validate the migration locally via supabase db reset (web). Open separate PRs against dev in each repo, do not merge either. Flag the manual remote-migration-apply step.
Include full diffs for every file in both repos in the completion report, and explicitly confirm each of the six numbered permission-gate sites was found and migrated — don't just assert it in prose, show the diff for each one individually.
