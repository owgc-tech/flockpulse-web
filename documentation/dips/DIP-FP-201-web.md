### Story Summary
Fixes three real gaps found in a full audit of the registration flow, from the actual invite email through to the post-registration screen — not just the web forms, which were already solid. (1) The invite email's "Accept your invitation" link has no styling at all — renders as tiny, easy-to-miss text on mobile, not a proper tappable button. (2) After a Member or Leader completes registration, the success screen shows only inert text ("Download the FlockPulse app to get started") with nothing clickable — a genuine dead end at the last step of onboarding. (3) Optional/lower-priority: the role shown on that same screen uses a generic hardcoded label (Admin/Leader/Member) instead of the tenant's actual configured role-catalog title.

### Repo Target
Web (Next.js) — all three issues live in the web app's registration flow; nothing mobile-side.

### Grounding Check
Confirmed live against `owgc-tech/flockpulse-web` `dev`:
- `DEFAULT_INVITE_BODY` (`invitation.service.ts`) is genuinely raw, unstyled HTML — `<a href="{{invite_link}}">Accept your invitation</a>` with zero inline styling. This is also the same template every tenant's Tiptap-edited version inherits (FP-196).
- **Real constraint on the button styling fix**: `RichTextEditor.tsx`'s Tiptap instance doesn't include the `Link` extension (confirmed during FP-196's own review) — a tenant can't insert *new* styled links via the toolbar. This DIP fixes the *default* template's button styling; a tenant who heavily edits their own body via the rich-text editor may not retain the inline styling depending on how Tiptap re-serializes existing `<a>` tags on edit — flagged honestly as a known limitation, not solved by this DIP (would need a Tiptap `Link` extension + custom button-node work to fully close, out of scope here).
- `CompleteProfileForm.tsx`'s success state only shows a "Continue to Login" button for `role === 'ADMIN'` — Member/Leader roles (the actual majority of registrants) get plain text and nothing else.
- **Real constraint on the app-link fix**: there is currently no stable, permanent public download link for either platform — iOS is TestFlight-only (each tester must be manually added to the External Testing group, a separate process from registration), and Android's install link changes with every new build. This DIP does not fabricate placeholder store links that don't exist yet. The fix is clearer *messaging* about what happens next, not a literal download button — matching the actual current onboarding process (Joseph invites testers to the app separately from this in-app flow).
- `app_metadata` set at invite time (`invitation.service.ts:94`) contains only `tenant_id`, `role`, `group_id` — not `role_catalog_entry_id`. Resolving the tenant's actual configured role title on this screen would require either adding that field to `app_metadata` at invite time, or a new lightweight endpoint this screen calls — genuine added scope beyond a one-line fix, which is why this item is marked optional below rather than required.

### Implementation Plan
1. **`invitation.service.ts` — `DEFAULT_INVITE_BODY`**: restyle the link as an inline-CSS "bulletproof button" (the standard HTML-email pattern — inline `style` attribute, not a `<style>` block, since many email clients strip those): background color, padding, border-radius, white text, `text-decoration: none`, `display: inline-block`. Keep the existing plain-text fallback link paragraph unchanged underneath, for clients that strip styling entirely.
2. **`CompleteProfileForm.tsx` success state**: for non-Admin roles, replace the inert "Download the FlockPulse app to get started" text with copy that accurately reflects the real process: registration is complete, and a separate invitation to install the mobile app will follow (or has already been sent) from their admin — not a fake/broken download button.
3. **Optional — `CompleteProfileForm.tsx` role label**: confirm at implementation time whether adding `role_catalog_entry_id` to `app_metadata` at invite time (a small addition to the same `invitation.service.ts` write from step 1's file) is acceptable scope to also resolve the real tenant-configured title here; if it adds meaningfully more risk/complexity than expected, skip it and leave the generic Admin/Leader/Member label as-is rather than force it into this DIP.

### Files to Create/Modify
- `src/features/invitations/invitation.service.ts` (modify)
- `app/register/complete/CompleteProfileForm.tsx` (modify)

### Migration Files (if applicable)
None.

### Branch Name
feature/FP-201-web-registration-mobile-polish

### Commit Message
FP-201-web: styled invite email button, fix post-registration dead-end for non-admins

### Pull Request Description
Maps to the three findings from a full registration-flow audit: the invite email's link now renders as a real, tappable button on mobile clients rather than plain text; the post-registration success screen no longer dead-ends non-admin users with inert "download the app" text, replaced with accurate next-step messaging given no stable public app-store link exists yet. Report whether the optional role-label fix (step 3) was attempted or skipped, and why.

### Jira Linkage
- PDEEpicID: FP-8
- PDEStoryID: FP-201

### Stop Point
Save this DIP verbatim to documentation/dips/DIP-FP-201-web.md and do not append executor notes, observations, or any other content to that file after the initial save. Executor observations belong exclusively in the PR description. Open the PR against dev and stop. Do not merge — the user will check out the branch locally, test it against the deployed dev environment, and merge manually.

Include full diffs for every file in your completion report per Section 5, rule 12 — not a summary.
