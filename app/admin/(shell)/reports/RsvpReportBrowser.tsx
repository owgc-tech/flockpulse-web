'use client';

import { useState, useTransition } from 'react';
import { filterByLocalDate } from '@/src/lib/dateFilter';

interface Option {
  id: string;
  name: string;
}

interface EventOption {
  id: string;
  name: string;
  start_datetime: string;
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
  rsvp_status: 'YES' | 'NO' | 'TENTATIVE' | 'NO_RESPONSE';
  rsvp_reason: string | null;
}

interface RsvpReportSummaryRow {
  event_id: string;
  event_name: string;
  yes_count: number;
  no_count: number;
  tentative_count: number;
  no_response_count: number;
}

interface Props {
  events: EventOption[];
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
  const [eventDate, setEventDate] = useState('');
  const [groupId, setGroupId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [rows, setRows] = useState<RsvpReportRow[] | null>(null);
  const [summaryRows, setSummaryRows] = useState<RsvpReportSummaryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  const visibleEvents = filterByLocalDate(events, eventDate);

  function handleEventDateChange(value: string) {
    setEventDate(value);
    const filtered = filterByLocalDate(events, value);
    if (eventId && !filtered.some((ev) => ev.id === eventId)) {
      setEventId('');
    }
  }

  function handleRun() {
    setLoadError(null);
    setHasSearched(true);
    startTransition(async () => {
      const params = new URLSearchParams();
      if (eventId) params.set('event_id', eventId);
      if (groupId) params.set('group_id', groupId);
      if (memberId) params.set('member_id', memberId);

      try {
        const [detailRes, summaryRes] = await Promise.all([
          fetch(`/api/reports/rsvp?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`/api/reports/rsvp/summary?${params.toString()}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);
        const detailBody = await detailRes.json();
        const summaryBody = await summaryRes.json();
        if (!detailRes.ok) {
          setLoadError(detailBody?.error?.message ?? 'Failed to load RSVP report');
          setRows(null);
          setSummaryRows(null);
          return;
        }
        if (!summaryRes.ok) {
          setLoadError(summaryBody?.error?.message ?? 'Failed to load RSVP summary');
          setRows(null);
          setSummaryRows(null);
          return;
        }
        setRows(detailBody.data as RsvpReportRow[]);
        setSummaryRows(summaryBody.data as RsvpReportSummaryRow[]);
      } catch {
        setLoadError('Failed to load RSVP report');
        setRows(null);
        setSummaryRows(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Event Date</label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => handleEventDateChange(e.target.value)}
            className={selectClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Event</label>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={selectClass}>
            <option value="">All events</option>
            {visibleEvents.map((ev) => (
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

      {summaryRows && summaryRows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Event</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Yes</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">No</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Tentative</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">No response</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={row.event_id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{row.event_name}</td>
                  <td className="px-4 py-2 font-medium text-green-600 dark:text-green-400">{row.yes_count}</td>
                  <td className="px-4 py-2 font-medium text-red-600 dark:text-red-400">{row.no_count}</td>
                  <td className="px-4 py-2 font-medium text-amber-600 dark:text-amber-400">{row.tentative_count}</td>
                  <td className="px-4 py-2 text-zinc-400">{row.no_response_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                          : row.rsvp_status === 'TENTATIVE'
                          ? 'font-medium text-amber-600 dark:text-amber-400'
                          : 'text-zinc-400'
                      }
                    >
                      {row.rsvp_status === 'NO_RESPONSE' ? 'No Response' : row.rsvp_status === 'TENTATIVE' ? 'Tentative' : row.rsvp_status}
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
