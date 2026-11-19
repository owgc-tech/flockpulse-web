'use client';

import { useActionState } from 'react';
import { mfaChallengeAction, type MFAChallengeState } from './actions';

const initialState: MFAChallengeState = {};

export default function MFAChallengeForm({ next }: { next: string }) {
  const boundAction = mfaChallengeAction.bind(null, next);
  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  const inputClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full tracking-widest text-center text-lg';

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="code" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Authenticator code
        </label>
        <input
          id="code" name="code" type="text" inputMode="numeric"
          pattern="[0-9]{6}" maxLength={6} required
          placeholder="000000"
          autoFocus
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? 'Verifying…' : 'Verify'}
      </button>
      <p className="text-center text-xs text-zinc-400 dark:text-zinc-600">
        <a href="/login" className="underline hover:text-zinc-600 dark:hover:text-zinc-400">
          Sign in with a different account
        </a>
      </p>
    </form>
  );
}
