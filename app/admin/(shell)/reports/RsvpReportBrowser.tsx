'use client';

import { useState, useTransition } from 'react';

interface Option {
  id: string;
  name: string;
}

interface MemberOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface RsvpReportRow {
  event_id: string;
  event_name: string;
  member_id: string;
  first_name: string;
  last_name: string;
  rsvp_status: 'YES' | 'NO' | 'NO_RESPONSE';
  rsvp_reason: string | null;
}

interface Props {
  events: Option[];
  groups: Option[];
  members: MemberOption[];
  token: string;
}

function memberDisplayName(m: { first_name: string | null; last_name: string | null; email: string }) {
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ');
  return name || m.email;
}

const selectClass =
  'rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500';

export default function RsvpReportBrowser({ events, groups, members, token }: Props) {
  const [eventId, setEventId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [rows, setRows] = useState<RsvpReportRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleRun() {
    setLoadError(null);
    setHasSearched(true);
    startTransition(async () => {
      const params = new URLSearchParams();
      if (eventId) params.set('event_id', eventId);
      if (groupId) params.set('group_id', groupId);
      if (memberId) params.set('member_id', memberId);

      try {
        const res = await fetch(`/api/reports/rsvp?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!res.ok) {
          setLoadError(body?.error?.message ?? 'Failed to load RSVP report');
          setRows(null);
          return;
        }
        setRows(body.data as RsvpReportRow[]);
      } catch {
        setLoadError('Failed to load RSVP report');
        setRows(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Event</label>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={selectClass}>
            <option value="">All events</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Group</label>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={selectClass}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Member</label>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={selectClass}>
            <option value="">All members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{memberDisplayName(m)}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleRun}
          disabled={isPending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? 'Loading...' : 'Run Report'}
        </button>
      </div>

      {loadError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{loadError}</p>
      )}

      {!hasSearched && !loadError && (
        <p className="py-8 text-center text-sm text-zinc-400">Choose filters and run the report.</p>
      )}

      {hasSearched && !isPending && rows && rows.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-400">No RSVP records match these filters.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Event</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Member</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">RSVP</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.event_id}:${row.member_id}`} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{row.event_name}</td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{row.first_name} {row.last_name}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        row.rsvp_status === 'YES'
                          ? 'font-medium text-green-600 dark:text-green-400'
                          : row.rsvp_status === 'NO'
                          ? 'font-medium text-red-600 dark:text-red-400'
                          : 'text-zinc-400'
                      }
                    >
                      {row.rsvp_status === 'NO_RESPONSE' ? 'No Response' : row.rsvp_status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{row.rsvp_reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
