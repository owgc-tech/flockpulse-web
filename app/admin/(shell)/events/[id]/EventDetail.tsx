'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { EventDetailRow, EventTypeOption, GroupOption, MemberOption, MeetingResourceOption, RosterEntry, EffectiveStatus } from '@/src/features/events/event.types';
import { getMapsUrl } from '@/src/features/events/event.types';

interface Props {
  event: EventDetailRow;
  eventTypes: EventTypeOption[];
  groups: GroupOption[];
  members: MemberOption[];
  meetingResources: MeetingResourceOption[];
  token: string;
  // DIP-FP-114-web: Admin-tier OR the event's own creator. Leader-tier viewing
  // an event they didn't create gets the roster/details read-only, no mutation controls.
  canManage: boolean;
}

const STATUS_LABELS: Record<EffectiveStatus, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  LOCKED: 'Locked',
  CANCELLED: 'Cancelled',
};

const RESPONSE_LABELS = {
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  NOT_RESPONDED: 'Not responded',
} as const;

export default function EventDetail({ event, eventTypes, groups, members, meetingResources, token, canManage }: Props) {
  const router = useRouter();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterFilter, setRosterFilter] = useState<'ALL' | keyof typeof RESPONSE_LABELS>('ALL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/events/${event.id}/roster`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(body => setRoster(body.data ?? []))
      .catch(() => setRoster([]));
  }, [event.id, token]);

  const eventType = eventTypes.find(t => t.id === event.event_type_id);
  const groupById = new Map(groups.map(g => [g.id, g]));
  const memberById = new Map(members.map(m => [m.id, m]));
  const groupNames = (event.target.group_ids ?? []).map(id => groupById.get(id)?.name ?? 'Unknown group');
  const memberCount = (event.target.member_ids ?? []).length;

  // FP-107: always-optional, no event-type gating. A cross-tenant id inside food_assignment
  // (which has no write-time trigger, same precedent as target) is simply not found in the
  // members/groups maps here and silently excluded from display — not rejected.
  // DIP-FP-120-web: tracked-Zoom resolves through the meetingResources list
  // (join_url lives on meeting_resources, not on the event row); freeform
  // "other platform" carries its own url/label directly on the event.
  const meetingResource = event.online_meeting_resource_id
    ? meetingResources.find(r => r.id === event.online_meeting_resource_id)
    : null;
  const onlineMeetingLabel = meetingResource?.name ?? event.online_meeting_platform_label;
  const onlineMeetingLink = meetingResource?.join_url ?? event.online_meeting_url;

  const prayerLeader = event.prayer_leader_member_id ? memberById.get(event.prayer_leader_member_id) : null;
  const foodGroupNames = (event.food_assignment?.group_ids ?? []).map(id => groupById.get(id)?.name).filter((n): n is string => !!n);
  const foodMemberNames = (event.food_assignment?.member_ids ?? [])
    .map(id => memberById.get(id))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map(m => `${m.first_name} ${m.last_name}`);

  const canCancel = canManage && event.effective_status !== 'CANCELLED' && event.effective_status !== 'LOCKED';
  const canPublish = canManage && event.status === 'DRAFT';

  async function handlePublish() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${event.id}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body?.error?.message ?? 'Failed to publish event'); return; }
    router.refresh();
  }

  async function handleCancel() {
    if (!confirm('Cancel this event? This cannot be undone.')) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/events/${event.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body?.error?.message ?? 'Failed to cancel event'); return; }
    router.refresh();
  }

  async function handleCancelRemaining() {
    if (!event.recurrence_series_id) return;
    if (!confirm(
      'Cancel every remaining occurrence in this recurring series? This is irreversible and ' +
      'affects multiple events at once — past and already-completed occurrences are left untouched.'
    )) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/event-series/${event.recurrence_series_id}/cancel-remaining`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body?.error?.message ?? 'Failed to cancel remaining occurrences'); return; }
    router.refresh();
  }

  const visibleRoster = rosterFilter === 'ALL' ? roster : roster.filter(r => r.response === rosterFilter);

  return (
    <div className="flex flex-col gap-6">
      <a
        href="/admin/events"
        className="self-start text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        ← Back to Events
      </a>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{event.name}</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{eventType?.name ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {STATUS_LABELS[event.effective_status]}
          </span>
          {canManage && (
            <a
              href={`/admin/events/${event.id}/edit`}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Edit
            </a>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {event.recurrence_series_id && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          <div className="flex items-center justify-between">
            <span>Part of a recurring series.</span>
            {canManage && (
              <button
                onClick={handleCancelRemaining}
                disabled={busy}
                className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
              >
                Cancel remaining occurrences in this series
              </button>
            )}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Start</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">{new Date(event.start_datetime).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">End</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">{new Date(event.end_datetime).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Location</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">
              {event.location_name} —{' '}
              <a href={getMapsUrl(event.location_address, event.location_url)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                {event.location_address}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Online Meeting</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">
              {onlineMeetingLink ? (
                <a href={onlineMeetingLink} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline dark:text-blue-400">
                  {onlineMeetingLabel ?? 'Join link'}
                </a>
              ) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Target</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">
              {groupNames.length > 0 ? groupNames.join(', ') : ''}
              {groupNames.length > 0 && memberCount > 0 ? ' + ' : ''}
              {memberCount > 0 ? `${memberCount} individual member${memberCount === 1 ? '' : 's'}` : ''}
              {groupNames.length === 0 && memberCount === 0 ? '—' : ''}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Prayer Leader</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">
              {prayerLeader ? `${prayerLeader.first_name} ${prayerLeader.last_name}` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Food Assignment</dt>
            <dd className="text-zinc-900 dark:text-zinc-100">
              {[...foodGroupNames, ...foodMemberNames].length > 0
                ? [...foodGroupNames, ...foodMemberNames].join(', ')
                : '—'}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex gap-3">
          {canPublish && (
            <button
              onClick={handlePublish}
              disabled={busy}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Publish
            </button>
          )}
          {canCancel && (
            <button
              onClick={handleCancel}
              disabled={busy}
              className="rounded-full border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
            >
              Cancel event
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">RSVP roster</h2>
          <div className="flex gap-2">
            {(['ALL', 'ACCEPTED', 'DECLINED', 'NOT_RESPONDED'] as const).map(f => (
              <button
                key={f}
                onClick={() => setRosterFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  rosterFilter === f
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400'
                }`}
              >
                {f === 'ALL' ? 'All' : RESPONSE_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {visibleRoster.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No one on the roster yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-2 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Member</th>
                <th className="px-2 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Response</th>
                <th className="px-2 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visibleRoster.map(r => (
                <tr key={r.member_id}>
                  <td className="px-2 py-2 text-zinc-900 dark:text-zinc-100">{r.first_name} {r.last_name}</td>
                  <td className="px-2 py-2 text-zinc-700 dark:text-zinc-300">{RESPONSE_LABELS[r.response]}</td>
                  <td className="px-2 py-2 text-zinc-500 dark:text-zinc-400">{r.rsvp_reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
