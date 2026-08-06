'use client';

import { useState } from 'react';
import type { RoleCatalogEntryRow, RoleTier } from '@/src/features/role-catalog/role-catalog.types';

interface Props {
  initialEntries: RoleCatalogEntryRow[];
  token: string;
}

const TIER_LABELS: Record<RoleTier, string> = {
  ADMIN: 'Admin tier',
  LEADER: 'Leader tier',
  MEMBER: 'Member tier',
};

const TIER_ORDER: RoleTier[] = ['ADMIN', 'LEADER', 'MEMBER'];

interface BlockedState {
  entryId: string;
  memberCount: number;
  invitationCount: number;
}

export default function RoleCatalogTable({ initialEntries, token }: Props) {
  const [entries, setEntries] = useState<RoleCatalogEntryRow[]>(initialEntries);
  const [newName, setNewName] = useState('');
  const [newTier, setNewTier] = useState<RoleTier>('MEMBER');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedState | null>(null);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!newName.trim()) { setCreateError('Name is required'); return; }
    setCreating(true);

    const res = await fetch('/api/role-catalog', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: newName.trim(), tier: newTier }),
    });
    const body = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) { setCreateError(body?.error?.message ?? 'Failed to create role'); return; }

    setEntries(prev => [...prev, body.data as RoleCatalogEntryRow]);
    setNewName('');
  }

  function startRename(entry: RoleCatalogEntryRow) {
    setEditingId(entry.id);
    setEditingName(entry.name);
    setRowError(null);
    setBlocked(null);
  }

  async function handleRename(id: string) {
    if (!editingName.trim()) { setRowError('Name cannot be empty'); return; }
    setSavingId(id);
    setRowError(null);

    const res = await fetch(`/api/role-catalog/${id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ name: editingName.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok) { setRowError(body?.error?.message ?? 'Failed to rename role'); return; }

    setEntries(prev => prev.map(e => e.id === id ? (body.data as RoleCatalogEntryRow) : e));
    setEditingId(null);
  }

  async function handleDelete(entry: RoleCatalogEntryRow) {
    if (!confirm(`Delete "${entry.name}"? This cannot be undone.`)) return;
    setSavingId(entry.id);
    setRowError(null);
    setBlocked(null);

    const res = await fetch(`/api/role-catalog/${entry.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ deleted_at: new Date().toISOString() }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingId(null);
    if (!res.ok) {
      if (res.status === 409 && body?.error?.code === 'INVALID_STATE_TRANSITION') {
        setBlocked({
          entryId: entry.id,
          memberCount: body.error.memberCount ?? 0,
          invitationCount: body.error.invitationCount ?? 0,
        });
        return;
      }
      setRowError(body?.error?.message ?? 'Failed to delete role');
      return;
    }

    setEntries(prev => prev.map(e => e.id === entry.id ? (body.data as RoleCatalogEntryRow) : e));
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleCreate} className="flex items-end gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-1 flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">New role name</label>
          <input className={inputClass} value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Youth Coordinator" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Tier</label>
          <select className={inputClass} value={newTier} onChange={e => setNewTier(e.target.value as RoleTier)}>
            {TIER_ORDER.map(t => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
          </select>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {creating ? 'Adding…' : 'Add role'}
        </button>
      </form>
      {createError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {createError}
        </div>
      )}

      {TIER_ORDER.map(tier => {
        const tierEntries = entries.filter(e => e.tier === tier);
        if (tierEntries.length === 0) return null;
        return (
          <div key={tier} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{TIER_LABELS[tier]}</h2>
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {tierEntries.map(entry => (
                    <tr key={entry.id}>
                      <td className="px-4 py-3">
                        {editingId === entry.id ? (
                          <input
                            className={inputClass}
                            value={editingName}
                            onChange={e => setEditingName(e.target.value)}
                            autoFocus
                          />
                        ) : (
                          <span className={entry.deleted_at ? 'text-zinc-400 line-through dark:text-zinc-600' : 'font-medium text-zinc-900 dark:text-zinc-100'}>
                            {entry.name}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {entry.deleted_at ? (
                          <span className="text-xs text-zinc-400 dark:text-zinc-600">Deleted</span>
                        ) : editingId === entry.id ? (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleRename(entry.id)}
                              disabled={savingId === entry.id}
                              className="rounded px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
                            >
                              {savingId === entry.id ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => startRename(entry)}
                              className="rounded px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            >
                              Rename
                            </button>
                            <button
                              onClick={() => handleDelete(entry)}
                              disabled={savingId === entry.id}
                              className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rowError && editingId === null && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {rowError}
              </div>
            )}
            {blocked && tierEntries.some(e => e.id === blocked.entryId) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Still assigned to {blocked.memberCount} member{blocked.memberCount === 1 ? '' : 's'}
                {blocked.invitationCount > 0 ? ` and ${blocked.invitationCount} pending invitation${blocked.invitationCount === 1 ? '' : 's'}` : ''}.
                Reassign {(blocked.memberCount + blocked.invitationCount) === 1 ? 'it' : 'them'} first via{' '}
                <a href={`/admin/roles/${blocked.entryId}/reassign`} className="font-medium underline hover:no-underline">
                  Bulk Reassign
                </a>.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
