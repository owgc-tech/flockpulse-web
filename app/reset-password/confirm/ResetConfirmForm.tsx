'use client';

import { useActionState } from 'react';
import { confirmPasswordResetAction, type ResetConfirmState } from './actions';

const initialState: ResetConfirmState = {};

// DIP-FP-108: the session is already established server-side (page.tsx's
// exchangeCodeForSession, via cookies) by the time this renders — no token
// to parse from the URL or thread through to the action.
export default function ResetConfirmForm() {
  const [state, formAction, isPending] = useActionState(confirmPasswordResetAction, initialState);

  const inputClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className={labelClass}>New password</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirmPassword" className={labelClass}>Confirm new password</label>
        <input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} autoComplete="new-password" className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? 'Updating…' : 'Set new password'}
      </button>
    </form>
  );
}
