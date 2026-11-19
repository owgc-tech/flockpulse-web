**Instruction for CC — add Description editing to `/admin/community` (small addition, no new DIP, no migration)**

`tenants.description` already exists (migration `20260705000022`) — this is purely surfacing it in the settings page and service layer, no schema change needed.

1. **`src/features/tenant/service.ts`:**
   - `getTenantSettings`: add `description` to the `.select(...)` column list and the returned type.
   - `updateTenantSettings`: extend the `input` type to accept `description?: string | null`. Validate length — propose max 500 characters (longer than tagline's 150, since a description is naturally longer; adjustable, same as the other numbers in this DIP). Patch `description` alongside the existing `tagline`/`attendance_window_hours` handling, same pattern.

2. **`app/admin/(shell)/community/actions.ts`:** extend `updateTaglineAction` to also read and save `description` from the form data, and rename it to `updateCommunityDetailsAction` to reflect that it now handles more than just the tagline. Update the one call site in `CommunitySettingsForm.tsx` accordingly.

3. **`app/admin/(shell)/community/CommunitySettingsForm.tsx`:** add a Description textarea to the same card as Tagline (rename that card's heading from "Tagline" to something like "Community Details" or "About") — both fields save together via the one extended action, one Save button, rather than two separate save flows. Description gets its own character counter matching the tagline pattern (`x/500`).

4. **Explicitly not in scope:** the `CommunityBanner` does not show description — that stays tagline-only, matching what's already shipped. Description is settings-page-only for now, matching how it already behaves.

**Process:**
- Branch off current `dev`: `feature/FP-104-community-description-edit`
- Run `npm run build` clean before pushing
- Re-run `npx tsx scripts/test-fp104-nav-shell-community-banner.ts`, and add 2–3 new tests for description (set/clear/tenant-isolation, mirroring the existing tagline tests) — expect all passing
- Open PR against `dev`, don't merge — I'll review, then you'll apply-and-test on the deployed environment same as everything else
