DIP-FP-153.md
Story Summary
The original ticket assumed both deactivation-guard reasons (Pastoral Leader, group-ownership) showed a raw member UUID in their error message. Grounding found this is only true for the group-ownership case — the Pastoral Leader case already has proper, dedicated handling (a blockedCount state, a friendly message built from member.first_name/member.last_name, and a "Bulk Reassign" link), built under FP-73/74, and never shows a raw UUID at all. This narrows the actual fix to the group-ownership case specifically, mirroring the exact pattern that already works correctly for Pastoral Leader.
Repo Target
Web (Next.js) — owgc-tech/flockpulse-web.
Grounding Check
Confirmed live against dev:

Pastoral Leader case, confirmed already correct: handleDeactivate branches on body.error.assignedMemberCount !== undefined, sets a dedicated blockedCount state, and the render section shows `${member.first_name} ${member.last_name} is still assigned as Pastoral Leader to ${blockedCount} member(s)...` with a link to /admin/members/{id}/reassign (a real, existing bulk-reassign page for this specific case) — no raw UUID ever shown. Not touched by this DIP.
Group-ownership case, confirmed broken, and worse than first assumed: falls through to the generic setError(body?.error?.message ?? ...) banner, showing the raw server message (with the UUID) verbatim. But there's a deeper reason this can't be fixed client-side alone: app/api/members/route.ts's DELETE handler never reads or serializes ownedGroupCount from the caught error at all — it only extracts assignedMemberCount. So even after member.service.ts correctly attaches ownedGroupCount to the thrown error (from FP-146), that field never reaches the client — body.error.ownedGroupCount is always undefined today. A client-only fix would silently never trigger; the route itself must be fixed first.
No dedicated bulk-reassign UI page exists for group ownership (unlike Pastoral Leader's /admin/members/{id}/reassign) — confirmed during FP-146's own grounding: only an API endpoint exists, no UI page, matching the same precedent as the Pastoral Leader bulk endpoint (which also has no dedicated bulk UI page — the /reassign page that does exist is for the single-member Pastoral Leader case specifically). This DIP's friendly message therefore can't offer an equivalent one-click bulk action link; it directs the admin to the Groups admin page instead, where per-group reassignment already exists (GroupEditForm.tsx, built under FP-146).
Domain rules: no conflict — display-only fix, no change to the underlying blocking behavior for either guard reason.

Implementation Plan

app/api/members/route.ts: in the INVALID_STATE_TRANSITION catch branch, also extract ownedGroupCount from the caught error (mirroring how assignedMemberCount is already extracted) and include it in the JSON response.
MemberEditForm.tsx:

Add a new ownedGroupCount state (mirroring blockedCount), reset alongside it in handleDeactivate.
Add a new branch in handleDeactivate's response handling: if (res.status === 409 && body?.error?.code === 'INVALID_STATE_TRANSITION' && body.error.ownedGroupCount !== undefined) { setOwnedGroupCount(...); return; } — placed alongside the existing Pastoral Leader branch, both checked before the generic fallback.
Add a new render block (mirroring the blockedCount !== null block) shown when ownedGroupCount !== null: `${member.first_name} ${member.last_name} still owns ${ownedGroupCount} group(s). Reassign ownership from each group's edit page before deactivating.` with a link to /admin/groups.



Files to Create/Modify

app/api/members/route.ts
app/admin/(shell)/members/[id]/edit/MemberEditForm.tsx

Migration Files
Not applicable.
Branch Name
feature/FP-153-owned-groups-deactivation-message
Commit Message
FP-153: show member name instead of raw UUID in group-ownership deactivation guard message
Pull Request Description
Maps to acceptance criteria:

"Neither guard message shows a raw UUID" → Pastoral Leader confirmed already correct (untouched); group-ownership now gets the same treatment.
"Fix applies consistently to both guard reasons" → both now show friendly, name-based messages, via the same established pattern.
"Verify whether MemberEditForm.tsx is the only place these errors surface" → confirmed yes, no other admin surface currently calls this deactivation endpoint.
Found beyond the original ticket's assumption: the route itself was silently dropping ownedGroupCount — without fixing that, no client-side message change could have worked at all.

Jira Linkage

PDEEpicID: FP-8 (EPIC-2 — Member & Group Management)
PDEStoryID: FP-153

Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-153.md, frozen after save. npm run build must pass cleanly. Open PR against dev, do not merge. No migration, no remote step.
Include full diffs for both files in the completion report.
