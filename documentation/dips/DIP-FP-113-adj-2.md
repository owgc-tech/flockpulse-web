Web repo (`owgc-tech/flockpulse-web`) — the real bug
Branch: `feature/FP-113-adj-2-role-jwt-sync` (surfaced while testing the FP-113-adj-1 role dropdown work, same lineage).
In `src/features/members/service.ts`, `updateMember()`:

1. Add `user_id` to the `.select(...)` so the function has it available (currently selects `'id, email, first_name, last_name, role'` — add `user_id`).
2. After the successful `members` update, if `input.role !== undefined`, sync the new role into the JWT claims — must preserve existing `tenant_id`/`member_id`/`group_id`, not overwrite them, following the exact same pattern already used in `invitation.service.ts` and `registration.service.ts`:
```ts
if (input.role !== undefined) {
  const { data: userData, error: getUserError } = await db.auth.admin.getUserById(data.user_id);
  if (getUserError || !userData?.user) {
    const err = new Error('Member updated but role metadata sync failed: could not load auth user') as Error & { code: string };
    err.code = 'METADATA_WRITE_FAILED';
    throw err;
  }
  const existingMeta = userData.user.app_metadata as Record<string, unknown>;
  const { error: metaError } = await db.auth.admin.updateUserById(data.user_id, {
    app_metadata: { ...existingMeta, role: input.role },
  });
  if (metaError) {
    const err = new Error(`Member updated but role metadata sync failed: ${metaError.message}`) as Error & { code: string };
    err.code = 'METADATA_WRITE_FAILED';
    throw err;
  }
}
```
3. Don't leak `user_id` in the function's return value — destructure it out before returning, since the PATCH route passes this straight back to the client and there's no reason to expose it.
4. This reuses `db` (the existing `serviceClient()` instance already in scope) — no new client needed.
5. Run `npm run build`, show the full diff.
Save as `documentation/dips/DIP-FP-113-adj-2.md`, commit `FP-113-adj-2: sync role changes into JWT app_metadata on member update`, push, open PR against `dev`. Same rule as always — I review, you merge, then test against deployed dev environment.
