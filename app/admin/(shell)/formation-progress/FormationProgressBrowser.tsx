'use client';

import { useState, useTransition, useMemo } from 'react';
import { getMemberProgressAction, recordManualCompletionAction } from './actions';
import type { CourseProgress } from '@/src/features/formation/formation-completion.service';

interface Member {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface Props {
  members: Member[];
  tenantId: string;
  adminMemberId: string;
}

function memberDisplayName(m: Member) {
  const name = [m.first_name, m.last_name].filter(Boolean).join(' ');
  return name || m.email;
}

export default function FormationProgressBrowser({ members, tenantId, adminMemberId }: Props) {
  const [search, setSearch] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [progress, setProgress] = useState<CourseProgress[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filteredMembers = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return members;
    return members.filter(m =>
      memberDisplayName(m).toLowerCase().includes(q) ||
      m.email.toLowerCase().includes(q)
    );
  }, [members, search]);

  function handleSelectMember(memberId: string) {
    setSelectedMemberId(memberId);
    setProgress(null);
    setLoadError(null);
    startTransition(async () => {
      try {
        const result = await getMemberProgressAction(memberId, tenantId);
        setProgress(result);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Failed to load progress');
      }
    });
  }

  const selectedMember = members.find(m => m.id === selectedMemberId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 p-6 md:flex-row">
      {/* Member picker */}
      <div className="flex w-full flex-col md:w-72 md:flex-shrink-0">
        <input
          type="text"
          placeholder="Search members..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="mb-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
        />
        <div className="flex flex-col gap-0.5 overflow-y-auto">
          {filteredMembers.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-zinc-400">No members found</p>
          )}
          {filteredMembers.map(m => (
            <button
              key={m.id}
              onClick={() => handleSelectMember(m.id)}
              className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                selectedMemberId === m.id
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              <span className="block font-medium">{memberDisplayName(m)}</span>
              <span className="block text-xs opacity-60">{m.email}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Progress panel */}
      <div className="flex-1">
        {!selectedMemberId && (
          <p className="py-12 text-center text-sm text-zinc-400">Select a member to view their formation progress.</p>
        )}
        {selectedMemberId && isPending && (
          <p className="py-12 text-center text-sm text-zinc-400">Loading progress...</p>
        )}
        {loadError && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{loadError}</p>
        )}
        {progress && selectedMember && selectedMemberId && !isPending && (
          <ProgressTree
            progress={progress}
            tenantId={tenantId}
            adminMemberId={adminMemberId}
            memberId={selectedMemberId}
            onRefresh={() => handleSelectMember(selectedMemberId!)}
          />
        )}
      </div>
    </div>
  );
}

// ── Progress Tree ─────────────────────────────────────────────────────────────

interface ProgressTreeProps {
  progress: CourseProgress[];
  tenantId: string;
  adminMemberId: string;
  memberId: string;
  onRefresh: () => void;
}

function ProgressTree({ progress, tenantId, adminMemberId, memberId, onRefresh }: ProgressTreeProps) {
  if (progress.length === 0) {
    return <p className="text-sm text-zinc-400">No courses found for this tenant.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {progress.map(course => (
        <CourseRow
          key={course.course_id}
          course={course}
          tenantId={tenantId}
          adminMemberId={adminMemberId}
          memberId={memberId}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  );
}

// ── Course Row ────────────────────────────────────────────────────────────────

function CourseRow({ course, tenantId, adminMemberId, memberId, onRefresh }: {
  course: CourseProgress;
  tenantId: string;
  adminMemberId: string;
  memberId: string;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  const completedModules = course.modules.filter(m => m.module_completed).length;

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        <div>
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">{course.course_name}</span>
          {course.course_description && (
            <span className="ml-2 text-xs text-zinc-500">({course.course_description})</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium ${course.course_completed ? 'text-green-600 dark:text-green-400' : 'text-zinc-500'}`}>
            {completedModules}/{course.modules.length} modules
            {course.course_completed ? ' · Complete' : ''}
          </span>
          <span className="text-zinc-400">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
          {course.modules.map(mod => (
            <ModuleRow
              key={mod.module_id}
              mod={mod}
              tenantId={tenantId}
              adminMemberId={adminMemberId}
              memberId={memberId}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Module Row ────────────────────────────────────────────────────────────────

function ModuleRow({ mod, tenantId, adminMemberId, memberId, onRefresh }: {
  mod: CourseProgress['modules'][0];
  tenantId: string;
  adminMemberId: string;
  memberId: string;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(true);
  const completedTalks = mod.talks.filter(t => t.completed).length;

  return (
    <div className="mt-2 rounded-lg border border-zinc-100 dark:border-zinc-800">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{mod.module_name}</span>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${mod.module_completed ? 'text-green-600 dark:text-green-400' : 'text-zinc-400'}`}>
            {completedTalks}/{mod.talks.length} talks
            {mod.module_completed ? ' · Complete' : ''}
          </span>
          <span className="text-zinc-400">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && mod.talks.length > 0 && (
        <div className="border-t border-zinc-50 px-3 py-2 dark:border-zinc-800">
          {mod.talks.map(talk => (
            <TalkRow
              key={talk.talk_id}
              talk={talk}
              tenantId={tenantId}
              adminMemberId={adminMemberId}
              memberId={memberId}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      )}

      {open && mod.talks.length === 0 && (
        <p className="px-3 py-2 text-xs text-zinc-400">No relevant talks for this member in this module.</p>
      )}
    </div>
  );
}

// ── Talk Row ──────────────────────────────────────────────────────────────────

function TalkRow({ talk, tenantId, adminMemberId, memberId, onRefresh }: {
  talk: CourseProgress['modules'][0]['talks'][0];
  tenantId: string;
  adminMemberId: string;
  memberId: string;
  onRefresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  function handleRecord() {
    setFormError(null);
    startTransition(async () => {
      const result = await recordManualCompletionAction(
        tenantId, adminMemberId, memberId, talk.talk_id, completedAt
      );
      if (result.success) {
        setShowForm(false);
        onRefresh();
      } else {
        setFormError(result.message);
      }
    });
  }

  return (
    <div className="ml-2 border-l-2 border-zinc-100 pl-3 dark:border-zinc-800">
      <div className="flex items-center justify-between py-1.5">
        <div className="flex items-center gap-2">
          {talk.completed ? (
            <span className="text-green-500" title="Completed">&#10003;</span>
          ) : (
            <span className="text-zinc-300 dark:text-zinc-600" title="Incomplete">&#9675;</span>
          )}
          <span className="text-sm text-zinc-700 dark:text-zinc-300">{talk.talk_name}</span>
        </div>
        {!talk.completed && (
          <button
            onClick={() => { setShowForm(s => !s); setFormError(null); }}
            className="ml-2 rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            Record completion
          </button>
        )}
      </div>

      {showForm && !talk.completed && (
        <div className="mb-2 ml-5 flex items-end gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">Completion date</label>
            <input
              type="date"
              value={completedAt}
              onChange={e => setCompletedAt(e.target.value)}
              className="rounded border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
          </div>
          <button
            onClick={handleRecord}
            disabled={isPending}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => { setShowForm(false); setFormError(null); }}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          {formError && (
            <p className="ml-2 text-xs text-red-600 dark:text-red-400">{formError}</p>
          )}
        </div>
      )}
    </div>
  );
}
