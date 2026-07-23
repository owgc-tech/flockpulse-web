'use client';

import { useEffect, useMemo, useState } from 'react';
import GroupMemberChipPicker from '../../events/GroupMemberChipPicker';
import type { GroupOption, MemberOption, EventTypeOption } from '@/src/features/events/event.types';
import type { AssigneeSelector, RosterEntry, TaskAutoAssignSlotRow } from '@/src/features/tasks/eventTaskAssignment.types';
import type { TaskRow } from '@/src/features/tasks/task.types';

interface Props {
  tasks: TaskRow[];
  groups: GroupOption[];
  members: MemberOption[];
  eventTypes: EventTypeOption[];
  token: string;
}

function rosterEntryName(entry: RosterEntry, groupById: Map<string, GroupOption>, memberById: Map<string, MemberOption>): string {
  if (entry.type === 'group') return groupById.get(entry.id)?.name ?? 'Unknown group';
  const m = memberById.get(entry.id);
  return m ? `${m.first_name} ${m.last_name}` : 'Unknown member';
}

function slotAssigneeNames(
  assignee: AssigneeSelector | null, groupById: Map<string, GroupOption>, memberById: Map<string, MemberOption>
): string[] {
  const groupNames = (assignee?.group_ids ?? []).map(id => groupById.get(id)?.name ?? 'Unknown group');
  const memberNames = (assignee?.member_ids ?? [])
    .map(id => memberById.get(id))
    .filter((m): m is MemberOption => !!m)
    .map(m => `${m.first_name} ${m.last_name}`);
  return [...groupNames, ...memberNames];
}

