'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { EventListItemRow, EffectiveStatus, EventTypeOption, GroupOption } from '@/src/features/events/event.types';
import MultiSelectFilter from './MultiSelectFilter';

interface Filters {
  eventTypeIds: string[];
  month: string;
  status: string[];
}

interface Props {
  token: string;
  initialEvents: EventListItemRow[];
  initialHasMore: boolean;
  initialFilters: Filters;
  eventTypes: EventTypeOption[];
  groups: GroupOption[];
  pageSize: number;
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

const STATUS_OPTIONS = (Object.keys(STATUS_LABELS) as EffectiveStatus[]).map(value => ({
  value,
  label: STATUS_LABELS[value],
}));

// FP-167-1: sticky title/create-button/filter band (position: sticky within
// <main>'s existing overflow-y-auto — the admin shell layout already provides
// the one scroll container this page needs; no nested double-scroll region),
// Type/Month/Status filters reflected in the URL, and infinite scroll against
// the paginated GET /api/events. No list virtualization — this app's realistic
// per-tenant event counts (a single church/community's event history) don't
// warrant the added dependency; straightforward DOM append is sufficient.
export default function EventsTable({
  token, initialEvents, initialHasMore, initialFilters, eventTypes, groups, pageSize,
}: Props) {
  const router = useRouter();

  const [events, setEvents] = useState<EventListItemRow[]>(initialEvents);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const [eventTypeIds, setEventTypeIds] = useState<string[]>(initialFilters.eventTypeIds);
  const [month, setMonth] = useState(initialFilters.month);
  const [statuses, setStatuses] = useState<string[]>(initialFilters.status);

  const eventTypeById = new Map(eventTypes.map(t => [t.id, t]));
  const groupById = new Map(groups.map(g => [g.id, g]));

  const sentinelRef = useRef<HTMLDivElement>(null);

  // FP-167-1-adj-1: the column header row needs to stick directly below the
  // title/create-button/filter band above it, not at top-0 (which would place
  // it underneath that band instead of stacking below it). The band's height
  // isn't a fixed number to hardcode, though — its filter row uses flex-wrap,
  // so selecting enough filters (or a narrow viewport) wraps it onto more
  // lines and changes the band's real height. Measuring it live via
  // ResizeObserver, rather than computing a guessed pixel value from the
  // Tailwind spacing classes by hand, is what actually stays correct across
  // that wrapping and any future content changes to the band.
  const bandRef = useRef<HTMLDivElement>(null);
  const [bandHeight, setBandHeight] = useState(0);

  useEffect(() => {
    const el = bandRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      setBandHeight(entries[0].contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fetchPage = useCallback(async (offset: number, replace: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String(offset));
      if (eventTypeIds.length > 0) params.set('eventTypeIds', eventTypeIds.join(','));
      if (month) params.set('month', month);
      if (statuses.length > 0) params.set('status', statuses.join(','));

      const res = await fetch(`/api/events?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return;

      const newEvents: EventListItemRow[] = body.data ?? [];
      setEvents(prev => (replace ? newEvents : [...prev, ...newEvents]));
      setHasMore(!!body.hasMore);
    } finally {
      setLoading(false);
    }
  }, [token, eventTypeIds, month, statuses, pageSize]);

  // Filter changes: refetch page 0 and sync the URL. Skipped on first mount —
  // initialEvents/initialFilters already reflect whatever the URL had server-side.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }

    const params = new URLSearchParams();
    if (eventTypeIds.length > 0) params.set('eventTypeIds', eventTypeIds.join(','));
    if (month) params.set('month', month);
    if (statuses.length > 0) params.set('status', statuses.join(','));
    router.replace(`/admin/events${params.toString() ? `?${params.toString()}` : ''}`, { scroll: false });

    fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventTypeIds, month, statuses]);

  // Infinite scroll — IntersectionObserver on a sentinel at the bottom of the list.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loading) {
        fetchPage(events.length, false);
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, events.length, fetchPage]);

  function targetSummary(target: EventListItemRow['target']): string {
    const groupNames = (target.group_ids ?? []).map(id => groupById.get(id)?.name ?? 'Unknown group');
    const memberCount = (target.member_ids ?? []).length;
    const parts: string[] = [];
    if (groupNames.length > 0) parts.push(groupNames.join(', '));
    if (memberCount > 0) parts.push(`${memberCount} individual member${memberCount === 1 ? '' : 's'}`);
    return parts.length > 0 ? parts.join(' + ') : '—';
  }

  // FP-167-1-adj-3: adj-2 removed overflow-hidden from the wrapper (the real
  // fix for the overlap regression) but also moved sticky from <thead> down
  // to each <th>, and that combination never actually stuck at all. adj-1's
  // thead-level sticky and adj-2's overflow-hidden removal were each verified
  // independently but never together — sticky lives on <thead> here, with the
  // overflow-hidden wrapper fix from adj-2 kept as-is.
  const thClass = 'px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400';

  return (
    <div className="flex flex-col">
      <div ref={bandRef} className="sticky top-0 z-10 bg-zinc-50 px-6 pb-4 pt-8 dark:bg-black">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Events</h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Create, schedule, and manage events for this organisation.
              </p>
            </div>
            <Link
              href="/admin/events/new"
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Create event
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <MultiSelectFilter
              label="Type"
              options={eventTypes.map(t => ({ value: t.id, label: t.name }))}
              selected={eventTypeIds}
              onChange={setEventTypeIds}
            />
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            />
            {month && (
              <button
                type="button"
                onClick={() => setMonth('')}
                className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
              >
                Clear month
              </button>
            )}
            <MultiSelectFilter label="Status" options={STATUS_OPTIONS} selected={statuses} onChange={setStatuses} />
          </div>
        </div>
      </div>

      <div className="px-6 pb-8">
        <div className="mx-auto max-w-5xl">
          {events.length === 0 && !loading ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              No events yet.
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
              <table className="w-full text-sm">
                <thead className="sticky z-[5] bg-white dark:bg-zinc-950" style={{ top: bandHeight }}>
                  <tr className="border-b border-zinc-100 dark:border-zinc-800">
                    <th className={`${thClass} rounded-tl-xl`}>Name</th>
                    <th className={thClass}>Type</th>
                    <th className={thClass}>Date/Time</th>
                    <th className={thClass}>Status</th>
                    <th className={`${thClass} rounded-tr-xl`}>Target</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {events.map((ev, idx) => {
                    const isLastRow = idx === events.length - 1;
                    return (
                      <tr
                        key={ev.id}
                        onClick={() => { window.location.href = `/admin/events/${ev.id}`; }}
                        className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
                      >
                        <td className={`px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100 ${isLastRow ? 'rounded-bl-xl' : ''}`}>{ev.name}</td>
                        <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{eventTypeById.get(ev.event_type_id)?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                          {new Date(ev.start_datetime).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[ev.effective_status]}`}>
                            {STATUS_LABELS[ev.effective_status]}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-zinc-500 dark:text-zinc-400 ${isLastRow ? 'rounded-br-xl' : ''}`}>{targetSummary(ev.target)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div ref={sentinelRef} className="h-1" />
          {loading && (
            <p className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">Loading…</p>
          )}
        </div>
      </div>
    </div>
  );
}
