'use client';

import type { SeriesFrequency } from '@/src/features/events/event.types';

interface Props {
  frequency: SeriesFrequency;
  onFrequencyChange: (f: SeriesFrequency) => void;
  mode: 'COUNT' | 'UNTIL';
  onModeChange: (m: 'COUNT' | 'UNTIL') => void;
  count: number;
  onCountChange: (n: number) => void;
  until: string;
  onUntilChange: (s: string) => void;
  cap: number;
  impliedCount: number | null;
  overCap: boolean;
}

const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';
const fieldClass = 'flex flex-col gap-1.5';

// Shared between EventForm.tsx's Create-mode "Repeats" toggle and its Edit-mode "Make this a
// recurring series" action (FP-106) — same frequency/mode/count/until UI and implied-count
// preview in both places, factored out so the two never diverge in behavior.
export default function RepeatsFields({
  frequency, onFrequencyChange, mode, onModeChange, count, onCountChange, until, onUntilChange,
  cap, impliedCount, overCap,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      <div className={fieldClass}>
        <label className={labelClass}>Frequency</label>
        <select className={inputClass} value={frequency} onChange={e => onFrequencyChange(e.target.value as SeriesFrequency)}>
          <option value="WEEKLY">Weekly (up to 52)</option>
          <option value="FORTNIGHTLY">Fortnightly (up to 26)</option>
          <option value="MONTHLY">Monthly (up to 12)</option>
        </select>
      </div>

      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="radio" checked={mode === 'COUNT'} onChange={() => onModeChange('COUNT')} />
          Repeat N times
        </label>
        <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="radio" checked={mode === 'UNTIL'} onChange={() => onModeChange('UNTIL')} />
          Ends on date
        </label>
      </div>

      {mode === 'COUNT' ? (
        <div className={fieldClass}>
          <label className={labelClass}>Number of occurrences</label>
          <input
            type="number" min={1} max={cap} className={inputClass}
            value={count} onChange={e => onCountChange(Number(e.target.value))}
          />
        </div>
      ) : (
        <div className={fieldClass}>
          <label className={labelClass}>Ends on</label>
          <input type="date" className={inputClass} value={until} onChange={e => onUntilChange(e.target.value)} />
        </div>
      )}

      {impliedCount !== null && (
        <p className={`text-xs ${overCap ? 'text-red-600 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'}`}>
          {overCap
            ? `${impliedCount} occurrences would be generated — exceeds the cap of ${cap} for ${frequency.toLowerCase()} events.`
            : `${impliedCount} occurrence${impliedCount === 1 ? '' : 's'} will be generated.`}
        </p>
      )}
    </div>
  );
}
