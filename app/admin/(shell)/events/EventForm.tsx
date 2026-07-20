'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type {
  EventDetailRow, EventTypeOption, GroupOption, MemberOption,
  CourseOption, ModuleOption, TalkOption, SeriesFrequency, MeetingResourceOption,
} from '@/src/features/events/event.types';
import { getMapsUrl, computeOccurrenceDates, SERIES_FREQUENCY_CAPS } from '@/src/features/events/event.types';
import type { TaskRow } from '@/src/features/tasks/task.types';
import type { AssigneeSelector, EventTaskAssignmentRow } from '@/src/features/tasks/eventTaskAssignment.types';
import RepeatsFields from './RepeatsFields';
import ConvertToSeriesSection from './ConvertToSeriesSection';
import GroupMemberChipPicker from './GroupMemberChipPicker';

// FP-161-3: always shown as optional task slots, matched by name against the tenant's tasks
// catalog (Phase 1) — mirrors Prayer Leader/Food Assignment's pre-FP-161-3 "always optional,
// no event-type gating" precedent (FP-107), generalized to the uniform Task system.
const CORE_TASK_NAMES = ['Prayer Leader', 'Food Assignment', 'Music'];

function toggleId(prev: string[], id: string): string[] {
  return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

interface Props {
  token: string;
  eventTypes: EventTypeOption[];
  groups: GroupOption[];
  members: MemberOption[];
  initialEvent?: EventDetailRow;
  // FP-161-2: unlike GroupEditForm (whose page is entirely Admin-tier-gated already,
  // so its Owner section needs no separate role prop), this form is also reachable by
  // Leader-tier for events they own — the Owner section itself must stay Admin-only.
  isAdmin?: boolean;
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventForm({ token, eventTypes, groups, members, initialEvent, isAdmin }: Props) {
  const router = useRouter();
  const isEdit = !!initialEvent;

  // FP-161-2: Owner section state — mirrors GroupEditForm.tsx's reassignment pattern.
  // currentOwner is derived straight from the initialEvent prop (not local state), so
  // router.refresh() after a successful reassign naturally reflects the new owner.
  const [newOwnerId, setNewOwnerId] = useState('');
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const currentOwner = members.find(m => m.id === initialEvent?.owner_member_id);
  const reassignableOwners = members.filter(m => m.id !== initialEvent?.owner_member_id);

  async function handleReassignOwner() {
    if (!newOwnerId || !initialEvent) return;
    setOwnerBusy(true);
    setOwnerError(null);
    const res = await fetch('/api/events/reassign-owner', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: initialEvent.id, newOwnerMemberId: newOwnerId }),
    });
    const body = await res.json().catch(() => ({}));
    setOwnerBusy(false);
    if (!res.ok) { setOwnerError(body?.error?.message ?? 'Failed to reassign owner'); return; }
    setNewOwnerId('');
    router.refresh();
  }

  const [name, setName] = useState(initialEvent?.name ?? '');
  const [eventTypeId, setEventTypeId] = useState(initialEvent?.event_type_id ?? eventTypes[0]?.id ?? '');
  const [locationName, setLocationName] = useState(initialEvent?.location_name ?? '');
  const [locationAddress, setLocationAddress] = useState(initialEvent?.location_address ?? '');
  const [locationUrl, setLocationUrl] = useState(initialEvent?.location_url ?? '');
  const [startDatetime, setStartDatetime] = useState(initialEvent ? toLocalInputValue(initialEvent.start_datetime) : '');
  const [endDatetime, setEndDatetime] = useState(initialEvent ? toLocalInputValue(initialEvent.end_datetime) : '');
  const [groupIds, setGroupIds] = useState<string[]>(initialEvent?.target.group_ids ?? []);
  const [memberIds, setMemberIds] = useState<string[]>(initialEvent?.target.member_ids ?? []);

  // FP-161-3: Tasks section — replaces the old dedicated Prayer Leader/Food Assignment
  // fields with the uniform Task system (Phase 1). taskCatalog is the tenant's tasks list;
  // visibleTaskIds is which pickers are currently shown (always the three core tasks once
  // the catalog loads, plus any task with an existing assignment when editing, plus anything
  // manually added via "Add Task"); taskAssignees holds each visible task's current
  // group_ids/member_ids selection. initialAssignmentsRef holds what event_tasks_assignments
  // actually looked like on load, so handleSubmit can diff against it (create/update/delete)
  // rather than blindly replacing everything.
  const [taskCatalog, setTaskCatalog] = useState<TaskRow[]>([]);
  const [visibleTaskIds, setVisibleTaskIds] = useState<string[]>([]);
  const [taskAssignees, setTaskAssignees] = useState<Record<string, AssigneeSelector>>({});
  const [addTaskId, setAddTaskId] = useState('');
  const initialAssignmentsRef = useRef<EventTaskAssignmentRow[]>([]);

  // FP-133: nullable per-event override of the tenant's RSVP closure default —
  // empty string means "use the tenant default" (null on the wire).
  const [rsvpClosureDays, setRsvpClosureDays] = useState(
    initialEvent?.rsvp_closure_days !== undefined && initialEvent?.rsvp_closure_days !== null
      ? String(initialEvent.rsvp_closure_days)
      : ''
  );

  // DIP-FP-120-web: online meeting — additive to the still-required physical
  // location above, never a replacement. Tracked-Zoom and freeform-other are
  // mutually exclusive at the app layer (a single mode toggle), not a DB
  // constraint — see Grounding Check.
  type OnlineMeetingMode = 'NONE' | 'ZOOM' | 'OTHER';
  const initialOnlineMeetingMode: OnlineMeetingMode = initialEvent?.online_meeting_resource_id
    ? 'ZOOM'
    : initialEvent?.online_meeting_url || initialEvent?.online_meeting_platform_label
      ? 'OTHER'
      : 'NONE';
  const [onlineMeetingMode, setOnlineMeetingMode] = useState<OnlineMeetingMode>(initialOnlineMeetingMode);
  const [onlineMeetingResourceId, setOnlineMeetingResourceId] = useState(initialEvent?.online_meeting_resource_id ?? '');
  const [onlineMeetingUrl, setOnlineMeetingUrl] = useState(initialEvent?.online_meeting_url ?? '');
  const [onlineMeetingPlatformLabel, setOnlineMeetingPlatformLabel] = useState(initialEvent?.online_meeting_platform_label ?? '');
  const [meetingResources, setMeetingResources] = useState<MeetingResourceOption[]>([]);

  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [modules, setModules] = useState<ModuleOption[]>([]);
  const [talks, setTalks] = useState<TalkOption[]>([]);
  const [courseId, setCourseId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [talkId, setTalkId] = useState<string>(initialEvent?.talk_id ?? '');

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // FP-63: Repeats — Create mode only, never Edit (individual occurrences are edited
  // normally afterward, not as a series).
  const [repeats, setRepeats] = useState(false);
  const [frequency, setFrequency] = useState<SeriesFrequency>('WEEKLY');
  const [repeatMode, setRepeatMode] = useState<'COUNT' | 'UNTIL'>('COUNT');
  const [repeatCount, setRepeatCount] = useState(4);
  const [repeatUntil, setRepeatUntil] = useState('');

  const selectedEventType = eventTypes.find(t => t.id === eventTypeId);
  const isFormation = selectedEventType?.code === 'FORMATION';

  // DIP-FP-120-web: meeting_resources dropdown options — loaded unconditionally
  // (unlike Course, which only loads for the Formation event type) since Online
  // Meeting has no event-type gating.
  useEffect(() => {
    fetch('/api/meeting-resources', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(body => setMeetingResources(body.data ?? []))
      .catch(() => setMeetingResources([]));
  }, [token]);

  // Load Course list once, only when the Formation cascade is shown.
  useEffect(() => {
    if (!isFormation) return;
    fetch('/api/courses', { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(body => setCourses(body.data ?? []))
      .catch(() => setCourses([]));
  }, [isFormation, token]);

  // Load Module list when Course changes.
  useEffect(() => {
    if (!courseId) { setModules([]); return; }
    fetch(`/api/modules?course_id=${courseId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(body => setModules(body.data ?? []))
      .catch(() => setModules([]));
  }, [courseId, token]);

  // Load Talk list when Module changes.
  useEffect(() => {
    if (!moduleId) { setTalks([]); return; }
    fetch(`/api/talks?module_id=${moduleId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(body => setTalks(body.data ?? []))
      .catch(() => setTalks([]));
  }, [moduleId, token]);

  // FP-161-3: load the tasks catalog, and (edit mode only) this event's existing
  // event_tasks_assignments — once both are in, seed visibleTaskIds with the three core
  // tasks (matched by name) union any task that already has an assignment, and seed
  // taskAssignees from those existing assignments. Runs once on mount — the catalog and an
  // existing event's assignments don't change out from under an open form.
  useEffect(() => {
    async function loadTasks() {
      const tasksRes = await fetch('/api/tasks', { headers: { Authorization: `Bearer ${token}` } });
      const tasksBody = await tasksRes.json().catch(() => ({}));
      const tasks: TaskRow[] = tasksBody.data ?? [];
      setTaskCatalog(tasks);

      const coreIds = tasks.filter(t => CORE_TASK_NAMES.includes(t.name)).map(t => t.id);

      let assignments: EventTaskAssignmentRow[] = [];
      if (isEdit && initialEvent) {
        const assignRes = await fetch(`/api/event-tasks-assignments?event_id=${initialEvent.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const assignBody = await assignRes.json().catch(() => ({}));
        assignments = assignBody.data ?? [];
      }
      initialAssignmentsRef.current = assignments;

      const assigneesMap: Record<string, AssigneeSelector> = {};
      for (const id of coreIds) assigneesMap[id] = { group_ids: [], member_ids: [] };
      for (const a of assignments) {
        assigneesMap[a.task_id] = { group_ids: a.assignee?.group_ids ?? [], member_ids: a.assignee?.member_ids ?? [] };
      }
      setTaskAssignees(assigneesMap);
      setVisibleTaskIds(Array.from(new Set([...coreIds, ...assignments.map(a => a.task_id)])));
    }
    loadTasks().catch(() => { setTaskCatalog([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Live client-side estimate of the implied occurrence count for "ends on date" — uses the
  // same computeOccurrenceDates() the server uses authoritatively, so this estimate can never
  // disagree with what actually gets generated. Final validation still happens server-side.
  const cap = SERIES_FREQUENCY_CAPS[frequency];
  let impliedCount: number | null = null;
  if (repeats && startDatetime && endDatetime) {
    if (repeatMode === 'COUNT') {
      impliedCount = repeatCount;
    } else if (repeatUntil) {
      impliedCount = computeOccurrenceDates(
        new Date(startDatetime), new Date(endDatetime), frequency, 'UNTIL', new Date(repeatUntil)
      ).length;
    }
  }
  const overCap = impliedCount !== null && impliedCount > cap;

  function toggleGroup(id: string) {
    setGroupIds(prev => toggleId(prev, id));
  }
  function toggleMember(id: string) {
    setMemberIds(prev => toggleId(prev, id));
  }

  // FP-161-3: per-task toggle handlers — same shape as toggleGroup/toggleMember above, just
  // keyed by taskId since there's one GroupMemberChipPicker instance per visible task now,
  // not a single fixed Food Assignment picker.
  function toggleTaskGroup(taskId: string, groupId: string) {
    setTaskAssignees(prev => ({
      ...prev,
      [taskId]: {
        group_ids: toggleId(prev[taskId]?.group_ids ?? [], groupId),
        member_ids: prev[taskId]?.member_ids ?? [],
      },
    }));
  }
  function toggleTaskMember(taskId: string, memberId: string) {
    setTaskAssignees(prev => ({
      ...prev,
      [taskId]: {
        group_ids: prev[taskId]?.group_ids ?? [],
        member_ids: toggleId(prev[taskId]?.member_ids ?? [], memberId),
      },
    }));
  }

  function handleAddTask() {
    if (!addTaskId) return;
    setVisibleTaskIds(prev => [...prev, addTaskId]);
    setTaskAssignees(prev => ({ ...prev, [addTaskId]: prev[addTaskId] ?? { group_ids: [], member_ids: [] } }));
    setAddTaskId('');
  }

  // Non-core tasks only — the three core tasks are always-present optional slots, never
  // removable from the form itself (leaving them empty is how you "clear" one).
  function handleRemoveTask(taskId: string) {
    setVisibleTaskIds(prev => prev.filter(id => id !== taskId));
  }

  // FP-161-3: produces an accurate event_tasks_assignments end-state for this event —
  // created for newly-assigned tasks, updated for changed assignees, deleted for
  // cleared/removed ones. Diffs the current form state against what was actually loaded on
  // mount (initialAssignmentsRef), not against visibleTaskIds alone, so a task that's been
  // removed from view (or emptied out) but still has a stale row gets deleted too. A task
  // with no group_ids/member_ids at all never gets a row in the first place — an empty core
  // task slot means "no assignee," not "an assignment row with nobody in it."
  async function syncTaskAssignments(eventId: string): Promise<boolean> {
    const existing = initialAssignmentsRef.current;
    const allTaskIds = Array.from(new Set([...visibleTaskIds, ...existing.map(a => a.task_id)]));
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const results = await Promise.all(allTaskIds.map(async taskId => {
      const current = visibleTaskIds.includes(taskId)
        ? (taskAssignees[taskId] ?? { group_ids: [], member_ids: [] })
        : { group_ids: [], member_ids: [] };
      const hasAssignee = (current.group_ids?.length ?? 0) > 0 || (current.member_ids?.length ?? 0) > 0;
      const prior = existing.find(a => a.task_id === taskId);

      if (hasAssignee && !prior) {
        const res = await fetch('/api/event-tasks-assignments', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ event_id: eventId, task_id: taskId, assignee: current }),
        });
        return res.ok;
      }
      if (hasAssignee && prior) {
        const unchanged =
          sameIds(prior.assignee?.group_ids ?? [], current.group_ids ?? []) &&
          sameIds(prior.assignee?.member_ids ?? [], current.member_ids ?? []);
        if (unchanged) return true;
        const res = await fetch(`/api/event-tasks-assignments/${prior.id}`, {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({ assignee: current }),
        });
        return res.ok;
      }
      if (!hasAssignee && prior) {
        const res = await fetch(`/api/event-tasks-assignments/${prior.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        return res.ok;
      }
      return true;
    }));

    return results.every(Boolean);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (repeats && overCap) {
      setError(`Occurrence count exceeds the cap of ${cap} for ${frequency.toLowerCase()} events`);
      return;
    }

    setIsPending(true);

    const useSeries = !isEdit && repeats;

    const payload = useSeries
      ? {
          eventTypeId,
          name,
          startDatetime: new Date(startDatetime).toISOString(),
          endDatetime: new Date(endDatetime).toISOString(),
          locationName,
          locationAddress,
          locationUrl: locationUrl || null,
          target: { group_ids: groupIds, member_ids: memberIds },
          talkId: isFormation && talkId ? talkId : null,
          frequency,
          mode: repeatMode,
          count: repeatMode === 'COUNT' ? repeatCount : undefined,
          untilDate: repeatMode === 'UNTIL' ? new Date(repeatUntil).toISOString() : undefined,
        }
      : {
          eventTypeId,
          name,
          startDatetime: new Date(startDatetime).toISOString(),
          endDatetime: new Date(endDatetime).toISOString(),
          locationName,
          locationAddress,
          locationUrl: locationUrl || null,
          target: { group_ids: groupIds, member_ids: memberIds },
          talkId: isFormation && talkId ? talkId : null,
          // DIP-FP-120-web: same series-scope boundary FP-107 established for the fields
          // FP-161-3 replaced — not templated onto series-generated occurrences. Task
          // assignments follow the identical boundary: synced separately below, only for
          // the non-series path, since a series has no single event_id to attach them to.
          onlineMeetingResourceId: onlineMeetingMode === 'ZOOM' ? (onlineMeetingResourceId || null) : null,
          onlineMeetingUrl: onlineMeetingMode === 'OTHER' ? (onlineMeetingUrl.trim() || null) : null,
          onlineMeetingPlatformLabel: onlineMeetingMode === 'OTHER' ? (onlineMeetingPlatformLabel.trim() || null) : null,
          // FP-133: same series-scope boundary as above — not templated onto
          // series-generated occurrences.
          rsvpClosureDays: rsvpClosureDays.trim() === '' ? null : Number(rsvpClosureDays),
        };

    try {
      const url = isEdit ? `/api/events/${initialEvent!.id}` : useSeries ? '/api/event-series' : '/api/events';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // DIP-FP-120-web: MEETING_RESOURCE_CONFLICT's `conflict` field carries
        // the structured detail (conflicting event name/time/booker) the
        // pre-check found — render that inline instead of the bare message
        // when present. It's null for the rare race-condition path, where
        // body.error.message is already the right generic fallback text.
        const conflict = body?.error?.conflict;
        if (body?.error?.code === 'MEETING_RESOURCE_CONFLICT' && conflict) {
          setError(
            `Zoom account selected is already booked for "${conflict.eventName}" on ` +
            `${new Date(conflict.startDatetime).toLocaleString()} by ${conflict.bookedByName}.`
          );
          // FP-120-adj-1: scroll the error banner into view — it renders at
          // the top of the form, easy to miss on a long form without this.
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          setError(body?.error?.message ?? 'Failed to save event');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        setIsPending(false);
        return;
      }
      if (useSeries) {
        router.push('/admin/events');
        return;
      }
      const savedId = isEdit ? initialEvent!.id : body.data.id;

      const tasksOk = await syncTaskAssignments(savedId);
      if (!tasksOk) {
        setError('Event saved, but one or more task assignments failed to save — please review the Tasks section below and try again.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setIsPending(false);
        return;
      }

      router.push(`/admin/events/${savedId}`);
    } catch {
      setError('Network error — please try again');
      setIsPending(false);
    }
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';
  const fieldClass = 'flex flex-col gap-1.5';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className={fieldClass}>
        <label className={labelClass}>Name</label>
        <input className={inputClass} value={name} onChange={e => setName(e.target.value)} required />
      </div>

      <div className={fieldClass}>
        <label className={labelClass}>Event type</label>
        <select className={inputClass} value={eventTypeId} onChange={e => setEventTypeId(e.target.value)} required>
          <option value="" disabled>Select…</option>
          {eventTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {isFormation && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Formation talk</p>
          <div className="grid grid-cols-3 gap-3">
            <select className={inputClass} value={courseId} onChange={e => { setCourseId(e.target.value); setModuleId(''); setTalkId(''); }}>
              <option value="">Course…</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className={inputClass} value={moduleId} onChange={e => { setModuleId(e.target.value); setTalkId(''); }} disabled={!courseId}>
              <option value="">Module…</option>
              {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select className={inputClass} value={talkId} onChange={e => setTalkId(e.target.value)} disabled={!moduleId}>
              <option value="">Talk…</option>
              {talks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className={fieldClass}>
          <label className={labelClass}>Start</label>
          <input type="datetime-local" className={inputClass} value={startDatetime} onChange={e => setStartDatetime(e.target.value)} required />
        </div>
        <div className={fieldClass}>
          <label className={labelClass}>End</label>
          <input type="datetime-local" className={inputClass} value={endDatetime} onChange={e => setEndDatetime(e.target.value)} required />
        </div>
      </div>

      <div className={fieldClass}>
        <label className={labelClass}>Location name</label>
        <input className={inputClass} value={locationName} onChange={e => setLocationName(e.target.value)} required />
      </div>

      <div className={fieldClass}>
        <label className={labelClass}>Location address</label>
        <input className={inputClass} value={locationAddress} onChange={e => setLocationAddress(e.target.value)} required />
      </div>

      <div className={fieldClass}>
        <label className={labelClass}>
          Location URL <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional — overrides the default maps link)</span>
        </label>
        <input className={inputClass} value={locationUrl} onChange={e => setLocationUrl(e.target.value)} placeholder="https://…" />
        {locationAddress && (
          <a
            href={getMapsUrl(locationAddress, locationUrl || null)}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            Preview navigation link →
          </a>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Online Meeting <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional — additive to the location above, not a replacement)</span>
        </p>
        <div className="flex gap-4">
          {(['NONE', 'ZOOM', 'OTHER'] as const).map(mode => (
            <label key={mode} className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300">
              <input
                type="radio"
                name="onlineMeetingMode"
                checked={onlineMeetingMode === mode}
                onChange={() => setOnlineMeetingMode(mode)}
              />
              {mode === 'NONE' ? 'None' : mode === 'ZOOM' ? 'Zoom account' : 'Other platform'}
            </label>
          ))}
        </div>

        {onlineMeetingMode === 'ZOOM' && (
          <div className={fieldClass}>
            <label className={labelClass}>Zoom account</label>
            <select
              className={inputClass}
              value={onlineMeetingResourceId}
              onChange={e => setOnlineMeetingResourceId(e.target.value)}
              required
            >
              <option value="" disabled>Select…</option>
              {meetingResources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        )}

        {onlineMeetingMode === 'OTHER' && (
          <div className="grid grid-cols-2 gap-3">
            <div className={fieldClass}>
              <label className={labelClass}>Platform name</label>
              <input
                className={inputClass}
                value={onlineMeetingPlatformLabel}
                onChange={e => setOnlineMeetingPlatformLabel(e.target.value)}
                placeholder="e.g. Google Meet"
                required
              />
            </div>
            <div className={fieldClass}>
              <label className={labelClass}>Join link</label>
              <input
                className={inputClass}
                value={onlineMeetingUrl}
                onChange={e => setOnlineMeetingUrl(e.target.value)}
                placeholder="https://…"
                required
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <GroupMemberChipPicker
          groups={groups} members={members}
          groupIds={groupIds} memberIds={memberIds}
          onToggleGroup={toggleGroup} onToggleMember={toggleMember}
          label="Target"
        />
      </div>

      <div className={fieldClass}>
        <label className={labelClass}>
          RSVP closes (days before start) <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional — empty uses the community default)</span>
        </label>
        <input
          type="number"
          min={0}
          max={90}
          className={inputClass}
          value={rsvpClosureDays}
          onChange={e => setRsvpClosureDays(e.target.value)}
          placeholder="Community default"
        />
      </div>

      <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Tasks <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional — each can be assigned to a group, individual members, or a mix)</span>
        </p>

        {taskCatalog
          .filter(t => visibleTaskIds.includes(t.id))
          .map(t => {
            const isCore = CORE_TASK_NAMES.includes(t.name);
            const current = taskAssignees[t.id] ?? { group_ids: [], member_ids: [] };
            return (
              <div key={t.id} className="flex flex-col gap-2 border-t border-zinc-200 pt-4 first:border-t-0 first:pt-0 dark:border-zinc-800">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t.name}</p>
                  {!isCore && (
                    <button
                      type="button"
                      onClick={() => handleRemoveTask(t.id)}
                      className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <GroupMemberChipPicker
                  groups={groups} members={members}
                  groupIds={current.group_ids ?? []} memberIds={current.member_ids ?? []}
                  onToggleGroup={id => toggleTaskGroup(t.id, id)} onToggleMember={id => toggleTaskMember(t.id, id)}
                  label={t.name}
                  individualOnly={t.individual_only}
                />
              </div>
            );
          })}

        {taskCatalog.some(t => !visibleTaskIds.includes(t.id)) && (
          <div className="flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <select className={`flex-1 ${inputClass}`} value={addTaskId} onChange={e => setAddTaskId(e.target.value)}>
              <option value="">Add a task…</option>
              {taskCatalog.filter(t => !visibleTaskIds.includes(t.id)).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAddTask}
              disabled={!addTaskId}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Add Task
            </button>
          </div>
        )}
      </div>

      {isEdit && isAdmin && initialEvent && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Owner</p>

          {ownerError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {ownerError}
            </div>
          )}

          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Current owner: <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {currentOwner ? `${currentOwner.first_name} ${currentOwner.last_name}` : '—'}
            </span>
          </p>

          <div className="flex gap-2">
            <select className={`flex-1 ${inputClass}`} value={newOwnerId} onChange={e => setNewOwnerId(e.target.value)}>
              <option value="">Select a new owner…</option>
              {reassignableOwners.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
            </select>
            <button
              type="button"
              onClick={handleReassignOwner}
              disabled={ownerBusy || !newOwnerId}
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Reassign Owner
            </button>
          </div>
        </div>
      )}

      {!isEdit && (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" checked={repeats} onChange={e => setRepeats(e.target.checked)} />
            Repeats
          </label>

          {repeats && (
            <RepeatsFields
              frequency={frequency} onFrequencyChange={setFrequency}
              mode={repeatMode} onModeChange={setRepeatMode}
              count={repeatCount} onCountChange={setRepeatCount}
              until={repeatUntil} onUntilChange={setRepeatUntil}
              cap={cap} impliedCount={impliedCount} overCap={overCap}
            />
          )}
        </div>
      )}

      {isEdit && initialEvent && initialEvent.recurrence_series_id === null &&
        !['CANCELLED', 'COMPLETED', 'LOCKED'].includes(initialEvent.effective_status) && (
        <ConvertToSeriesSection token={token} initialEvent={initialEvent} />
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="self-start rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create event'}
        </button>
        <a
          href={isEdit ? `/admin/events/${initialEvent!.id}` : '/admin/events'}
          className="rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
