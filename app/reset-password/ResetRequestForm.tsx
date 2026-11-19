'use client';

import { useActionState } from 'react';
import { requestPasswordResetAction, type ResetRequestState } from './actions';

const initialState: ResetRequestState = {};

export default function ResetRequestForm() {
  const [state, formAction, isPending] = useActionState(requestPasswordResetAction, initialState);

  const inputClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full';

  if (state.success) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
        <p className="font-medium">Check your inbox</p>
        <p className="mt-1">We sent a password reset link to your email address.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Email address
        </label>
        <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? 'Sending…' : 'Send reset link'}
      </button>
      <p className="text-center text-xs text-zinc-400 dark:text-zinc-600">
        <a href="/login" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">
          Back to sign in
        </a>
      </p>
    </form>
  );
}
