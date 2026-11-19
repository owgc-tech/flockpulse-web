'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { EventDetailRow, SeriesFrequency } from '@/src/features/events/event.types';
import { computeOccurrenceDates, SERIES_FREQUENCY_CAPS } from '@/src/features/events/event.types';
import RepeatsFields from './RepeatsFields';

interface Props {
  token: string;
  initialEvent: EventDetailRow;
}

// FP-106 — "Make this a recurring series." Deliberately a self-contained action with its own
// button (type="button", not type="submit") rather than folded into EventForm's main Save
// Changes submit: this is an attachment to a new series, not a content edit, so it must not be
// mixed with any other field changes the admin may have made elsewhere in the form.
export default function ConvertToSeriesSection({ token, initialEvent }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<SeriesFrequency>('WEEKLY');
  const [mode, setMode] = useState<'COUNT' | 'UNTIL'>('COUNT');
  const [count, setCount] = useState(4);
  const [until, setUntil] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The full occurrence sequence starts from this event's own current dates — index 0 is this
  // event itself, unchanged. Only used here for the live implied-count preview; the server
  // performs the same computation (and the same slice) authoritatively.
  const cap = SERIES_FREQUENCY_CAPS[frequency];
  let impliedCount: number | null = null;
  if (enabled) {
    if (mode === 'COUNT') {
      impliedCount = count;
    } else if (until) {
      impliedCount = computeOccurrenceDates(
        new Date(initialEvent.start_datetime), new Date(initialEvent.end_datetime), frequency, 'UNTIL', new Date(until)
      ).length;
    }
  }
  const overCap = impliedCount !== null && impliedCount > cap;

  async function handleConvert() {
    setError(null);
    if (overCap) {
      setError(`Occurrence count exceeds the cap of ${cap} for ${frequency.toLowerCase()} events`);
      return;
    }
    if (!confirm(
      "Make this event the first occurrence of a new recurring series? Its own details stay " +
      "exactly as they are — new sibling occurrences are generated using it as the template."
    )) return;

    setIsPending(true);
    const res = await fetch(`/api/events/${initialEvent.id}/convert-to-series`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        frequency,
        mode,
        count: mode === 'COUNT' ? count : undefined,
        untilDate: mode === 'UNTIL' ? new Date(until).toISOString() : undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setIsPending(false);
    if (!res.ok) { setError(body?.error?.message ?? 'Failed to convert to a series'); return; }
    router.push(`/admin/events/${initialEvent.id}`);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
        Make this a recurring series
      </label>

      {enabled && (
        <>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            This event&apos;s own details stay exactly as they are — new sibling occurrences are generated using it as the template.
          </p>
          <RepeatsFields
            frequency={frequency} onFrequencyChange={setFrequency}
            mode={mode} onModeChange={setMode}
            count={count} onCountChange={setCount}
            until={until} onUntilChange={setUntil}
            cap={cap} impliedCount={impliedCount} overCap={overCap}
          />
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
          <button
            type="button"
            onClick={handleConvert}
            disabled={isPending}
            className="self-start rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? 'Converting…' : 'Convert to series'}
          </button>
        </>
      )}
    </div>
  );
}
