'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RoleCatalogEntryRow } from '@/src/features/role-catalog/role-catalog.types';

interface Usage {
  members: { id: string; first_name: string; last_name: string }[];
  invitations: { id: string; email: string }[];
}

interface Props {
  token: string;
  outgoingEntry: RoleCatalogEntryRow;
  tierOptions: RoleCatalogEntryRow[]; // same tier, excludes outgoingEntry
  usage: Usage;
}

export default function RoleReassignForm({ token, outgoingEntry, tierOptions, usage }: Props) {
  const router = useRouter();

  const [toEntryId, setToEntryId] = useState(tierOptions[0]?.id ?? '');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const backHref = '/admin/roles';
  const totalCount = usage.members.length + usage.invitations.length;

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!toEntryId) { setError('Select a role to reassign to'); return; }
    setIsPending(true);

    try {
      const res = await fetch(`/api/role-catalog/${outgoingEntry.id}/reassign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEntryId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? 'Failed to reassign');
        setIsPending(false);
        return;
      }
      router.push(backHref);
    } catch {
      setError('Network error — please try again');
      setIsPending(false);
    }
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';
  const fieldClass = 'flex flex-col gap-1.5';

  return (
    <div className="flex flex-col gap-6">
      <a
        href={backHref}
        className="self-start text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        ← Back to Roles
      </a>

      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Bulk reassign role</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Move every member and pending invitation currently on &quot;{outgoingEntry.name}&quot; to a different role in the same tier.
        </p>
      </div>

      <form onSubmit={handleConfirm} className="flex flex-col gap-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className={fieldClass}>
          <label className={labelClass}>Outgoing role</label>
          <input className={inputClass} value={outgoingEntry.name} disabled />
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>
            Currently assigned ({totalCount})
          </label>
          {totalCount === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No one is currently on this role.</p>
          ) : (
            <ul className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              {usage.members.map(m => (
                <li key={m.id}>{m.first_name} {m.last_name}</li>
              ))}
              {usage.invitations.map(i => (
                <li key={i.id} className="text-zinc-500 dark:text-zinc-400">{i.email} <span className="text-xs">(pending invite)</span></li>
              ))}
            </ul>
          )}
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>New role</label>
          {tierOptions.length === 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              No other role exists in this tier yet — add one on the Roles page first.
            </p>
          ) : (
            <select
              className={inputClass}
              value={toEntryId}
              onChange={e => setToEntryId(e.target.value)}
              disabled={totalCount === 0}
            >
              {tierOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending || totalCount === 0 || tierOptions.length === 0}
            className="self-start rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? 'Reassigning…' : 'Confirm reassignment'}
          </button>
          <a
            href={backHref}
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