// DIP-FP-180-adj-6: single generic panel behind /admin/tasks/auto-assign,
// replacing the old hardcoded Prayer Leader/Food Assignment panel instances.
// individualOnly is no longer route-fixed — it's read live from whichever
// task is currently selected (tasks.individual_only), since there's no
// per-route contract left to drift from once the screen works for any task.
export default function TaskAutoAssignPanel({
  tasks, groups, members, eventTypes, token,
}: Props) {
  // Starts unselected — nothing (roster, event types, slot list) is
  // meaningfully interactive until a task is picked, same "nothing shown
  // until actively chosen" posture as adj-4's event-type filter.
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  // Only ever written by the fetch effect below — slots (derived further
  // down) forces this back to [] whenever no task is selected, so the effect
  // itself never needs to call setState synchronously just to clear it.
  const [fetchedSlots, setFetchedSlots] = useState<TaskAutoAssignSlotRow[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // DIP-FP-180-adj-4: all event types start unchecked — the slot list stays
  // empty until the organizer actively opts a type in. Ephemeral per visit,
  // same as roster — nothing persisted between sessions.
  const [selectedEventTypeIds, setSelectedEventTypeIds] = useState<string[]>([]);

  // Keyed by event_id, not slot.id — a never-before-assigned slot has
  // id: null (DIP-FP-180-adj-1), so event_id is the only field guaranteed
  // unique and present for every row.
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editGroupIds, setEditGroupIds] = useState<string[]>([]);
  const [editMemberIds, setEditMemberIds] = useState<string[]>([]);
  const [savingEventId, setSavingEventId] = useState<string | null>(null);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const selectedTask = tasks.find(t => t.id === selectedTaskId) ?? null;
  const individualOnly = selectedTask?.individual_only ?? false;
  const taskLabel = selectedTask?.name ?? 'Task';

  // A roster built for one task's individual_only constraint isn't
  // necessarily valid for another, so switching tasks clears it. The
  // event-type selection is independent of which task is selected, so it's
  // left untouched.
  function handleTaskChange(taskId: string) {
    setSelectedTaskId(taskId);
    setRoster([]);
  }

  useEffect(() => {
    if (!selectedTaskId) return;
    fetch(`/api/tasks/auto-assign/slots?task_id=${selectedTaskId}&event_type_ids=${selectedEventTypeIds.join(',')}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(body => setFetchedSlots(body.data ?? []))
      .catch(() => setFetchedSlots([]));
  }, [selectedTaskId, token, selectedEventTypeIds]);

  const slots = selectedTaskId ? fetchedSlots : [];

  const groupById = useMemo(() => new Map(groups.map(g => [g.id, g])), [groups]);
  const memberById = useMemo(() => new Map(members.map(m => [m.id, m])), [members]);

  const rosterGroupIds = roster.filter(r => r.type === 'group').map(r => r.id);
  const rosterMemberIds = roster.filter(r => r.type === 'member').map(r => r.id);

  function toggleRosterGroup(id: string) {
    setRoster(prev =>
      prev.some(r => r.type === 'group' && r.id === id)
        ? prev.filter(r => !(r.type === 'group' && r.id === id))
        : [...prev, { type: 'group', id }]
    );
  }

  function toggleRosterMember(id: string) {
    setRoster(prev =>
      prev.some(r => r.type === 'member' && r.id === id)
        ? prev.filter(r => !(r.type === 'member' && r.id === id))
        : [...prev, { type: 'member', id }]
    );
  }

  function removeRosterEntry(index: number) {
    setRoster(prev => prev.filter((_, i) => i !== index));
  }

  function toggleEventType(id: string) {
    setSelectedEventTypeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  function moveRosterEntry(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= roster.length) return;
    setRoster(prev => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // Roster-scoped summary: for each roster entry, how many currently-fetched
  // slots have that entry as assignee — recalculated on every local edit.
  const summary = roster.map(entry => {
    const count = slots.filter(s => {
      if (entry.type === 'group') return (s.assignee?.group_ids ?? []).includes(entry.id);
      return (s.assignee?.member_ids ?? []).includes(entry.id);
    }).length;
    return { entry, name: rosterEntryName(entry, groupById, memberById), count };
  });

  async function handleRun() {
    if (!selectedTaskId || roster.length === 0 || selectedEventTypeIds.length === 0) return;

    const anyAssigned = slots.some(s => (s.assignee?.group_ids?.length ?? 0) > 0 || (s.assignee?.member_ids?.length ?? 0) > 0);
    if (anyAssigned && !confirm(`Some Events have a ${taskLabel} assigned already, and will be over written. Would you like to continue?`)) {
      return;
    }

    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks/auto-assign', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ task_id: selectedTaskId, roster, event_type_ids: selectedEventTypeIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? 'Failed to run auto-assign');
        return;
      }

      // Matched by event_id, not id — a previously-row-less slot has a real
      // id for the first time after this run, so matching by the old (null)
      // id would silently fail to update it locally.
      const updated = (body.data ?? []) as { id: string; event_id: string; assignee: AssigneeSelector | null }[];
      const updatedByEventId = new Map(updated.map(u => [u.event_id, u]));
      setFetchedSlots(prev => prev.map(s => {
        const match = updatedByEventId.get(s.event_id);
        return match ? { ...s, id: match.id, assignee: match.assignee } : s;
      }));
    } catch {
      setError('Network error — please try again');
    } finally {
      setRunning(false);
    }
  }

  function startEditSlot(slot: TaskAutoAssignSlotRow) {
    setEditingEventId(slot.event_id);
    setEditGroupIds(slot.assignee?.group_ids ?? []);
    setEditMemberIds(slot.assignee?.member_ids ?? []);
  }

  function cancelEditSlot() {
    setEditingEventId(null);
  }

  // A never-before-assigned slot has id: null — POST to create the row;
  // otherwise PATCH the existing one, matching (DIP-FP-180-adj-1).
  async function saveEditSlot(slot: TaskAutoAssignSlotRow) {
    setSavingEventId(slot.event_id);
    setError(null);
    try {
      const assignee = { group_ids: editGroupIds, member_ids: editMemberIds };
      const res = slot.id === null
        ? await fetch('/api/event-tasks-assignments', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ event_id: slot.event_id, task_id: selectedTaskId, assignee }),
          })
        : await fetch(`/api/event-tasks-assignments/${slot.id}`, {
            method: 'PATCH',
            headers: authHeaders,
            body: JSON.stringify({ assignee }),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error?.message ?? 'Failed to update slot');
        return;
      }
      setFetchedSlots(prev => prev.map(s => s.event_id === slot.event_id ? { ...s, id: body.data.id, assignee: body.data.assignee } : s));
      setEditingEventId(null);
    } catch {
      setError('Network error — please try again');
    } finally {
      setSavingEventId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Task</h2>
        <select
          value={selectedTaskId}
          onChange={e => handleTaskChange(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
        >
          <option value="">Select a task…</option>
          {tasks.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Roster</h2>
        <GroupMemberChipPicker
          groups={groups}
          members={members}
          groupIds={rosterGroupIds}
          memberIds={rosterMemberIds}
          onToggleGroup={toggleRosterGroup}
          onToggleMember={toggleRosterMember}
          individualOnly={individualOnly}
          label={`Add to the ${taskLabel} roster`}
        />

        {roster.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Priority order</p>
            <ol className="flex flex-col gap-1.5">
              {roster.map((entry, i) => (
                <li
                  key={`${entry.type}-${entry.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <span className="text-zinc-900 dark:text-zinc-100">
                    {i + 1}. {rosterEntryName(entry, groupById, memberById)}
                    {entry.type === 'group' && (
                      <span className="ml-1.5 inline-block rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        Group
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveRosterEntry(i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRosterEntry(i, 1)}
                      disabled={i === roster.length - 1}
                      aria-label="Move down"
                      className="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRosterEntry(i)}
                      aria-label="Remove"
                      className="rounded px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <button
          onClick={handleRun}
          disabled={running || !selectedTaskId || roster.length === 0 || selectedEventTypeIds.length === 0}
          className="mt-4 rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {running ? 'Running…' : 'Run auto-assign'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Event types</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          {eventTypes.map(et => (
            <label key={et.id} className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={selectedEventTypeIds.includes(et.id)}
                onChange={() => toggleEventType(et.id)}
                className="rounded border-zinc-300 dark:border-zinc-600"
              />
              {et.name}
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{taskLabel} slots</h2>
        {slots.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {!selectedTaskId
              ? 'Select a task above to see its open slots.'
              : selectedEventTypeIds.length === 0
                ? 'Check an event type above to see its open slots.'
                : 'No open slots on upcoming events.'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800">
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Event</th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-500 dark:text-zinc-400">Assignee</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {slots.map(slot => {
                  const isEditing = editingEventId === slot.event_id;
                  const names = slotAssigneeNames(slot.assignee, groupById, memberById);
                  return (
                    <tr key={slot.event_id}>
                      <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100">
                        {slot.event_name}
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">
                          {new Date(slot.start_datetime).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <GroupMemberChipPicker
                            groups={groups}
                            members={members}
                            groupIds={editGroupIds}
                            memberIds={editMemberIds}
                            onToggleGroup={id => setEditGroupIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                            onToggleMember={id => setEditMemberIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                            individualOnly={individualOnly}
                            label="Assignee"
                          />
                        ) : (
                          <span className="text-zinc-900 dark:text-zinc-100">{names.length > 0 ? names.join(', ') : '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => saveEditSlot(slot)}
                              disabled={savingEventId === slot.event_id}
                              className="rounded px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-100 dark:hover:bg-zinc-800"
                            >
                              {savingEventId === slot.event_id ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={cancelEditSlot}
                              disabled={savingEventId === slot.event_id}
                              className="rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEditSlot(slot)}
                            className="rounded px-2 py-1 text-xs font-medium text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {roster.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Assignment distribution</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800">
                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Roster member</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-500 dark:text-zinc-400">Assigned slots</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {summary.map(row => (
                <tr key={`${row.entry.type}-${row.entry.id}`}>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">{row.name}</td>
                  <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
