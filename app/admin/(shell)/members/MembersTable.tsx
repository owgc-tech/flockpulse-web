'use client';

import type { MemberRow } from '@/src/features/members/member.types';

interface Props {
  members: MemberRow[];
}

export default function MembersTable({ members }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {members.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          No members yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Name</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Email</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Role</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {members.map(m => (
                <tr
                  key={m.id}
                  onClick={() => { window.location.href = `/admin/members/${m.id}/edit`; }}
                  className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{m.first_name} {m.last_name}</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{m.email}</td>
                  <td className="px-4 py-3 text-zinc-700 dark:text-zinc-300">{m.role_display_name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                      m.deleted_at
                        ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                        : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    }`}>
                      {m.deleted_at ? 'Deactivated' : 'Active'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
