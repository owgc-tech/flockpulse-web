'use client';

import { useState, useTransition } from 'react';
import type { DeletedTalkRow } from '@/src/features/formation/talk.service';
import { restoreTalkAction } from '../actions';

interface Props {
  initialTalks: DeletedTalkRow[];
  token: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function audienceLabel(talk: DeletedTalkRow): string {
  const groups = [
    talk.for_single_men && 'SM',
    talk.for_single_women && 'SW',
    talk.for_married_men && 'MM',
    talk.for_married_women && 'MW',
  ].filter(Boolean);
  return groups.join(', ');
}

export default function DeletedTalksTable({ initialTalks, token }: Props) {
  const [talks, setTalks] = useState(initialTalks);
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleRestore(id: string) {
    setErrors(prev => { const next = { ...prev }; delete next[id]; return next; });
    startTransition(async () => {
      const res = await restoreTalkAction(token, id);
      if (res.error) {
        setErrors(prev => ({ ...prev, [id]: res.error! }));
        return;
      }
      setTalks(prev => prev.filter(t => t.id !== id));
    });
  }

  if (!talks.length) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white px-6 py-10 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950">
        No deleted talks.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Name</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Module</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Audience</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Deleted</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {talks.map(talk => {
            const parentDeleted = talk.module_deleted_at !== null;
            return (
              <tr key={talk.id}>
                <td className="px-4 py-3">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{talk.name}</span>
                  {talk.alias && (
                    <span className="ml-2 text-xs text-zinc-400">{talk.alias}</span>
                  )}
                  {errors[talk.id] && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors[talk.id]}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={parentDeleted ? 'text-zinc-400 line-through' : 'text-zinc-600 dark:text-zinc-300'}>
                    {talk.module_name}
                  </span>
                  {parentDeleted && (
                    <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(deleted)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                  {audienceLabel(talk)}
                </td>
                <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                  {talk.deleted_at ? formatDate(talk.deleted_at) : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  {parentDeleted ? (
                    <span
                      title={`Restore module "${talk.module_name}" first`}
                      className="cursor-not-allowed rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-300 dark:border-zinc-800 dark:text-zinc-600"
                    >
                      Restore
                    </span>
                  ) : (
                    <button
                      onClick={() => handleRestore(talk.id)}
                      disabled={isPending}
                      className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Restore
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
