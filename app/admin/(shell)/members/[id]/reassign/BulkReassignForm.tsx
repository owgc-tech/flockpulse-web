'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemberRow } from '@/src/features/members/member.types';

interface Props {
  token: string;
  outgoingLeader: MemberRow;
  members: MemberRow[]; // active members, for the incoming-Leader dropdown
  assignedMembers: MemberRow[]; // currently assigned to outgoingLeader
}

export default function BulkReassignForm({ token, outgoingLeader, members, assignedMembers }: Props) {
  const router = useRouter();

  const incomingOptions = members.filter(m => m.id !== outgoingLeader.id);
  const [incomingLeaderId, setIncomingLeaderId] = useState(incomingOptions[0]?.id ?? '');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editHref = `/admin/members/${outgoingLeader.id}/edit`;

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!incomingLeaderId) { setError('Select an incoming Leader'); return; }
    setIsPending(true);

    try {
      const res = await fetch('/api/assignments/bulk-reassign-leader', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outgoingLeaderMemberId: outgoingLeader.id,
          incomingLeaderMemberId: incomingLeaderId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? 'Failed to reassign members');
        setIsPending(false);
        return;
      }
      router.push(editHref);
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
        href={editHref}
        className="self-start text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        ← Back to Edit Member
      </a>

      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Bulk reassign members</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Move every member currently assigned to {outgoingLeader.first_name} {outgoingLeader.last_name} to a new Pastoral Leader.
        </p>
      </div>

      <form onSubmit={handleConfirm} className="flex flex-col gap-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className={fieldClass}>
          <label className={labelClass}>Outgoing Leader</label>
          <input
            className={inputClass}
            value={`${outgoingLeader.first_name} ${outgoingLeader.last_name}`}
            disabled
          />
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>
            Currently assigned ({assignedMembers.length})
          </label>
          {assignedMembers.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">No members are currently assigned to this Leader.</p>
          ) : (
            <ul className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              {assignedMembers.map(m => (
                <li key={m.id}>{m.first_name} {m.last_name}</li>
              ))}
            </ul>
          )}
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>Incoming Leader</label>
          <select
            className={inputClass}
            value={incomingLeaderId}
            onChange={e => setIncomingLeaderId(e.target.value)}
            disabled={assignedMembers.length === 0}
          >
            {incomingOptions.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending || assignedMembers.length === 0}
            className="self-start rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? 'Reassigning…' : 'Confirm reassignment'}
          </button>
          <a
            href={editHref}
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Cancel
          </a>
        </div>
      </form>
    </div>
  );
}
