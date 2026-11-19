import type { AssigneeSelector, AssigneeState, AssigneeStateEntry, RefusedBy } from './eventTaskAssignment.types';

// FP-242: pure helpers (no I/O) for the assignee pills on GET /api/event-tasks-assignments.

export const ASSIGNEE_PILL_CAP = 100;

const STATE_RANK: Record<AssigneeState, number> = { REFUSED: 0, PENDING: 1, COMMITTED: 2 };

// Sections: direct members first (via_group_id === null), then each group in the order of
// assignee.group_ids. Within a section: REFUSED, then PENDING, then COMMITTED, then name,
// then member_id as a tie-break. Refused people sort first within their section so they
// are least likely to fall behind the cap; past 100 pills the Needs Attention strip still
// flags any refusal. Returns a new array.
export function orderAssigneeStates(
  entries: AssigneeStateEntry[], assignee: AssigneeSelector | null
): AssigneeStateEntry[] {
  const groupOrder = new Map<string, number>((assignee?.group_ids ?? []).map((id, i) => [id, i]));
  const section = (e: AssigneeStateEntry): number =>
    e.via_group_id === null ? -1 : (groupOrder.get(e.via_group_id) ?? Number.MAX_SAFE_INTEGER);
  return [...entries].sort((a, b) => {
    const s = section(a) - section(b);
    if (s !== 0) return s;
    const r = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (r !== 0) return r;
    const n = a.name.localeCompare(b.name);
    if (n !== 0) return n;
    return a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0;
  });
}

export function capAssigneeStates(
  ordered: AssigneeStateEntry[], cap: number = ASSIGNEE_PILL_CAP
): { shown: AssigneeStateEntry[]; total: number } {
  return { shown: ordered.slice(0, cap), total: ordered.length };
}

// Everyone with a REFUSED state, from the UNCAPPED list, sorted by name.
export function refusedByFromStates(entries: AssigneeStateEntry[]): RefusedBy[] {
  return entries
    .filter((e) => e.state === 'REFUSED')
    .map((e) => ({ member_id: e.member_id, name: e.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.member_id < b.member_id ? -1 : 1));
}
