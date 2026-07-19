'use client';

import type { GroupRow } from '@/src/features/groups/group.types';

interface Props {
  groups: GroupRow[];
  memberNameById: Record<string, string>;
  viewerMemberId: string | null;
}

function GroupRows({ groups, memberNameById }: { groups: GroupRow[]; memberNameById: Record<string, string> }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-zinc-100 dark:border-zinc-800">
          <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Name</th>
          <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Owner</th>
          <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {groups.map(g => (
          <tr
            key={g.id}
            onClick={() => { window.location.href = `/admin/groups/${g.id}/edit`; }}
            className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">{g.name}</td>
            <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">
              {g.owner_member_id ? (memberNameById[g.owner_member_id] ?? '—') : '—'}
            </td>
            <td className="px-4 py-3">
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                g.deleted_at
                  ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
                  : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              }`}>
                {g.deleted_at ? 'Deactivated' : 'Active'}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function GroupsTable({ groups, memberNameById, viewerMemberId }: Props) {
  // FP-146: "My Groups" is genuinely interim-state given this page stays Admin-tier-only —
  // it's only non-empty when the viewing Admin happens to also own groups themselves. Built
  // now so it's ready the moment the page-level gate is loosened later, per the DIP's own
  // stated intent, not a bug.
  const myGroups = viewerMemberId ? groups.filter(g => g.owner_member_id === viewerMemberId) : [];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">My Groups</h2>
        {myGroups.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            You don&apos;t own any groups.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <GroupRows groups={myGroups} memberNameById={memberNameById} />
          </div>
        )}
      </div>

      <hr className="border-zinc-200 dark:border-zinc-800" />

      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">All Groups</h2>
        {groups.length === 0 ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            No groups yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <GroupRows groups={groups} memberNameById={memberNameById} />
          </div>
        )}
      </div>
    </div>
  );
}
