'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MemberRow, MemberRole } from '@/src/features/members/member.types';

interface Props {
  token: string;
  member: MemberRow;
  members: MemberRow[]; // active members only, for the Pastoral Leader dropdown
  currentLeaderMemberId: string | null;
  assignedMemberCount: number; // members currently assigned to this member as Pastoral Leader
}

export default function MemberEditForm({ token, member, members, currentLeaderMemberId, assignedMemberCount }: Props) {
  const router = useRouter();

  const [firstName, setFirstName] = useState(member.first_name);
  const [lastName, setLastName] = useState(member.last_name);
  const [email, setEmail] = useState(member.email);
  const [role, setRole] = useState<MemberRole>(member.role);
  const [leaderMemberId, setLeaderMemberId] = useState(currentLeaderMemberId ?? '');

  const [isPending, setIsPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedCount, setBlockedCount] = useState<number | null>(null);
  const [ownedGroupCount, setOwnedGroupCount] = useState<number | null>(null);
  const [ownedEventCount, setOwnedEventCount] = useState<number | null>(null);

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
        body: JSON.stringify({ firstName, lastName, email, role }),
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
          setError(leaderBody?.error?.message ?? 'Failed to save Pastoral Leader');
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

  async function handleDeactivate() {
    if (!confirm(`Deactivate ${member.first_name} ${member.last_name}? They will no longer appear in active member lists.`)) return;
    setBusy(true);
    setError(null);
    setBlockedCount(null);
    setOwnedGroupCount(null);
    setOwnedEventCount(null);
    const res = await fetch(`/api/members?id=${member.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // FP-74: still assigned as another member's Pastoral Leader — surface the Bulk Reassign
      // screen as the resolution path, per the story's AC, instead of the generic error banner.
      // FP-146 added a second guard reason (still owns groups) mapped to the same error code,
      // distinguished by which count field is present — only take this branch when it's
      // actually the Pastoral Leader case, otherwise fall through to the generic banner below.
      if (res.status === 409 && body?.error?.code === 'INVALID_STATE_TRANSITION' && body.error.assignedMemberCount !== undefined) {
        setBlockedCount(body.error.assignedMemberCount ?? null);
        return;
      }
      // FP-153: still owns groups — same error code, distinguished by ownedGroupCount instead.
      // No dedicated bulk-reassign UI page exists for group ownership (unlike Pastoral Leader's
      // /reassign), so this points to the Groups admin page, where per-group reassignment
      // already exists (GroupEditForm.tsx, built under FP-146).
      if (res.status === 409 && body?.error?.code === 'INVALID_STATE_TRANSITION' && body.error.ownedGroupCount !== undefined) {
        setOwnedGroupCount(body.error.ownedGroupCount ?? null);
        return;
      }
      // FP-161-2: still owns events — same error code, distinguished by ownedEventCount
      // instead. No dedicated bulk-reassign UI page exists for event ownership either
      // (matching Groups' precedent), so this points to the Events admin page, where
      // per-event reassignment already exists (EventForm.tsx's Owner section, built here).
      if (res.status === 409 && body?.error?.code === 'INVALID_STATE_TRANSITION' && body.error.ownedEventCount !== undefined) {
        setOwnedEventCount(body.error.ownedEventCount ?? null);
        return;
      }
      setError(body?.error?.message ?? 'Failed to deactivate member');
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
            Deactivated
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
          <select className={inputClass} value={role} onChange={e => setRole(e.target.value as MemberRole)}>
            <option value="MEMBER">Member</option>
            <option value="PASTORAL_LEADER">Pastoral Leader</option>
            <option value="LEADER">Leader</option>
            <option value="COMMUNITY_SERVANT">Community Servant</option>
            <option value="COORDINATOR">Coordinator</option>
            <option value="SR_COORDINATOR">Sr. Coordinator</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>

        <div className={fieldClass}>
          <label className={labelClass}>
            Pastoral Leader <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
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
                ? `${assignedMemberCount} member${assignedMemberCount === 1 ? '' : 's'} currently assigned to ${member.first_name} as Pastoral Leader.`
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
            Deactivating a member removes them from active member lists. Deactivation is blocked
            while the member is still someone&apos;s assigned Pastoral Leader.
          </p>
          {blockedCount !== null && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {member.first_name} {member.last_name} is still assigned as Pastoral Leader to {blockedCount} member{blockedCount === 1 ? '' : 's'}.
              Reassign {blockedCount === 1 ? 'them' : 'them all'} first via{' '}
              <a href={`/admin/members/${member.id}/reassign`} className="font-medium underline hover:no-underline">
                Bulk Reassign
              </a>.
            </div>
          )}
          {ownedGroupCount !== null && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {member.first_name} {member.last_name} still owns {ownedGroupCount} group{ownedGroupCount === 1 ? '' : 's'}.
              Reassign ownership from each group&apos;s edit page before deactivating —{' '}
              <Link href="/admin/groups" className="font-medium underline hover:no-underline">
                Groups
              </Link>.
            </div>
          )}
          {ownedEventCount !== null && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              {member.first_name} {member.last_name} still owns {ownedEventCount} event{ownedEventCount === 1 ? '' : 's'}.
              Reassign ownership from each event&apos;s edit page before deactivating —{' '}
              <Link href="/admin/events" className="font-medium underline hover:no-underline">
                Events
              </Link>.
            </div>
          )}
          <button
            onClick={handleDeactivate}
            disabled={busy}
            className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
          >
            Deactivate member
          </button>
        </div>
      )}
    </div>
  );
}
