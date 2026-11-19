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

interface EventTypeOption {
  id: string;
  name: string;
}

type AttendanceReportStatus = 'ATTENDED' | 'DID_NOT_ATTEND' | 'PENDING_CONFIRMATION' | 'UNRESPONDED';

interface AttendanceReportRow {
  event_id: string;
  event_name: string;
  event_start_datetime: string;
  member_id: string;
  first_name: string;
  last_name: string;
  self_report_status: 'SELF_REPORTED_YES' | 'SELF_REPORTED_NO' | null;
  attendance_status: 'ATTENDED' | 'DID_NOT_ATTEND' | null;
  status: AttendanceReportStatus;
}

// FP-129
interface AttendanceMatrixCell {
  year: number;
  present: number;
  absent: number;
  percent: number | null;
}

interface AttendanceMatrixRow {
  member_id: string;
  first_name: string;
  last_name: string;
  years: AttendanceMatrixCell[];
}

interface AttendanceMatrixResult {
  years: number[];
  rows: AttendanceMatrixRow[];
}

// FP-130
type AttendanceGranularity = 'MEMBER' | 'GROUP' | 'COMMUNITY';

interface AttendancePercentageRow {
  key: string;
  label: string;
  present: number;
  absent: number;
  percent: number | null;
}

interface Props {
  events: EventOption[];
  groups: Option[];
  members: MemberOption[];
  eventTypes: EventTypeOption[];
  token: string;
}

function memberDisplayName(m: { first_name: string | null; last_name: string | null; email: string }) {
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ');
  return name || m.email;
}

const STATUS_LABEL: Record<AttendanceReportStatus, string> = {
  ATTENDED: 'Attended',
  DID_NOT_ATTEND: 'Did Not Attend',
  PENDING_CONFIRMATION: 'Pending Confirmation',
  UNRESPONDED: 'Unresponded',
};

const STATUS_CLASS: Record<AttendanceReportStatus, string> = {
  ATTENDED: 'font-medium text-green-600 dark:text-green-400',
  DID_NOT_ATTEND: 'font-medium text-red-600 dark:text-red-400',
  PENDING_CONFIRMATION: 'font-medium text-amber-600 dark:text-amber-400',
  UNRESPONDED: 'text-zinc-400',
};

const inputClass =
  'rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500';

