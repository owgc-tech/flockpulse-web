'use client';

import type { AssigneeState, AssigneeStateEntry, EventTaskAssignmentWithRefusals } from '@/src/features/tasks/eventTaskAssignment.types';

// FP-242: one pill per assignee of a task, for the event's owner and Admin tier. Green with a
// check mark = committed, red with a cross mark = refused, grey with just the name = not yet
// responded. No state word is visible; screen readers get it from the sr-only suffix, and the
// marks are aria-hidden. Every text/background pair is >= 4.5:1 (measured, see the PR).
const PILL_CLASS: Record<AssigneeState, string> = {
  COMMITTED: 'border-green-300 bg-green-100 text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200',
  REFUSED: 'border-red-300 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200',
  PENDING: 'border-zinc-300 bg-zinc-100 text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100',
};
const MARK: Record<AssigneeState, string | null> = { COMMITTED: '✓', REFUSED: '✕', PENDING: null };
const SR_STATE: Record<AssigneeState, string> = { COMMITTED: ', committed', REFUSED: ', refused', PENDING: ', not yet responded' };
const PILL_BASE = 'rounded-full border px-2.5 py-0.5 text-xs font-medium';

function Pills({ entries, extra }: { entries: AssigneeStateEntry[]; extra?: number }) {
  return (
    <ul role="list" className="flex flex-wrap gap-1.5">
      {entries.map((e) => (
        <li key={e.member_id} className={`${PILL_BASE} ${PILL_CLASS[e.state]}`}>
          {MARK[e.state] && <span aria-hidden="true">{MARK[e.state]} </span>}
          {e.name}
          <span className="sr-only">{SR_STATE[e.state]}</span>
        </li>
      ))}
      {extra !== undefined && extra > 0 && (
        <li className={`${PILL_BASE} ${PILL_CLASS.PENDING}`}>
          +{extra} more
          <span className="sr-only"> assignees</span>
        </li>
      )}
    </ul>
  );
}

export default function AssigneePills({
  row, groupById,
}: {
  row: EventTaskAssignmentWithRefusals;
  groupById: Map<string, { name: string }>;
}) {
  const { assignee_states: states, assignee_states_total: total } = row;
  if (total === 0) {
    return <span className="text-zinc-900 dark:text-zinc-100">—</span>;
  }

  const direct = states.filter((s) => s.via_group_id === null);
  const groupIds = (row.assignee?.group_ids ?? []).filter((id) => states.some((s) => s.via_group_id === id));
  const more = total - states.length;
  const lastSection = groupIds.length > 0 ? groupIds[groupIds.length - 1] : null;

  return (
    <div className="space-y-2">
      {direct.length > 0 && <Pills entries={direct} extra={lastSection === null ? more : undefined} />}
      {groupIds.map((gid) => (
        <div key={gid}>
          <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">{groupById.get(gid)?.name ?? 'Unknown group'}</p>
          <Pills entries={states.filter((s) => s.via_group_id === gid)} extra={gid === lastSection ? more : undefined} />
        </div>
      ))}
    </div>
  );
}
