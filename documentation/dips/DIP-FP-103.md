# DIP-FP-103 — Role-aware post-registration confirmation screen

## Problem

`/register/complete` (the general invite completion screen, FP-55) currently shows every registrant the same static "download the app" message regardless of their role. Admin invitees can log in to the web dashboard immediately after completing registration — but the screen gives them no indication of this and no link to do so. Leader and Member invitees are mobile-only and the current message is correct for them.

The founder flow (`/register/founder/complete`, FP-101) is **not affected** — `FounderCompleteForm.tsx` already renders an explicit "Continue to Login" button on success. No change is needed there.

## Scope

Confirmation-screen conditional rendering only. No backend changes, no new routes, no schema changes, no migration.

## Verification needed before implementation

Confirm whether the same static-copy gap exists on both `/register/complete` (general invite completion, FP-55) and `/register/founder/complete` (founder flow, FP-101), or only the former. Don't assume — check both files.

Also confirm the exact `app_metadata.role` claim shape live against `proxy.ts` before wiring this up, don't assume the field name from memory.

## Fix — `app/register/complete/CompleteProfileForm.tsx`

`role` state is already populated from `app_metadata.role` before `state.success` renders (the `useEffect` on mount calls `db.auth.getUser(token)` and runs `setRole(...)`). No new state or fetching is needed.

Replace the static success block:

```tsx
if (state.success) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-green-200 bg-green-50 p-6 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
      <p className="font-medium">Registration complete.</p>
      <p className="text-sm">Download the FlockPulse app to get started. Your login email is the address your invitation was sent to.</p>
    </div>
  );
}
```

With a role-conditional block:

```tsx
if (state.success) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-green-200 bg-green-50 p-6 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
      <p className="font-medium">Registration complete.</p>
      {role === 'ADMIN' && (
        <p className="text-sm">
          As an admin, you can{' '}
          <a href="/login" className="font-medium underline">
            sign in to the FlockPulse admin dashboard
          </a>{' '}
          right away.
        </p>
      )}
      <p className="text-sm">Download the FlockPulse app to get started. Your login email is the address your invitation was sent to.</p>
    </div>
  );
}
```

## Role claim

`proxy.ts` confirms: `user.app_metadata?.role` — string values are `'ADMIN'`, `'LEADER'`, `'MEMBER'` (uppercase).

## Process

- Branch: `feature/FP-103-role-aware-registration-complete`
- No migration needed
- Run `npm run build` clean before pushing (standing requirement)
- Open PR against `dev`, do not merge
