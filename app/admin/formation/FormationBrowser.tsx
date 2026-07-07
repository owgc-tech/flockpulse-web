'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CourseRow } from '@/src/features/formation/course.types';
import type { ModuleRow } from '@/src/features/formation/module.types';
import type { TalkRow } from '@/src/features/formation/talk.types';
import {
  listModulesAction,
  listTalksAction,
  reorderCoursesAction,
  reorderModulesAction,
  reorderTalksAction,
} from './actions';
import FormationOverlay, { type OverlayEntity, type OverlayMode } from './FormationOverlay';

interface OverlayState {
  entity: OverlayEntity;
  mode: OverlayMode;
  item?: CourseRow | ModuleRow | TalkRow;
  parentId?: string;
  nextSequenceOrder: number;
  hasChildren?: boolean;
}

interface Props {
  initialCourses: CourseRow[];
  token: string;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────
function Tooltip({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute left-full top-0 z-40 ml-2 w-56 rounded-lg border border-zinc-200 bg-white p-2.5 text-xs text-zinc-700 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      {text}
    </div>
  );
}

// ── Sortable row ─────────────────────────────────────────────────────────────
interface RowProps {
  id: string;
  name: string;
  alias: string | null;
  description: string | null;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
}

function SortableRow({ id, name, alias, description, isSelected, onSelect, onEdit }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipText = [alias && `Alias: ${alias}`, description].filter(Boolean).join('\n');

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onMouseEnter={() => tooltipText && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      className={`group relative flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
        isSelected
          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
      }`}
    >
      {/* Drag handle */}
      <span
        {...attributes}
        {...listeners}
        className={`flex-shrink-0 cursor-grab select-none text-zinc-300 active:cursor-grabbing dark:text-zinc-600 ${isSelected ? 'text-zinc-400 dark:text-zinc-600' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        ⠿
      </span>

      {/* Label — triggers selection */}
      <span className="flex-1 truncate" onClick={onSelect}>
        {name}
      </span>

      {/* Tooltip */}
      {showTooltip && tooltipText && <Tooltip text={tooltipText} />}

      {/* Ellipsis → edit */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        className={`flex-shrink-0 rounded p-0.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 ${
          isSelected
            ? 'text-zinc-300 hover:bg-zinc-700 dark:text-zinc-600 dark:hover:bg-zinc-200'
            : 'text-zinc-400 hover:bg-zinc-200 dark:text-zinc-500 dark:hover:bg-zinc-700'
        }`}
      >
        •••
      </button>
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────────────────
interface ColumnProps {
  title: string;
  items: Array<{ id: string; name: string; alias: string | null; description: string | null }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
  addDisabled?: boolean;
  addDisabledReason?: string;
  onReorder: (orderedIds: string[]) => void;
  isLoading?: boolean;
}

function Column({
  title, items, selectedId, onSelect, onEdit, onAdd,
  addDisabled, addDisabledReason, onReorder, isLoading,
}: ColumnProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex(i => i.id === active.id);
    const newIdx = items.findIndex(i => i.id === over.id);
    onReorder(arrayMove(items, oldIdx, newIdx).map(i => i.id));
  }

  return (
    <div className="flex w-full flex-col border-r border-zinc-200 dark:border-zinc-800 last:border-r-0">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {title}
        </span>
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          title={addDisabled ? addDisabledReason : `New ${title.toLowerCase()}`}
          className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          +
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <p className="px-2 py-4 text-center text-xs text-zinc-400">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-zinc-400">None yet</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
              {items.map(item => (
                <SortableRow
                  key={item.id}
                  id={item.id}
                  name={item.name}
                  alias={item.alias}
                  description={item.description}
                  isSelected={item.id === selectedId}
                  onSelect={() => onSelect(item.id)}
                  onEdit={() => onEdit(item.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}

// ── FormationBrowser ─────────────────────────────────────────────────────────
export default function FormationBrowser({ initialCourses, token }: Props) {
  const [courses, setCourses] = useState<CourseRow[]>(initialCourses.filter(c => !c.deleted_at));
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [talks, setTalks] = useState<TalkRow[]>([]);

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [selectedTalkId, setSelectedTalkId] = useState<string | null>(null);

  const [modulesLoading, setModulesLoading] = useState(false);
  const [talksLoading, setTalksLoading] = useState(false);

  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  // Track previous courses to avoid re-fetching when courses change but selection stays
  const prevCourseIdRef = useRef<string | null>(null);
  const prevModuleIdRef = useRef<string | null>(null);

  // Load modules when course selection changes
  useEffect(() => {
    if (selectedCourseId === prevCourseIdRef.current) return;
    prevCourseIdRef.current = selectedCourseId;
    setSelectedModuleId(null);
    setSelectedTalkId(null);
    setModules([]);
    setTalks([]);
    if (!selectedCourseId) return;
    setModulesLoading(true);
    listModulesAction(token, selectedCourseId).then(res => {
      setModulesLoading(false);
      if (res.data) setModules(res.data.filter(m => !m.deleted_at));
    });
  }, [selectedCourseId, token]);

  // Load talks when module selection changes
  useEffect(() => {
    if (selectedModuleId === prevModuleIdRef.current) return;
    prevModuleIdRef.current = selectedModuleId;
    setSelectedTalkId(null);
    setTalks([]);
    if (!selectedModuleId) return;
    setTalksLoading(true);
    listTalksAction(token, selectedModuleId).then(res => {
      setTalksLoading(false);
      if (res.data) setTalks(res.data.filter(t => !t.deleted_at));
    });
  }, [selectedModuleId, token]);

  // ── Reorder handlers (optimistic) ──────────────────────────────────────────
  function handleReorderCourses(orderedIds: string[]) {
    const prev = courses;
    const reordered = orderedIds.map(id => courses.find(c => c.id === id)!);
    setCourses(reordered);
    reorderCoursesAction(token, orderedIds).then(res => {
      if (res.error) { setReorderError(res.error); setCourses(prev); }
    });
  }

  function handleReorderModules(orderedIds: string[]) {
    const prev = modules;
    const reordered = orderedIds.map(id => modules.find(m => m.id === id)!);
    setModules(reordered);
    reorderModulesAction(token, selectedCourseId!, orderedIds).then(res => {
      if (res.error) { setReorderError(res.error); setModules(prev); }
    });
  }

  function handleReorderTalks(orderedIds: string[]) {
    const prev = talks;
    const reordered = orderedIds.map(id => talks.find(t => t.id === id)!);
    setTalks(reordered);
    reorderTalksAction(token, selectedModuleId!, orderedIds).then(res => {
      if (res.error) { setReorderError(res.error); setTalks(prev); }
    });
  }

  // ── Overlay open helpers ───────────────────────────────────────────────────
  function openCreateCourse() {
    setOverlay({ entity: 'course', mode: 'create', nextSequenceOrder: courses.length + 1 });
  }

  function openEditCourse(id: string) {
    const item = courses.find(c => c.id === id);
    if (!item) return;
    setOverlay({
      entity: 'course', mode: 'edit', item,
      nextSequenceOrder: item.sequence_order,
      hasChildren: modules.some(m => !m.deleted_at), // only accurate if this course is selected
    });
  }

  function openCreateModule() {
    if (!selectedCourseId) return;
    setOverlay({
      entity: 'module', mode: 'create', parentId: selectedCourseId,
      nextSequenceOrder: modules.length + 1,
    });
  }

  function openEditModule(id: string) {
    const item = modules.find(m => m.id === id);
    if (!item) return;
    setOverlay({
      entity: 'module', mode: 'edit', item, parentId: selectedCourseId!,
      nextSequenceOrder: item.sequence_order,
      hasChildren: talks.some(t => !t.deleted_at),
    });
  }

  function openCreateTalk() {
    if (!selectedModuleId) return;
    setOverlay({
      entity: 'talk', mode: 'create', parentId: selectedModuleId,
      nextSequenceOrder: talks.length + 1,
    });
  }

  function openEditTalk(id: string) {
    const item = talks.find(t => t.id === id);
    if (!item) return;
    setOverlay({
      entity: 'talk', mode: 'edit', item, parentId: selectedModuleId!,
      nextSequenceOrder: item.sequence_order,
    });
  }

  // ── Overlay save/delete callbacks ─────────────────────────────────────────
  const handleCourseSaved = useCallback((saved: CourseRow) => {
    setCourses(prev => {
      const idx = prev.findIndex(c => c.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved].filter(c => !c.deleted_at);
    });
  }, []);

  const handleCourseDeleted = useCallback((id: string) => {
    setCourses(prev => prev.filter(c => c.id !== id));
    if (selectedCourseId === id) {
      setSelectedCourseId(null);
      prevCourseIdRef.current = null;
    }
  }, [selectedCourseId]);

  const handleModuleSaved = useCallback((saved: ModuleRow) => {
    setModules(prev => {
      const idx = prev.findIndex(m => m.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved].filter(m => !m.deleted_at);
    });
  }, []);

  const handleModuleDeleted = useCallback((id: string) => {
    setModules(prev => prev.filter(m => m.id !== id));
    if (selectedModuleId === id) {
      setSelectedModuleId(null);
      prevModuleIdRef.current = null;
    }
  }, [selectedModuleId]);

  const handleTalkSaved = useCallback((saved: TalkRow) => {
    setTalks(prev => {
      const idx = prev.findIndex(t => t.id === saved.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = saved; return next; }
      return [...prev, saved].filter(t => !t.deleted_at);
    });
  }, []);

  const handleTalkDeleted = useCallback((id: string) => {
    setTalks(prev => prev.filter(t => t.id !== id));
    if (selectedTalkId === id) setSelectedTalkId(null);
  }, [selectedTalkId]);

  return (
    <div className="flex flex-1 flex-col">
      {reorderError && (
        <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          Reorder failed: {reorderError}{' '}
          <button onClick={() => setReorderError(null)} className="underline">Dismiss</button>
        </div>
      )}

      <div className="grid flex-1 grid-cols-3 overflow-hidden">
        <Column
          title="Courses"
          items={courses}
          selectedId={selectedCourseId}
          onSelect={setSelectedCourseId}
          onEdit={openEditCourse}
          onAdd={openCreateCourse}
          onReorder={handleReorderCourses}
        />
        <Column
          title="Modules"
          items={modules}
          selectedId={selectedModuleId}
          onSelect={setSelectedModuleId}
          onEdit={openEditModule}
          onAdd={openCreateModule}
          addDisabled={!selectedCourseId}
          addDisabledReason="Select a course first"
          onReorder={handleReorderModules}
          isLoading={modulesLoading}
        />
        <Column
          title="Talks"
          items={talks}
          selectedId={selectedTalkId}
          onSelect={setSelectedTalkId}
          onEdit={openEditTalk}
          onAdd={openCreateTalk}
          addDisabled={!selectedModuleId}
          addDisabledReason="Select a module first"
          onReorder={handleReorderTalks}
          isLoading={talksLoading}
        />
      </div>

      {overlay && (() => {
        const { entity, mode, item, parentId, nextSequenceOrder, hasChildren } = overlay;
        const close = () => setOverlay(null);
        if (entity === 'course') {
          return (
            <FormationOverlay
              token={token} entity="course" mode={mode}
              item={item as CourseRow | undefined}
              nextSequenceOrder={nextSequenceOrder}
              hasChildren={hasChildren}
              onClose={close}
              onSaved={handleCourseSaved}
              onDeleted={handleCourseDeleted}
            />
          );
        }
        if (entity === 'module') {
          return (
            <FormationOverlay
              token={token} entity="module" mode={mode}
              item={item as ModuleRow | undefined}
              parentId={parentId!}
              nextSequenceOrder={nextSequenceOrder}
              hasChildren={hasChildren}
              onClose={close}
              onSaved={handleModuleSaved}
              onDeleted={handleModuleDeleted}
            />
          );
        }
        return (
          <FormationOverlay
            token={token} entity="talk" mode={mode}
            item={item as TalkRow | undefined}
            parentId={parentId!}
            nextSequenceOrder={nextSequenceOrder}
            onClose={close}
            onSaved={handleTalkSaved}
            onDeleted={handleTalkDeleted}
          />
        );
      })()}
    </div>
  );
}
