'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { CourseRow } from '@/src/features/formation/course.types';
import type { ModuleRow } from '@/src/features/formation/module.types';
import type { TalkRow } from '@/src/features/formation/talk.types';
import {
  createCourseAction, updateCourseAction, deleteCourseAction,
  createModuleAction, updateModuleAction, deleteModuleAction,
  createTalkAction, updateTalkAction, deleteTalkAction,
} from './actions';

export type OverlayEntity = 'course' | 'module' | 'talk';
export type OverlayMode = 'create' | 'edit';

interface BaseProps {
  token: string;
  mode: OverlayMode;
  entity: OverlayEntity;
  nextSequenceOrder: number;
  onClose: () => void;
}

interface CourseOverlayProps extends BaseProps {
  entity: 'course';
  item?: CourseRow;
  parentId?: never;
  hasChildren?: boolean;
}
interface ModuleOverlayProps extends BaseProps {
  entity: 'module';
  item?: ModuleRow;
  parentId: string;
  hasChildren?: boolean;
}
interface TalkOverlayProps extends BaseProps {
  entity: 'talk';
  item?: TalkRow;
  parentId: string;
  hasChildren?: never;
}

type Props =
  | (CourseOverlayProps & { onSaved: (item: CourseRow) => void; onDeleted?: (id: string) => void })
  | (ModuleOverlayProps & { onSaved: (item: ModuleRow) => void; onDeleted?: (id: string) => void })
  | (TalkOverlayProps & { onSaved: (item: TalkRow) => void; onDeleted?: (id: string) => void });

const ENTITY_LABELS: Record<OverlayEntity, string> = {
  course: 'Course',
  module: 'Module',
  talk: 'Talk',
};

