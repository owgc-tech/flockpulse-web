'use client';

import { useEffect, useState } from 'react';
import { signOutAction } from '@/app/admin/(shell)/actions';

interface Props {
  firstName: string | null;
  lastName: string | null;
  groups: { id: string; name: string }[];
}

export default function UserAvatarMenu({ firstName, lastName, groups }: Props) {
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
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-500 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
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
          <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
            <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">{fullName}</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {groups.length > 0 ? groups.map(g => g.name).join(', ') : 'No groups'}
            </p>

            <div className="mt-4 flex flex-col gap-1 border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <a
                href="/admin/profile"
                className="rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                View and Edit Profile
              </a>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="w-full rounded-lg px-2 py-1.5 text-left text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                >
                  Sign Out
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
