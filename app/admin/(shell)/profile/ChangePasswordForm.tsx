'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/src/lib/supabase/browser';

// DIP-FP-186-web: calls Supabase Auth's client-side updateUser({ password })
// directly against the caller's own browser session — the same
// createSupabaseBrowserClient() helper this codebase already defines (via
// @supabase/ssr) but hadn't yet had a caller for. Shares cookie-based session
// state with createSupabaseServerClient() (the page this form renders on is
// server-rendered via that client), so no token/session needs to be passed
// in — deliberately not routed through a 'use server' action + the
// service-role client the way ProfileForm.tsx's own save flow is, since that
// admin.updateUserById() path is for managing *other* members' auth
// (registration/invitation), not this account's own password.
export default function ChangePasswordForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    // Same rule and same wording as registration's set-password page and the
    // password-reset confirm flow — not a new rule invented here.
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setIsPending(true);
    const supabase = createSupabaseBrowserClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsPending(false);

    if (updateError) {
      setError('Could not update password: ' + updateError.message);
      return;
    }

    setPassword('');
    setConfirm('');
    setSuccess(true);
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="new-password" className={labelClass}>New password</label>
        <input
          id="new-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={e => { setPassword(e.target.value); setSuccess(false); }}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm-password" className={labelClass}>Confirm new password</label>
        <input
          id="confirm-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={e => { setConfirm(e.target.value); setSuccess(false); }}
          className={inputClass}
        />
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {success && <p className="text-sm text-green-600 dark:text-green-400">Password updated.</p>}

      <div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? 'Updating…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}
