'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { completeRegistrationAction, type CompleteRegistrationState } from './actions';

const initialState: CompleteRegistrationState = {};

function supabaseBrowserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export default function CompleteProfileForm() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem('fp_reg_token');
    if (!token) {
      setLoadError('Session expired. Please click your invitation link again.');
      return;
    }
    setAccessToken(token);

    // Read role and group from the established session's app_metadata.
    (async () => {
      const db = supabaseBrowserClient();
      const { data: { user }, error } = await db.auth.getUser(token);
      if (error || !user) {
        setLoadError('Session invalid. Please click your invitation link again.');
        return;
      }
      setRole((user.app_metadata as Record<string, string>)?.role ?? null);
      setGroupId((user.app_metadata as Record<string, string>)?.group_id ?? null);
    })();
  }, []);

  const boundAction = accessToken
    ? completeRegistrationAction.bind(null, accessToken)
    : async (_prev: CompleteRegistrationState, _fd: FormData) =>
        ({ error: 'No session' } as CompleteRegistrationState);

  const [state, formAction, isPending] = useActionState(boundAction, initialState);

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {loadError}
      </div>
    );
  }

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

  const roleLabel: Record<string, string> = { ADMIN: 'Admin', LEADER: 'Leader', MEMBER: 'Member' };

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      )}

      {/* Read-only role/group — sourced from app_metadata set at invite time */}
      <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        <span className="font-medium text-zinc-800 dark:text-zinc-200">Role: </span>
        {role ? roleLabel[role] ?? role : '—'}
        {groupId && (
          <span className="ml-4">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">Group assigned</span>
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="firstName" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            First name
          </label>
          <input
            id="firstName" name="firstName" type="text" required autoComplete="given-name"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lastName" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Last name
          </label>
          <input
            id="lastName" name="lastName" type="text" required autoComplete="family-name"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="gender" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Gender
        </label>
        <select id="gender" name="gender" required defaultValue=""
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          <option value="" disabled>Select gender</option>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="maritalStatus" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Marital status
        </label>
        <select id="maritalStatus" name="maritalStatus" required defaultValue=""
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          <option value="" disabled>Select status</option>
          <option value="SINGLE">Single</option>
          <option value="MARRIED">Married</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="birthdate" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Birthdate
        </label>
        <input
          id="birthdate" name="birthdate" type="date" required
          max={new Date().toISOString().split('T')[0]}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </div>

      <button type="submit" disabled={isPending || !accessToken}
        className="mt-1 rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300">
        {isPending ? 'Saving…' : 'Complete registration'}
      </button>
    </form>
  );
}
