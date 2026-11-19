'use client';

import { useState, useTransition } from 'react';
import type { DeletedModuleRow } from '@/src/features/formation/module.service';
import { restoreModuleAction } from '../actions';

interface Props {
  initialModules: DeletedModuleRow[];
  token: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function DeletedModulesTable({ initialModules, token }: Props) {
  const [modules, setModules] = useState(initialModules);
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleRestore(id: string) {
    setErrors(prev => { const next = { ...prev }; delete next[id]; return next; });
    startTransition(async () => {
      const res = await restoreModuleAction(token, id);
      if (res.error) {
        setErrors(prev => ({ ...prev, [id]: res.error! }));
        return;
      }
      setModules(prev => prev.filter(m => m.id !== id));
    });
  }

  if (!modules.length) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white px-6 py-10 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950">
        No deleted modules.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Name</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Course</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Deleted</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {modules.map(module => {
            const parentDeleted = module.course_deleted_at !== null;
            return (
              <tr key={module.id}>
                <td className="px-4 py-3">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">{module.name}</span>
                  {module.alias && (
                    <span className="ml-2 text-xs text-zinc-400">{module.alias}</span>
                  )}
                  {errors[module.id] && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors[module.id]}</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={parentDeleted ? 'text-zinc-400 line-through' : 'text-zinc-600 dark:text-zinc-300'}>
                    {module.course_name}
                  </span>
                  {parentDeleted && (
                    <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(deleted)</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                  {module.deleted_at ? formatDate(module.deleted_at) : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  {parentDeleted ? (
                    <span
                      title={`Restore course "${module.course_name}" first`}
                      className="cursor-not-allowed rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-300 dark:border-zinc-800 dark:text-zinc-600"
                    >
                      Restore
                    </span>
                  ) : (
                    <button
                      onClick={() => handleRestore(module.id)}
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
