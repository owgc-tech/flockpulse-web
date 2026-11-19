'use client';

import { useState, useTransition } from 'react';
import type { CourseRow } from '@/src/features/formation/course.types';
import { restoreCourseAction } from '../actions';

interface Props {
  initialCourses: CourseRow[];
  token: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

export default function DeletedCoursesTable({ initialCourses, token }: Props) {
  const [courses, setCourses] = useState(initialCourses);
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleRestore(id: string) {
    setErrors(prev => { const next = { ...prev }; delete next[id]; return next; });
    startTransition(async () => {
      const res = await restoreCourseAction(token, id);
      if (res.error) {
        setErrors(prev => ({ ...prev, [id]: res.error! }));
        return;
      }
      setCourses(prev => prev.filter(c => c.id !== id));
    });
  }

  if (!courses.length) {
    return (
      <p className="rounded-xl border border-zinc-200 bg-white px-6 py-10 text-center text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950">
        No deleted courses.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-100 dark:border-zinc-800">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Name</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Deleted</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {courses.map(course => (
            <tr key={course.id}>
              <td className="px-4 py-3">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{course.name}</span>
                {course.alias && (
                  <span className="ml-2 text-xs text-zinc-400">{course.alias}</span>
                )}
                {errors[course.id] && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{errors[course.id]}</p>
                )}
              </td>
              <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
                {course.deleted_at ? formatDate(course.deleted_at) : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={() => handleRestore(course.id)}
                  disabled={isPending}
                  className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  Restore
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
