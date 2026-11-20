'use client';

import { useState } from 'react';
import { blockerSentences, hasBlockers, type RemovalBlockers } from '@/src/features/members/removalBlockers';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MemberRow } from '@/src/features/members/member.types';
import type { RoleCatalogEntryRow } from '@/src/features/role-catalog/role-catalog.types';

interface Props {
  token: string;
  member: MemberRow;
  members: MemberRow[]; // active members only, for the Pastoral Leader dropdown
  currentLeaderMemberId: string | null;
  assignedMemberCount: number; // members currently assigned to this member as Pastoral Leader
  // DIP-FP-192-web: sourced from the tenant's role_catalog, same order the
  // 7 hardcoded <option> tags used to have (sort_order preserves it) —
  // dropdown looks identical for a tenant that hasn't added its own entries.
  roleCatalog: RoleCatalogEntryRow[];
}

export default function MemberEditForm({ token, member, members, currentLeaderMemberId, assignedMemberCount, roleCatalog }: Props) {
  const router = useRouter();

  const [firstName, setFirstName] = useState(member.first_name);
  const [lastName, setLastName] = useState(member.last_name);
  const [email, setEmail] = useState(member.email);
  const [roleCatalogEntryId, setRoleCatalogEntryId] = useState(
    member.role_catalog_entry_id ?? roleCatalog[0]?.id ?? ''
  );
  const [leaderMemberId, setLeaderMemberId] = useState(currentLeaderMemberId ?? '');

  const [isPending, setIsPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // FP-258: every reason the last Remove was refused (409), not just the first.
  const [blockers, setBlockers] = useState<RemovalBlockers | null>(null);

  const isDeactivated = member.deleted_at !== null;
  // A member can't be their own Pastoral Leader.
  const leaderOptions = members.filter(m => m.id !== member.id);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      const patchRes = await fetch(`/api/members?id=${member.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, roleCatalogEntryId }),
      });
      const patchBody = await patchRes.json().catch(() => ({}));
      if (!patchRes.ok) {
        setError(patchBody?.error?.message ?? 'Failed to save member');
        setIsPending(false);
        return;
      }

      // Only call the Pastoral Leader endpoint if the selection actually changed — avoids
      // spurious retire+reinsert audit entries when nothing about it was touched.
      const newLeaderId = leaderMemberId || null;
      if (newLeaderId !== (currentLeaderMemberId ?? null)) {
        const leaderRes = await fetch(`/api/members/${member.id}/pastoral-leader`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ leaderMemberId: newLeaderId }),
        });
        const leaderBody = await leaderRes.json().catch(() => ({}));
        if (!leaderRes.ok) {
          setError(leaderBody?.error?.message ?? 'Failed to save Assigned Leader');
          setIsPending(false);
          return;
        }
      }

      router.push('/admin/members');
    } catch {
      setError('Network error — please try again');
      setIsPending(false);
    }
  }

  // FP-235: "Deactivate" is now "Remove" — it deletes the person's login and identifying
  // details (their past activity stays, anonymized). Same endpoint, same guard handling.
  async function handleRemove() {
    if (!confirm(`Remove ${member.first_name} ${member.last_name}? This permanently deletes their login and personal details. Their past activity stays but shows as 'Deactivated User'. This cannot be undone. To return, they need a new invitation and start as a new member.`)) return;
    setBusy(true);
    setError(null);
    setBlockers(null);
    const res = await fetch(`/api/members?id=${member.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // FP-74 / FP-153 / FP-161-2 / FP-258: a 409 can carry several blocks at once (members led,
      // groups, events, last Administrator). Show every one, with the helpful links below.
      if (res.status === 409 && body?.error?.code === 'INVALID_STATE_TRANSITION') {
        const e = body.error;
        const found: RemovalBlockers = {
          assignedMemberCount: e.assignedMemberCount ?? 0,
          ownedGroupCount: e.ownedGroupCount ?? 0,
          ownedEventCount: e.ownedEventCount ?? 0,
          lastAdmin: e.lastAdmin === true,
        };
        if (hasBlockers(found)) {
          setBlockers(found);
          return;
        }
      }
      // FP-235: the record was scrubbed but deleting the login account failed — calling
      // Remove again finishes the job.
      if (body?.error?.code === 'AUTH_DELETE_FAILED') {
        setError('Removed, but the login account could not be deleted. Try Remove again.');
        return;
      }
      setError(body?.error?.message ?? 'Failed to remove member');
      return;
    }
    router.push('/admin/members');
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';
  const fieldClass = 'flex flex-col gap-1.5';

  return (
    <div className="flex flex-col gap-6">
      <a
        href="/admin/members"
        className="self-start text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        ← Back to Members
      </a>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Edit member</h1>
        {isDeactivated && (
          <span className="inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            Removed
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className={fieldClass}>
            <label className={labelClass}>First name</label>
            <input className={inputClass} value={firstName} onChange={e => setFirstName(e.target.value)} required />
          </div>
          <div className={fieldClass}>
            <label className={labelClass}>Last name</label>
            <input className={inputClass} value={lastName} onChange={e => setLastName(e.target.value)} required />
          </div>
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>Email</label>
          <input type="email" className={inputClass} value={email} onChange={e => setEmail(e.target.value)} required />
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>Role</label>
          <select className={inputClass} value={roleCatalogEntryId} onChange={e => setRoleCatalogEntryId(e.target.value)}>
            {roleCatalog.map(entry => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>
            Assigned Leader <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
          </label>
          <select className={inputClass} value={leaderMemberId} onChange={e => setLeaderMemberId(e.target.value)}>
            <option value="">None</option>
            {leaderOptions.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
          </select>
        </div>

        {!isDeactivated && (
          <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {assignedMemberCount > 0
                ? `${assignedMemberCount} member${assignedMemberCount === 1 ? '' : 's'} currently assigned to ${member.first_name} as Assigned Leader.`
                : 'No members currently assigned.'}
            </span>
            <a
              href={`/admin/members/${member.id}/reassign`}
              className="shrink-0 rounded-full border border-zinc-300 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-white dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Bulk Reassign{assignedMemberCount > 0 ? ` (${assignedMemberCount})` : ''}
            </a>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="self-start rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? 'Saving…' : 'Save changes'}
          </button>
          <a
            href="/admin/members"
            className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Cancel
          </a>
        </div>
      </form>

      {!isDeactivated && (
        <div className="rounded-xl border border-red-200 bg-white p-6 dark:border-red-800 dark:bg-zinc-950">
          <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
            Removing a member permanently deletes their login and personal details; their past
            activity stays but shows as &apos;Deactivated User&apos;. Removal is blocked while the
            member is still someone&apos;s Assigned Leader or still owns groups or events.
          </p>
          {blockers !== null && (
            <ul className="mb-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {blockerSentences(blockers, 'admin').map(b => (
                <li key={b.key}>
                  {b.text}{' '}
                  {b.key === 'assignedMembers' && (
                    <a href={`/admin/members/${member.id}/reassign`} className="font-medium underline hover:no-underline">
                      Bulk Reassign
                    </a>
                  )}
                  {b.key === 'groups' && (
                    <Link href="/admin/groups" className="font-medium underline hover:no-underline">
                      Groups
                    </Link>
                  )}
                  {b.key === 'events' && (
                    <Link href="/admin/events" className="font-medium underline hover:no-underline">
                      Events
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={handleRemove}
            disabled={busy}
            className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            Remove member
          </button>
        </div>
      )}
    </div>
  );
}
