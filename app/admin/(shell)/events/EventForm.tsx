'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type {
  EventDetailRow, EventTypeOption, GroupOption, MemberOption,
  CourseOption, ModuleOption, TalkOption, SeriesFrequency, MeetingResourceOption,
} from '@/src/features/events/event.types';
import { getMapsUrl, computeOccurrenceDates, SERIES_FREQUENCY_CAPS } from '@/src/features/events/event.types';
import RepeatsFields from './RepeatsFields';
import ConvertToSeriesSection from './ConvertToSeriesSection';
import GroupMemberMultiSelect from './GroupMemberMultiSelect';

function toggleId(prev: string[], id: string): string[] {
  return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
}

interface Props {
  token: string;
  eventTypes: EventTypeOption[];
  groups: GroupOption[];
  members: MemberOption[];
  initialEvent?: EventDetailRow;
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventForm({ token, eventTypes, groups, members, initialEvent }: Props) {
  const router = useRouter();
  const isEdit = !!initialEvent;

  const [name, setName] = useState(initialEvent?.name ?? '');
  const [eventTypeId, setEventTypeId] = useState(initialEvent?.event_type_id ?? eventTypes[0]?.id ?? '');
  const [locationName, setLocationName] = useState(initialEvent?.location_name ?? '');
  const [locationAddress, setLocationAddress] = useState(initialEvent?.location_address ?? '');
  const [locationUrl, setLocationUrl] = useState(initialEvent?.location_url ?? '');
  const [startDatetime, setStartDatetime] = useState(initialEvent ? toLocalInputValue(initialEvent.start_datetime) : '');
  const [endDatetime, setEndDatetime] = useState(initialEvent ? toLocalInputValue(initialEvent.end_datetime) : '');
  const [groupIds, setGroupIds] = useState<string[]>(initialEvent?.target.group_ids ?? []);
  const [memberIds, setMemberIds] = useState<string[]>(initialEvent?.target.member_ids ?? []);

  // FP-107: always-optional, no event-type gating — Prayer Leader and Food Assignment.
  const [prayerLeaderMemberId, setPrayerLeaderMemberId] = useState(initialEvent?.prayer_leader_member_id ?? '');
  const [foodGroupIds, setFoodGroupIds] = useState<string[]>(initialEvent?.food_assignment?.group_ids ?? []);
  const [foodMemberIds, setFoodMemberIds] = useState<string[]>(initialEvent?.food_assignment?.member_ids ?? []);

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
  function toggleFoodGroup(id: string) {
    setFoodGroupIds(prev => toggleId(prev, id));
  }
  function toggleFoodMember(id: string) {
    setFoodMemberIds(prev => toggleId(prev, id));
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
          // FP-107: not templated onto series-generated occurrences (deliberate scope
          // boundary), so these are only ever sent on the non-series create/update path.
          prayerLeaderMemberId: prayerLeaderMemberId || null,
          foodAssignment: { group_ids: foodGroupIds, member_ids: foodMemberIds },
          // DIP-FP-120-web: same series-scope boundary as Prayer Leader/Food
          // Assignment above — not templated onto series-generated occurrences.
          onlineMeetingResourceId: onlineMeetingMode === 'ZOOM' ? (onlineMeetingResourceId || null) : null,
          onlineMeetingUrl: onlineMeetingMode === 'OTHER' ? (onlineMeetingUrl.trim() || null) : null,
          onlineMeetingPlatformLabel: onlineMeetingMode === 'OTHER' ? (onlineMeetingPlatformLabel.trim() || null) : null,
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
        <GroupMemberMultiSelect
          groups={groups} members={members}
          groupIds={groupIds} memberIds={memberIds}
          onToggleGroup={toggleGroup} onToggleMember={toggleMember}
          groupsLabel="Target — groups" membersLabel="Target — individual members"
        />
      </div>

      <div className={fieldClass}>
        <label className={labelClass}>
          Prayer Leader <span className="font-normal text-zinc-400 dark:text-zinc-500">(optional)</span>
        </label>
        <select className={inputClass} value={prayerLeaderMemberId} onChange={e => setPrayerLeaderMemberId(e.target.value)}>
          <option value="">None</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
        </select>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Food Assignment <span className="font-normal">(optional)</span>
        </p>
        <GroupMemberMultiSelect
          groups={groups} members={members}
          groupIds={foodGroupIds} memberIds={foodMemberIds}
          onToggleGroup={toggleFoodGroup} onToggleMember={toggleFoodMember}
          groupsLabel="Food Assignment — groups" membersLabel="Food Assignment — individual members"
        />
      </div>

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
