'use client';

import { useState, useTransition } from 'react';
import type { EventTypeRow } from '@/src/features/event-types/event-type.types';

type EventTypeWithCount = EventTypeRow & { event_count: number };

interface Props {
  initialEventTypes: EventTypeWithCount[];
  token: string;
}

export default function EventTypesTable({ initialEventTypes, token }: Props) {
  const [eventTypes, setEventTypes] = useState<EventTypeWithCount[]>(initialEventTypes);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  function handleCreate() {
    if (!newName.trim() || !newCode.trim()) return;
    setError(null);
    setCreating(true);

    startTransition(async () => {
      try {
        const res = await fetch('/api/event-types', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ name: newName.trim(), code: newCode.trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body?.error?.message ?? 'Failed to create event type');
          return;
        }
        setEventTypes(prev => [...prev, { ...body.data, event_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)));
        setNewName('');
        setNewCode('');
      } catch {
        setError('Network error — please try again');
      } finally {
        setCreating(false);
      }
    });
  }

  function startEdit(t: EventTypeWithCount) {
    setEditingId(t.id);
    setEditName(t.name);
    setEditCode(t.code);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function handleSaveEdit(id: string) {
    if (!editName.trim() || !editCode.trim()) return;
    setError(null);
    setSavingId(id);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/event-types/${id}`, {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ name: editName.trim(), code: editCode.trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body?.error?.message ?? 'Failed to update event type');
          return;
        }
        setEventTypes(prev => prev.map(t => t.id === id ? { ...t, ...body.data } : t));
        setEditingId(null);
      } catch {
        setError('Network error — please try again');
      } finally {
        setSavingId(null);
      }
    });
  }

  function handleToggleArchive(t: EventTypeWithCount) {
    const archiving = t.deleted_at === null;

    if (archiving) {
      const usageNote = t.event_count > 0
        ? ` ${t.event_count} event${t.event_count === 1 ? '' : 's'} currently use${t.event_count === 1 ? 's' : ''} this type — archiving it only removes it from future selection, existing events are unaffected.`
        : '';
      if (!confirm(`Archive event type "${t.name}"?${usageNote}`)) return;
    }

    setError(null);
    setTogglingId(t.id);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/event-types/${t.id}`, {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ deleted_at: archiving ? new Date().toISOString() : null }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body?.error?.message ?? 'Failed to update event type');
          return;
        }
        setEventTypes(prev => prev.map(t2 => t2.id === t.id ? { ...t2, ...body.data } : t2));
      } catch {
        setError('Network error — please try again');
      } finally {
        setTogglingId(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Create event type</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Name</label>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Bible Study"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Code</label>
            <input
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              placeholder="e.g. bible_study"
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || isPending || !newName.trim() || !newCode.trim()}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {eventTypes.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          No event types yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Name</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Code</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Events using</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {eventTypes.map(t => {
                const isEditing = editingId === t.id;
                const archived = t.deleted_at !== null;
                return (
                  <tr key={t.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                      {isEditing ? (
                        <input
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      ) : (
                        <button onClick={() => startEdit(t)} className="hover:underline">{t.name}</button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                      {isEditing ? (
                        <input
                          value={editCode}
                          onChange={e => setEditCode(e.target.value)}
                          className="rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      ) : (
                        <button onClick={() => startEdit(t)} className="hover:underline">{t.code}</button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        archived
                          ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                          : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      }`}>
                        {archived ? 'Archived' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{t.event_count}</td>
                    <td className="px-4 py-3 text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleSaveEdit(t.id)}
                            disabled={savingId === t.id || isPending}
                            className="rounded px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
                          >
                            {savingId === t.id ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={savingId === t.id}
                            className="rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleToggleArchive(t)}
                          disabled={togglingId === t.id || isPending}
                          className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                            archived
                              ? 'text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-950'
                              : 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950'
                          }`}
                        >
                          {togglingId === t.id ? 'Saving…' : archived ? 'Restore' : 'Archive'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
