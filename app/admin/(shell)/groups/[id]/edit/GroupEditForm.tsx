'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GroupRow } from '@/src/features/groups/group.types';

interface GroupMember {
  assignment_id: string;
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

interface MemberOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface Props {
  token: string;
  group: GroupRow;
  groupMembers: GroupMember[];
  allMembers: MemberOption[];
}

export default function GroupEditForm({ token, group, groupMembers, allMembers }: Props) {
  const router = useRouter();

  const [name, setName] = useState(group.name);
  const [isPending, setIsPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addMemberId, setAddMemberId] = useState('');
  const [newOwnerId, setNewOwnerId] = useState('');
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);

  const isDeactivated = group.deleted_at !== null;
  const memberInGroupIds = new Set(groupMembers.map(m => m.id));
  const addableMembers = allMembers.filter(m => !memberInGroupIds.has(m.id));

  // FP-146: this page is entirely Admin-tier-gated already (DIP-FP-114-web), so this section
  // is implicitly Admin-only without needing a separate role prop threaded through.
  const currentOwner = allMembers.find(m => m.id === group.owner_member_id);
  const reassignableOwners = allMembers.filter(m => m.id !== group.owner_member_id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const res = await fetch(`/api/groups?id=${group.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? 'Failed to save group');
        setIsPending(false);
        return;
      }
      router.refresh();
      setIsPending(false);
    } catch {
      setError('Network error — please try again');
      setIsPending(false);
    }
  }

  async function handleAddMember() {
    if (!addMemberId) return;
    setBusy(true);
    setError(null);
    // Existing write path, unchanged — POST /api/assignments, assignmentType: 'GROUP'.
    // No new wrapper endpoint, per FP-71's AC.
    const res = await fetch('/api/assignments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: addMemberId, assignmentType: 'GROUP', groupId: group.id }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body?.error?.message ?? 'Failed to add member'); return; }
    setAddMemberId('');
    router.refresh();
  }

  async function handleRemoveMember(assignmentId: string) {
    setBusy(true);
    setError(null);
    // Existing write path, unchanged — DELETE /api/assignments?id=<assignmentId>.
    const res = await fetch(`/api/assignments?id=${assignmentId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body?.error?.message ?? 'Failed to remove member'); return; }
    router.refresh();
  }

  // FP-146: single-owner reassignment, Admin-only, calls the new dedicated endpoint —
  // distinct from the Save/rename action above since RBAC differs (rename: owner-or-admin;
  // reassign: admin-only).
  async function handleReassignOwner() {
    if (!newOwnerId) return;
    setOwnerBusy(true);
    setOwnerError(null);
    const res = await fetch('/api/groups/reassign-owner', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: group.id, newOwnerMemberId: newOwnerId }),
    });
    const body = await res.json().catch(() => ({}));
    setOwnerBusy(false);
    if (!res.ok) { setOwnerError(body?.error?.message ?? 'Failed to reassign owner'); return; }
    setNewOwnerId('');
    router.refresh();
  }

  async function handleDeactivate() {
    if (!confirm(`Deactivate "${group.name}"? Active memberships in this group will also be retired.`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/groups?id=${group.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body?.error?.message ?? 'Failed to deactivate group'); return; }
    router.push('/admin/groups');
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';

  return (
    <div className="flex flex-col gap-6">
      <a
        href="/admin/groups"
        className="self-start text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        ← Back to Groups
      </a>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Edit group</h1>
        {isDeactivated && (
          <span className="inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            Deactivated
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Name</label>
          <input className={inputClass} value={name} onChange={e => setName(e.target.value)} required />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="self-start rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? 'Saving…' : 'Save changes'}
          </button>
          <a
            href="/admin/groups"
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Cancel
          </a>
        </div>
      </form>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Membership</h2>

        {!isDeactivated && (
          <div className="mb-4 flex gap-2">
            <select className={`flex-1 ${inputClass}`} value={addMemberId} onChange={e => setAddMemberId(e.target.value)}>
              <option value="">Select a member to add…</option>
              {addableMembers.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
            <button
              type="button"
              onClick={handleAddMember}
              disabled={busy || !addMemberId}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Add
            </button>
          </div>
        )}

        {groupMembers.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No members in this group yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-2 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Member</th>
                <th className="px-2 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Email</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {groupMembers.map(m => (
                <tr key={m.assignment_id}>
                  <td className="px-2 py-2 text-zinc-900 dark:text-zinc-100">{m.first_name} {m.last_name}</td>
                  <td className="px-2 py-2 text-zinc-500 dark:text-zinc-400">{m.email}</td>
                  <td className="px-2 py-2 text-right">
                    <button
                      onClick={() => handleRemoveMember(m.assignment_id)}
                      disabled={busy}
                      className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Owner</h2>

        {ownerError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {ownerError}
          </div>
        )}

        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          Current owner: <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {currentOwner ? `${currentOwner.first_name} ${currentOwner.last_name}` : '—'}
          </span>
        </p>

        {!isDeactivated && (
          <div className="flex gap-2">
            <select className={`flex-1 ${inputClass}`} value={newOwnerId} onChange={e => setNewOwnerId(e.target.value)}>
              <option value="">Select a new owner…</option>
              {reassignableOwners.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
            <button
              type="button"
              onClick={handleReassignOwner}
              disabled={ownerBusy || !newOwnerId}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Reassign Owner
            </button>
          </div>
        )}
      </div>

      {!isDeactivated && (
        <div className="rounded-xl border border-red-200 bg-white p-6 dark:border-red-800 dark:bg-zinc-950">
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            Deactivating a group also retires all of its active memberships.
          </p>
          <button
            onClick={handleDeactivate}
            disabled={busy}
            className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            Deactivate group
          </button>
        </div>
      )}
    </div>
  );
}
