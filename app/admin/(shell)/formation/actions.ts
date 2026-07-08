'use server';

import { createClient } from '@supabase/supabase-js';
import { createCourse, updateCourse, reorderCourses, listCourses } from '@/src/features/formation/course.service';
import { createModule, updateModule, reorderModules, listModulesByCourse } from '@/src/features/formation/module.service';
import { createTalk, updateTalk, reorderTalks, listTalksByModule } from '@/src/features/formation/talk.service';
import type { CourseRow } from '@/src/features/formation/course.types';
import type { ModuleRow } from '@/src/features/formation/module.types';
import type { TalkRow } from '@/src/features/formation/talk.types';

// ── Auth helper — identical pattern to app/admin/invite/actions.ts ──────────
async function getAdminContext(token: string): Promise<{ tenantId: string; memberId: string } | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;

  if (!tenantId || !memberId || role !== 'ADMIN') return null;
  return { tenantId, memberId };
}

function mapServiceError(e: unknown): string {
  const code = (e as { code?: string }).code;
  const msg = (e as Error).message ?? 'An unexpected error occurred';
  if (code === 'VALIDATION_ERROR') return msg;
  if (code === 'NOT_FOUND') return msg;
  if (code === 'INVALID_STATE_TRANSITION') return msg;
  if (code === 'CROSS_TENANT_ACCESS') return 'Access denied';
  return 'An unexpected error occurred. Please try again.';
}

// ── Shared action result type ────────────────────────────────────────────────
export interface FormationActionResult<T = undefined> {
  data?: T;
  error?: string;
}

// ── Read actions (lazy-load for client) ──────────────────────────────────────
export async function listModulesAction(
  token: string, courseId: string
): Promise<FormationActionResult<ModuleRow[]>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    const data = await listModulesByCourse(courseId, ctx.tenantId);
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function listTalksAction(
  token: string, moduleId: string
): Promise<FormationActionResult<TalkRow[]>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    const data = await listTalksByModule(moduleId, ctx.tenantId);
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

// ── Course actions ────────────────────────────────────────────────────────────
export async function createCourseAction(
  token: string, formData: FormData
): Promise<FormationActionResult<CourseRow>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  const name = (formData.get('name') as string)?.trim();
  const alias = (formData.get('alias') as string)?.trim() || null;
  const description = (formData.get('description') as string)?.trim() || null;
  const sequenceOrder = parseInt(formData.get('sequenceOrder') as string, 10);
  try {
    const data = await createCourse(ctx.tenantId, { name, alias, description, sequenceOrder });
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function updateCourseAction(
  token: string, id: string, formData: FormData
): Promise<FormationActionResult<CourseRow>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  const name = (formData.get('name') as string)?.trim();
  const alias = (formData.get('alias') as string | null);
  const description = (formData.get('description') as string | null);
  try {
    const data = await updateCourse(id, ctx.tenantId, {
      name: name || undefined,
      alias: alias?.trim() || null,
      description: description?.trim() || null,
    });
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function deleteCourseAction(
  token: string, id: string
): Promise<FormationActionResult> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    await updateCourse(id, ctx.tenantId, { deletedAt: new Date().toISOString() });
    return {};
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function reorderCoursesAction(
  token: string, orderedIds: string[]
): Promise<FormationActionResult> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    await reorderCourses(ctx.tenantId, orderedIds);
    return {};
  } catch (e) { return { error: mapServiceError(e) }; }
}

// ── Module actions ────────────────────────────────────────────────────────────
export async function createModuleAction(
  token: string, courseId: string, formData: FormData
): Promise<FormationActionResult<ModuleRow>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  const name = (formData.get('name') as string)?.trim();
  const alias = (formData.get('alias') as string)?.trim() || null;
  const description = (formData.get('description') as string)?.trim() || null;
  const sequenceOrder = parseInt(formData.get('sequenceOrder') as string, 10);
  try {
    const data = await createModule(ctx.tenantId, { courseId, name, alias, description, sequenceOrder });
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function updateModuleAction(
  token: string, id: string, formData: FormData
): Promise<FormationActionResult<ModuleRow>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  const name = (formData.get('name') as string)?.trim();
  const alias = (formData.get('alias') as string | null);
  const description = (formData.get('description') as string | null);
  try {
    const data = await updateModule(id, ctx.tenantId, {
      name: name || undefined,
      alias: alias?.trim() || null,
      description: description?.trim() || null,
    });
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function deleteModuleAction(
  token: string, id: string
): Promise<FormationActionResult> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    await updateModule(id, ctx.tenantId, { deletedAt: new Date().toISOString() });
    return {};
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function reorderModulesAction(
  token: string, courseId: string, orderedIds: string[]
): Promise<FormationActionResult> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    await reorderModules(courseId, ctx.tenantId, orderedIds);
    return {};
  } catch (e) { return { error: mapServiceError(e) }; }
}

// ── Talk actions ──────────────────────────────────────────────────────────────
export async function createTalkAction(
  token: string, moduleId: string, formData: FormData
): Promise<FormationActionResult<TalkRow>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  const name = (formData.get('name') as string)?.trim();
  const alias = (formData.get('alias') as string)?.trim() || null;
  const description = (formData.get('description') as string)?.trim() || null;
  const sequenceOrder = parseInt(formData.get('sequenceOrder') as string, 10);
  const forSingleMen = formData.get('forSingleMen') === 'true';
  const forSingleWomen = formData.get('forSingleWomen') === 'true';
  const forMarriedMen = formData.get('forMarriedMen') === 'true';
  const forMarriedWomen = formData.get('forMarriedWomen') === 'true';
  try {
    const data = await createTalk(ctx.tenantId, {
      moduleId, name, alias, description, sequenceOrder,
      forSingleMen, forSingleWomen, forMarriedMen, forMarriedWomen,
    });
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function updateTalkAction(
  token: string, id: string, formData: FormData
): Promise<FormationActionResult<TalkRow>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  const name = (formData.get('name') as string)?.trim();
  const alias = (formData.get('alias') as string | null);
  const description = (formData.get('description') as string | null);
  const forSingleMen = formData.get('forSingleMen') === 'true';
  const forSingleWomen = formData.get('forSingleWomen') === 'true';
  const forMarriedMen = formData.get('forMarriedMen') === 'true';
  const forMarriedWomen = formData.get('forMarriedWomen') === 'true';
  try {
    const data = await updateTalk(id, ctx.tenantId, {
      name: name || undefined,
      alias: alias?.trim() || null,
      description: description?.trim() || null,
      forSingleMen, forSingleWomen, forMarriedMen, forMarriedWomen,
    });
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function deleteTalkAction(
  token: string, id: string
): Promise<FormationActionResult> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    await updateTalk(id, ctx.tenantId, { deletedAt: new Date().toISOString() });
    return {};
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function reorderTalksAction(
  token: string, moduleId: string, orderedIds: string[]
): Promise<FormationActionResult> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    await reorderTalks(moduleId, ctx.tenantId, orderedIds);
    return {};
  } catch (e) { return { error: mapServiceError(e) }; }
}
