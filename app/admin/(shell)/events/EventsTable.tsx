'use client';

import type { EventListRow, EffectiveStatus } from '@/src/features/events/event.types';
import type { EventTypeOption, GroupOption } from '@/src/features/events/event.types';

interface Props {
  events: EventListRow[];
  eventTypes: EventTypeOption[];
  groups: GroupOption[];
}

const STATUS_LABELS: Record<EffectiveStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  LOCKED: 'Locked',
  CANCELLED: 'Cancelled',
};

const STATUS_CLASSES: Record<EffectiveStatus, string> = {
  DRAFT: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  SCHEDULED: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  COMPLETED: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  LOCKED: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export default function EventsTable({ events, eventTypes, groups }: Props) {
  const eventTypeById = new Map(eventTypes.map(t => [t.id, t]));
  const groupById = new Map(groups.map(g => [g.id, g]));

  function targetSummary(target: EventListRow['target']): string {
    const groupNames = (target.group_ids ?? []).map(id => groupById.get(id)?.name ?? 'Unknown group');
    const memberCount = (target.member_ids ?? []).length;
    const parts: string[] = [];
    if (groupNames.length > 0) parts.push(groupNames.join(', '));
    if (memberCount > 0) parts.push(`${memberCount} individual member${memberCount === 1 ? '' : 's'}`);
    return parts.length > 0 ? parts.join(' + ') : '—';
  }

  return (
    <div className="flex flex-col gap-4">
      {events.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          No events yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Name</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Type</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Date/Time</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Status</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {events.map(ev => (
                <tr
                  key={ev.id}
                  onClick={() => { window.location.href = `/admin/events/${ev.id}`; }}
                  className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{ev.name}</td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{eventTypeById.get(ev.event_type_id)?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                    {new Date(ev.start_datetime).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[ev.effective_status]}`}>
                      {STATUS_LABELS[ev.effective_status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{targetSummary(ev.target)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