// Shared between the Matrix (FP-129) and Percentage (FP-130) sections — no
// existing multi-select pattern anywhere in this codebase (every existing
// filter is a single <select>), so this is a plain checkbox list, matching
// the codebase's no-UI-library convention.
function EventTypeCheckboxList({
  eventTypes,
  selected,
  onChange,
}: {
  eventTypes: EventTypeOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">Event Types</span>
      <div className="flex min-w-[12rem] flex-wrap gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
        {eventTypes.length === 0 && <span className="text-sm text-zinc-400">No event types configured</span>}
        {eventTypes.map((et) => (
          <label key={et.id} className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={selected.includes(et.id)}
              onChange={() => toggle(et.id)}
              className="rounded border-zinc-300 dark:border-zinc-600"
            />
            {et.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function formatPercent(percent: number | null): string {
  return percent === null ? '—' : `${percent.toFixed(1)}%`;
}

// FP-129: per-member yearly Present/Absent/%Present matrix, filtered by one
// or multiple event types. Additive section below the existing detail
// table — the detail table's per-row shape can't represent this matrix
// shape without contorting one or the other (see DIP's FP-38 extension
// decision).
function AttendanceMatrixSection({ eventTypes, token }: { eventTypes: EventTypeOption[]; token: string }) {
  const [eventTypeIds, setEventTypeIds] = useState<string[]>([]);
  const [result, setResult] = useState<AttendanceMatrixResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleRun() {
    setLoadError(null);
    setHasSearched(true);
    startTransition(async () => {
      const params = new URLSearchParams();
      for (const id of eventTypeIds) params.append('event_type_id', id);

      try {
        const res = await fetch(`/api/reports/attendance/matrix?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!res.ok) {
          setLoadError(body?.error?.message ?? 'Failed to load attendance matrix');
          setResult(null);
          return;
        }
        setResult(body.data as AttendanceMatrixResult);
      } catch {
        setLoadError('Failed to load attendance matrix');
        setResult(null);
      }
    });
  }

  return (
    <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Yearly Matrix by Event Type
      </summary>
      <div className="flex flex-col gap-4 border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <EventTypeCheckboxList eventTypes={eventTypes} selected={eventTypeIds} onChange={setEventTypeIds} />
          <button
            onClick={handleRun}
            disabled={isPending}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? 'Loading...' : 'Run Matrix'}
          </button>
        </div>

        {loadError && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{loadError}</p>
        )}

        {!hasSearched && !loadError && (
          <p className="py-8 text-center text-sm text-zinc-400">Choose event types (or leave empty for all) and run the matrix.</p>
        )}

        {hasSearched && !isPending && result && result.rows.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-400">No attendance records match these filters.</p>
        )}

        {result && result.rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th rowSpan={2} className="px-4 py-2 text-left align-bottom font-medium text-zinc-500">Member</th>
                  {result.years.map((year) => (
                    <th key={year} colSpan={3} className="px-4 py-2 text-center font-medium text-zinc-500">{year}</th>
                  ))}
                </tr>
                <tr>
                  {result.years.flatMap((year) => [
                    <th key={`${year}-p`} className="px-2 py-1 text-center text-xs font-medium text-zinc-400">Present</th>,
                    <th key={`${year}-a`} className="px-2 py-1 text-center text-xs font-medium text-zinc-400">Absent</th>,
                    <th key={`${year}-pct`} className="px-2 py-1 text-center text-xs font-medium text-zinc-400">%</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.member_id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{row.first_name} {row.last_name}</td>
                    {row.years.flatMap((cell) => [
                      <td key={`${row.member_id}-${cell.year}-p`} className="px-2 py-2 text-center text-zinc-600 dark:text-zinc-400">{cell.present}</td>,
                      <td key={`${row.member_id}-${cell.year}-a`} className="px-2 py-2 text-center text-zinc-600 dark:text-zinc-400">{cell.absent}</td>,
                      <td key={`${row.member_id}-${cell.year}-pct`} className="px-2 py-2 text-center font-medium text-zinc-700 dark:text-zinc-300">{formatPercent(cell.percent)}</td>,
                    ])}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

// FP-130: date-range attendance percentage at Member/Group/Community
// granularity. Additive section below the existing detail table, same as
// the matrix section above.
function AttendancePercentageSection({ eventTypes, token }: { eventTypes: EventTypeOption[]; token: string }) {
  const [eventTypeIds, setEventTypeIds] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [granularity, setGranularity] = useState<AttendanceGranularity>('MEMBER');
  const [rows, setRows] = useState<AttendancePercentageRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleRun() {
    if (!dateFrom || !dateTo) {
      setLoadError('Start and end date are required');
      return;
    }
    setLoadError(null);
    setHasSearched(true);
    startTransition(async () => {
      const params = new URLSearchParams();
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
      params.set('granularity', granularity);
      for (const id of eventTypeIds) params.append('event_type_id', id);

      try {
        const res = await fetch(`/api/reports/attendance/percentage?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!res.ok) {
          setLoadError(body?.error?.message ?? 'Failed to load attendance percentage');
          setRows(null);
          return;
        }
        setRows(body.data as AttendancePercentageRow[]);
      } catch {
        setLoadError('Failed to load attendance percentage');
        setRows(null);
      }
    });
  }

  const labelHeader = granularity === 'MEMBER' ? 'Member' : granularity === 'GROUP' ? 'Group' : 'Community';

  return (
    <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        Attendance % by Date Range
      </summary>
      <div className="flex flex-col gap-4 border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500">Granularity</span>
            <div className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
              {(['MEMBER', 'GROUP', 'COMMUNITY'] as AttendanceGranularity[]).map((g) => (
                <label key={g} className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="radio"
                    name="attendance-percentage-granularity"
                    checked={granularity === g}
                    onChange={() => setGranularity(g)}
                  />
                  {g === 'MEMBER' ? 'Member' : g === 'GROUP' ? 'Group' : 'Community'}
                </label>
              ))}
            </div>
          </div>
          <EventTypeCheckboxList eventTypes={eventTypes} selected={eventTypeIds} onChange={setEventTypeIds} />
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
          <p className="py-8 text-center text-sm text-zinc-400">Choose a date range and granularity, then run the report.</p>
        )}

        {hasSearched && !isPending && rows && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-400">No attendance records match these filters.</p>
        )}

        {rows && rows.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">{labelHeader}</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Present</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">Absent</th>
                  <th className="px-4 py-2 text-left font-medium text-zinc-500">%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{row.label}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{row.present}</td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{row.absent}</td>
                    <td className="px-4 py-2 font-medium text-zinc-700 dark:text-zinc-300">{formatPercent(row.percent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

export default function AttendanceReportBrowser({ events, groups, members, eventTypes, token }: Props) {
  const [eventId, setEventId] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [groupId, setGroupId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<AttendanceReportRow[] | null>(null);
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
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);

      try {
        const res = await fetch(`/api/reports/attendance?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!res.ok) {
          setLoadError(body?.error?.message ?? 'Failed to load Attendance report');
          setRows(null);
          return;
        }
        setRows(body.data as AttendanceReportRow[]);
      } catch {
        setLoadError('Failed to load Attendance report');
        setRows(null);
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
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Event</label>
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} className={inputClass}>
            <option value="">All events</option>
            {visibleEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Group</label>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputClass}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Member</label>
          <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={inputClass}>
            <option value="">All members</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{memberDisplayName(m)}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
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
        <p className="py-8 text-center text-sm text-zinc-400">No attendance records match these filters.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Event</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Date</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Member</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Self-Report</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Official Attendance</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.event_id}:${row.member_id}`} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{row.event_name}</td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{new Date(row.event_start_datetime).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{row.first_name} {row.last_name}</td>
                  <td className="px-4 py-2 text-zinc-500">{row.self_report_status ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-500">{row.attendance_status ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={STATUS_CLASS[row.status]}>{STATUS_LABEL[row.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AttendanceMatrixSection eventTypes={eventTypes} token={token} />
      <AttendancePercentageSection eventTypes={eventTypes} token={token} />
    </div>
  );
}