export default function FormationOverlay(props: Props) {
  const { token, mode, entity, item, nextSequenceOrder, onClose } = props;
  const [isPending, startTransition] = useTransition();
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Talk demographic state
  const talkItem = entity === 'talk' ? (item as TalkRow | undefined) : undefined;
  const [forSingleMen, setForSingleMen] = useState(talkItem?.for_single_men ?? true);
  const [forSingleWomen, setForSingleWomen] = useState(talkItem?.for_single_women ?? true);
  const [forMarriedMen, setForMarriedMen] = useState(talkItem?.for_married_men ?? true);
  const [forMarriedWomen, setForMarriedWomen] = useState(talkItem?.for_married_women ?? true);
  const noDemographic = entity === 'talk' && !forSingleMen && !forSingleWomen && !forMarriedMen && !forMarriedWomen;

  useEffect(() => { firstInputRef.current?.focus(); }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const label = ENTITY_LABELS[entity];
  const title = deleteConfirm
    ? `Delete ${label}`
    : mode === 'create' ? `New ${label}` : `Edit ${label}`;

  // Can delete if: edit mode, item exists, no active children (for course/module)
  const canDelete = mode === 'edit' && !!item && !('hasChildren' in props && props.hasChildren);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    // Client-side demographic validation for talks
    if (entity === 'talk' && noDemographic) {
      setError('Select at least one audience group.');
      return;
    }

    if (entity === 'talk') {
      fd.set('forSingleMen', String(forSingleMen));
      fd.set('forSingleWomen', String(forSingleWomen));
      fd.set('forMarriedMen', String(forMarriedMen));
      fd.set('forMarriedWomen', String(forMarriedWomen));
    }

    startTransition(async () => {
      let result: { data?: unknown; error?: string };

      if (entity === 'course') {
        result = mode === 'create'
          ? await createCourseAction(token, fd)
          : await updateCourseAction(token, item!.id, fd);
        if (!result.error && result.data) (props as CourseOverlayProps & { onSaved: (item: CourseRow) => void }).onSaved(result.data as CourseRow);
      } else if (entity === 'module') {
        result = mode === 'create'
          ? await createModuleAction(token, (props as ModuleOverlayProps).parentId, fd)
          : await updateModuleAction(token, item!.id, fd);
        if (!result.error && result.data) (props as ModuleOverlayProps & { onSaved: (item: ModuleRow) => void }).onSaved(result.data as ModuleRow);
      } else {
        result = mode === 'create'
          ? await createTalkAction(token, (props as TalkOverlayProps).parentId, fd)
          : await updateTalkAction(token, item!.id, fd);
        if (!result.error && result.data) (props as TalkOverlayProps & { onSaved: (item: TalkRow) => void }).onSaved(result.data as TalkRow);
      }

      if (result.error) { setError(result.error); return; }
      onClose();
    });
  }

  async function handleDelete() {
    setError(null);
    startTransition(async () => {
      let result: { error?: string };
      if (entity === 'course') result = await deleteCourseAction(token, item!.id);
      else if (entity === 'module') result = await deleteModuleAction(token, item!.id);
      else result = await deleteTalkAction(token, item!.id);

      if (result.error) { setError(result.error); setDeleteConfirm(false); return; }
      props.onDeleted?.(item!.id);
      onClose();
    });
  }

  const inputClass = 'rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 w-full';
  const labelClass = 'text-sm font-medium text-zinc-700 dark:text-zinc-300';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            ✕
          </button>
        </div>

        {deleteConfirm ? (
          <div className="flex flex-col gap-5 p-6">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">
              Are you sure you want to delete this {label.toLowerCase()}? This cannot be undone.
            </p>
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                disabled={isPending}
                className="flex-1 rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="flex-1 rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col gap-5 p-6">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Name <span className="text-red-500">*</span></label>
              <input
                ref={firstInputRef}
                name="name"
                type="text"
                required
                defaultValue={item?.name ?? ''}
                className={inputClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Alias <span className="font-normal text-zinc-400">(optional)</span></label>
              <input name="alias" type="text" defaultValue={item?.alias ?? ''} className={inputClass} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Description <span className="font-normal text-zinc-400">(optional)</span></label>
              <textarea
                name="description"
                rows={3}
                defaultValue={item?.description ?? ''}
                className={`${inputClass} resize-none`}
              />
            </div>

            {mode === 'create' && (
              <input type="hidden" name="sequenceOrder" value={nextSequenceOrder} />
            )}

            {entity === 'talk' && (
              <fieldset className="flex flex-col gap-2">
                <legend className={`${labelClass} mb-1`}>
                  Audience <span className="text-red-500">*</span>
                  <span className="ml-1 font-normal text-zinc-400">(select all that apply)</span>
                </legend>
                {[
                  { key: 'forSingleMen',   label: 'Single men',    val: forSingleMen,   set: setForSingleMen },
                  { key: 'forSingleWomen', label: 'Single women',  val: forSingleWomen, set: setForSingleWomen },
                  { key: 'forMarriedMen',  label: 'Married men',   val: forMarriedMen,  set: setForMarriedMen },
                  { key: 'forMarriedWomen',label: 'Married women', val: forMarriedWomen,set: setForMarriedWomen },
                ].map(({ key, label: cbLabel, val, set }) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={val}
                      onChange={e => set(e.target.checked)}
                      className="h-4 w-4 rounded border-zinc-300 accent-zinc-900 dark:accent-zinc-100"
                    />
                    {cbLabel}
                  </label>
                ))}
                {noDemographic && (
                  <p className="text-xs text-red-600 dark:text-red-400">Select at least one audience group.</p>
                )}
              </fieldset>
            )}

            <div className="flex items-center gap-3 pt-1">
              {canDelete && (
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(true)}
                  className="rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                >
                  Delete
                </button>
              )}
              {'hasChildren' in props && props.hasChildren && mode === 'edit' && (
                <span className="text-xs text-zinc-400 dark:text-zinc-600">
                  Delete all {entity === 'course' ? 'modules' : 'talks'} first
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending || (entity === 'talk' && noDemographic)}
                  className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {isPending ? 'Saving…' : mode === 'create' ? `Create ${label}` : 'Save'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
