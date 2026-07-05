'use client';

import { useState, useTransition } from 'react';
import type { InvitationDisplayRow, InvitationStatus } from '@/src/features/invitations/invitation.types';

interface Props {
  initialInvitations: InvitationDisplayRow[];
  token: string;
}

const STATUS_LABELS: Record<InvitationStatus, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  REVOKED: 'Revoked',
};

const STATUS_CLASSES: Record<InvitationStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  ACCEPTED: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  REVOKED: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

const ROLE_LABELS: Record<string, string> = { ADMIN: 'Admin', LEADER: 'Leader', MEMBER: 'Member' };

export default function InvitationsTable({ initialInvitations, token }: Props) {
  const [invitations, setInvitations] = useState<InvitationDisplayRow[]>(initialInvitations);
  const [filter, setFilter] = useState<InvitationStatus | 'ALL'>('ALL');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = filter === 'ALL' ? invitations : invitations.filter(i => i.status === filter);

  async function handleRevoke(id: string, email: string) {
    if (!confirm(`Revoke invitation for ${email}? The invitation link will be permanently deactivated.`)) return;
    setError(null);
    setRevoking(id);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/invitations/${id}/revoke`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.error?.message ?? 'Failed to revoke invitation');
          setRevoking(null);
          return;
        }
        setInvitations(prev =>
          prev.map(inv => inv.id === id ? { ...inv, status: 'REVOKED' as InvitationStatus } : inv)
        );
      } catch {
        setError('Network error — please try again');
      } finally {
        setRevoking(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Status filter */}
      <div className="flex gap-2">
        {(['ALL', 'PENDING', 'ACCEPTED', 'REVOKED'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === s
                ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'
            }`}
          >
            {s === 'ALL' ? 'All' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          No invitations{filter !== 'ALL' ? ` with status ${STATUS_LABELS[filter]}` : ''}.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Email</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Role</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Group</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Invited by</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Invited</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Responded</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visible.map(inv => (
                <tr key={inv.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900">
                  <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">{inv.email}</td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{ROLE_LABELS[inv.role] ?? inv.role}</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{inv.group_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[inv.status]}`}>
                      {STATUS_LABELS[inv.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{inv.inviter_name}</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                    {new Date(inv.invited_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                    {inv.responded_at ? new Date(inv.responded_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {inv.status === 'PENDING' && (
                      <button
                        onClick={() => handleRevoke(inv.id, inv.email)}
                        disabled={revoking === inv.id || isPending}
                        className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        {revoking === inv.id ? 'Revoking…' : 'Revoke'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
