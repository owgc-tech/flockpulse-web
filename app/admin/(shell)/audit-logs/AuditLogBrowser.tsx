'use client';

import { Fragment, useState, useTransition } from 'react';

interface MemberOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface AuditLogRow {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_id: string | null;
  actor_name: string;
  before_value: unknown;
  after_value: unknown;
  created_at: string;
}

interface Props {
  members: MemberOption[];
  token: string;
}

function memberDisplayName(m: { first_name: string | null; last_name: string | null; email: string }) {
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ');
  return name || m.email;
}

const inputClass =
  'rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500';

const ENTITY_TYPE_OPTIONS = ['rsvp', 'self_report', 'attendance', 'event', 'group'];
const ACTION_OPTIONS = ['create', 'update', 'confirm', 'reject', 'cancel', 'auto_resolve', 'admin_override', 'leader_confirm', 'leader_reject'];

export default function AuditLogBrowser({ members, token }: Props) {
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleRun() {
    setLoadError(null);
    setHasSearched(true);
    startTransition(async () => {
      const params = new URLSearchParams();
      if (entityType) params.set('entity_type', entityType);
      if (entityId) params.set('entity_id', entityId);
      if (action) params.set('action', action);
      if (actorId) params.set('actor_id', actorId);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);

      try {
        const res = await fetch(`/api/audit-logs?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json();
        if (!res.ok) {
          setLoadError(body?.error?.message ?? 'Failed to load audit logs');
          setRows(null);
          return;
        }
        setRows(body.data as AuditLogRow[]);
      } catch {
        setLoadError('Failed to load audit logs');
        setRows(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Entity Type</label>
          <input
            type="text"
            list="entity-type-options"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="All"
            className={`${inputClass} w-36`}
          />
          <datalist id="entity-type-options">
            {ENTITY_TYPE_OPTIONS.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Entity ID</label>
          <input
            type="text"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            placeholder="UUID"
            className={`${inputClass} w-64`}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Action</label>
          <input
            type="text"
            list="action-options"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="All"
            className={`${inputClass} w-36`}
          />
          <datalist id="action-options">
            {ACTION_OPTIONS.map((a) => <option key={a} value={a} />)}
          </datalist>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-500">Actor</label>
          <select value={actorId} onChange={(e) => setActorId(e.target.value)} className={inputClass}>
            <option value="">All actors</option>
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
          {isPending ? 'Loading...' : 'Run Query'}
        </button>
      </div>

      {loadError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{loadError}</p>
      )}

      {!hasSearched && !loadError && (
        <p className="py-8 text-center text-sm text-zinc-400">Choose filters and run the query.</p>
      )}

      {hasSearched && !isPending && rows && rows.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-400">No audit log entries match these filters.</p>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Timestamp</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Entity</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Action</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500">Actor</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="px-4 py-2 whitespace-nowrap text-zinc-500">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">
                      {row.entity_type} <span className="text-xs text-zinc-400">({row.entity_id.slice(0, 8)}…)</span>
                    </td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{row.action}</td>
                    <td className="px-4 py-2 text-zinc-500">{row.actor_name}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => setExpandedId((id) => (id === row.id ? null : row.id))}
                        className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                      >
                        {expandedId === row.id ? 'Hide diff' : 'View diff'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === row.id && (
                    <tr className="border-t border-zinc-100 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
                      <td colSpan={5} className="px-4 py-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-medium text-zinc-500">Before</p>
                            <pre className="overflow-x-auto rounded-lg bg-white p-2 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                              {row.before_value ? JSON.stringify(row.before_value, null, 2) : '—'}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-medium text-zinc-500">After</p>
                            <pre className="overflow-x-auto rounded-lg bg-white p-2 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                              {row.after_value ? JSON.stringify(row.after_value, null, 2) : '—'}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
