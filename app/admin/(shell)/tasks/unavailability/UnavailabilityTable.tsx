'use client';

import { useState } from 'react';
import type { AdminUnavailabilityRow } from '@/src/features/members/member_unavailability.repository';

interface MemberOption {
  id: string;
  first_name: string;
  last_name: string;
}

interface Props {
  initialRanges: AdminUnavailabilityRow[];
  members: MemberOption[];
  token: string;
}

// DIP-FP-199-web: the name filter lists every member, not only those with a
// filed range — seeing "no results" for a specific person is itself useful
// (confirms they have nothing filed), and a dropdown that silently excludes
// people would be less transparent, not more useful. Default state (no
// filter) matches this behavior too — see the initial "" option below.
export default function UnavailabilityTable({ initialRanges, members, token }: Props) {
  const [ranges, setRanges] = useState<AdminUnavailabilityRow[]>(initialRanges);
  const [memberId, setMemberId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);

  const sortedMembers = [...members].sort((a, b) =>
    `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)
  );
  const memberById = new Map(members.map(m => [m.id, m]));

  async function applyFilters(nextMemberId: string, nextStartDate: string, nextEndDate: string) {
    // Both-or-neither, mirrored client-side — the actual enforcement is
    // server-side in listUnavailabilityForAdmin().
    if (Boolean(nextStartDate) !== Boolean(nextEndDate)) {
      setFilterError('Start date and end date must both be set, or both cleared.');
      return;
    }
    setFilterError(null);
    setLoading(true);

    const params = new URLSearchParams();
    if (nextMemberId) params.set('memberId', nextMemberId);
    if (nextStartDate) params.set('startDate', nextStartDate);
    if (nextEndDate) params.set('endDate', nextEndDate);

    const res = await fetch(`/api/members/unavailability?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setFilterError(body?.error?.message ?? 'Failed to load unavailability'); return; }
    setRanges(body.data as AdminUnavailabilityRow[]);
  }

  function handleMemberChange(value: string) {
    setMemberId(value);
    applyFilters(value, startDate, endDate);
  }

  function handleStartDateChange(value: string) {
    setStartDate(value);
    applyFilters(memberId, value, endDate);
  }

  function handleEndDateChange(value: string) {
    setEndDate(value);
    applyFilters(memberId, startDate, value);
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const labelClass = 'text-xs font-medium text-zinc-500 dark:text-zinc-400';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Member</label>
          <select
            value={memberId}
            onChange={e => handleMemberChange(e.target.value)}
            className={inputClass}
          >
            <option value="">All members</option>
            {sortedMembers.map(m => (
              <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>From</label>
          <input
            type="date"
            value={startDate}
            onChange={e => handleStartDateChange(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>To</label>
          <input
            type="date"
            value={endDate}
            onChange={e => handleEndDateChange(e.target.value)}
            className={inputClass}
          />
        </div>
        {loading && <span className="text-xs text-zinc-400">Loading…</span>}
      </div>

      {filterError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {filterError}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Name</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">Start date</th>
              <th className="px-4 py-2 text-left text-xs font-semibold text-zinc-500 dark:text-zinc-400">End date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {ranges.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-zinc-400 dark:text-zinc-600">
                  No unavailability ranges found.
                </td>
              </tr>
            ) : (
              ranges.map(r => {
                const member = memberById.get(r.member_id);
                const name = member ? `${member.first_name} ${member.last_name}` : `${r.first_name} ${r.last_name}`.trim() || 'Unknown member';
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{name}</td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{r.start_date}</td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{r.end_date}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
