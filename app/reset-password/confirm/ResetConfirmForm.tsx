'use client';

import { useState, useEffect, useActionState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/src/lib/supabase/browser';
import { confirmPasswordResetAction, type ResetConfirmState } from './actions';

const initialState: ResetConfirmState = {};

export default function ResetConfirmForm() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Reset links deliver tokens via URL hash — same mechanism as FP-55/FP-101.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');

    if (token && refreshToken && type === 'recovery') {
      const db = createSupabaseBrowserClient();
      db.auth.setSession({ access_token: token, refresh_token: refreshToken }).then(({ error }) => {
        if (error) {
          setLoadError('Reset link is invalid or expired. Please request a new one.');
        } else {
          window.history.replaceState(null, '', window.location.pathname);
          setAccessToken(token);
        }
      });
    } else {
      setLoadError('Invalid reset link. Please request a new one.');
    }
  }, [router]);

  const boundAction = accessToken
    ? confirmPasswordResetAction.bind(null, accessToken)
    : async (_prev: ResetConfirmState, _fd: FormData) =>
        ({ error: 'No active session.' } as ResetConfirmState);

  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  const inputClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {loadError}
        </div>
        <a href="/reset-password" className="text-center text-sm underline text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Request a new reset link
        </a>
      </div>
    );
  }

  if (!accessToken) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Verifying reset link…</p>
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
