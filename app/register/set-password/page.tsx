'use client';

// This page is the landing target for Supabase invite-email links.
// The invite link delivers: /register/set-password#access_token=...&refresh_token=...&type=invite
// URL hashes are client-side only — this must be a Client Component.
//
// Flow:
//  1. Parse access_token and refresh_token from window.location.hash.
//  2. Call supabase.auth.setSession() to establish the session.
//  3. User sets a password via supabase.auth.updateUser({ password }).
//  4. Store the access_token in sessionStorage for the next step.
//  5. Navigate to /register/complete.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

type PageState = 'loading' | 'ready' | 'submitting' | 'error';

function supabaseBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function SetPasswordPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>('loading');
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.slice(1); // strip leading '#'
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');

    if (!accessToken || !refreshToken || type !== 'invite') {
      setError('Invalid or expired invitation link. Please contact your admin for a new one.');
      setPageState('error');
      return;
    }

    const db = supabaseBrowserClient();
    db.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error: sessionError }) => {
        if (sessionError) {
          setError('Could not establish session: ' + sessionError.message);
          setPageState('error');
        } else {
          setSessionToken(accessToken);
          setPageState('ready');
        }
      });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setPageState('submitting');
    const db = supabaseBrowserClient();
    const { error: updateError } = await db.auth.updateUser({ password });

    if (updateError) {
      setError('Could not set password: ' + updateError.message);
      setPageState('ready');
      return;
    }

    // Get the fresh session token after password update.
    const { data: { session } } = await db.auth.getSession();
    const token = session?.access_token ?? sessionToken;
    if (token) sessionStorage.setItem('fp_reg_token', token);

    router.push('/register/complete');
  }

  if (pageState === 'loading') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 dark:bg-black">
        <p className="text-sm text-zinc-500">Verifying your invitation…</p>
      </main>
    );
  }

  if (pageState === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 dark:bg-black">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-8 shadow-sm dark:border-red-800 dark:bg-zinc-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          Set your password
        </h1>
        <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
          Choose a password for your FlockPulse account. You will use this to log in.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Password
            </label>
            <input
              id="password" type="password" required minLength={8}
              value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Confirm password
            </label>
            <input
              id="confirm" type="password" required minLength={8}
              value={confirm} onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>

          <button type="submit" disabled={pageState === 'submitting'}
            className="mt-1 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
            {pageState === 'submitting' ? 'Setting password…' : 'Set password'}
          </button>
        </form>
      </div>
    </main>
  );
}
