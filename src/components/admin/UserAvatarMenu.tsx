'use client';

import { useEffect, useState } from 'react';
import { signOutAction } from '@/app/admin/(shell)/actions';
import { ROLE_LABELS } from '@/src/lib/auth/roleLabels';
import type { Role } from '@/src/lib/auth/middleware';

interface Props {
  firstName: string | null;
  lastName: string | null;
  role: Role;
  groups: { id: string; name: string }[];
}

export default function UserAvatarMenu({ firstName, lastName, role, groups }: Props) {
  const [open, setOpen] = useState(false);

  const fullName = [firstName, lastName].filter(Boolean).join(' ') || 'Account';
  const initials = [firstName, lastName]
    .map(n => n?.charAt(0) ?? '')
    .join('')
    .toUpperCase() || '?';

  // Same Escape-to-dismiss convention as FormationOverlay.tsx.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-black text-sm font-semibold text-white hover:bg-zinc-800"
        aria-label="Account menu"
      >
        {initials}
      </button>

      {open && (
        <>
          {/* Same click-on-backdrop-only dismiss convention as FormationOverlay.tsx,
              scaled down to a transparent full-screen catcher behind the anchored panel. */}
          <div
            className="fixed inset-0 z-40"
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex flex-col items-center">
              <div className="flex h-24 w-24 flex-shrink-0 items-center justify-center rounded-full bg-black text-2xl font-semibold text-white">
                {initials}
              </div>
              <p className="mt-3 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{fullName}</p>
              <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{ROLE_LABELS[role]}</p>
            </div>

            <div className="mt-4">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Groups:</p>
              <p className="mt-0.5 text-xs text-zinc-700 dark:text-zinc-300">
                {groups.length > 0 ? groups.map(g => g.name).join(', ') : 'No groups'}
              </p>
            </div>

            <a
              href="/admin/profile"
              className="mt-4 flex w-full items-center justify-center rounded-full bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              View/Edit Profile
            </a>

            <div className="mt-3 flex justify-end">
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
