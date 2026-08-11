### Story Summary
Adds a "← Back to Members" link to the Invite page — both the form itself ("Invite a new member") and both success states ("Invite Sent Successfully" and the partial-success warning variant from FP-196) — mirroring the exact existing link style already used on the Member Edit, Group Edit, Event Detail, and Role Reassign pages. Currently the only way back is the browser's own back button.

### Repo Target
Web (Next.js) — single file.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- Exact precedent found, not approximated: `MemberEditForm.tsx` already has `<a href="/admin/members" className="self-start text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">← Back to Members</a>` — same wording, same target, already used elsewhere. This DIP reuses it verbatim rather than inventing new copy or styling.
- `InviteForm.tsx` has exactly three return paths, none of which currently have any back-navigation link: the main form (`state.success` false), the plain success message, and the FP-196 partial-success warning message (email failed to send, but invite created).

### Implementation Plan
1. **`InviteForm.tsx`**: add the exact `← Back to Members` link (verbatim styling/markup from `MemberEditForm.tsx`) to all three return paths — above the form itself, and above both the success and warning message blocks.

### Files to Create/Modify
- `app/admin/invite/InviteForm.tsx` (modify)

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-200-web-invite-back-to-members-link

### Commit Message
FP-200-web: add Back to Members link to invite page

### Pull Request Description
Adds "← Back to Members" to the invite form and both its success states, matching the exact existing link pattern already used on Member Edit and other admin pages. No more relying on the browser back button.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-200

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-200-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
