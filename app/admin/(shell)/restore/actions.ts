'use server';

import { createClient } from '@supabase/supabase-js';
import { listDeletedCourses, restoreCourse } from '@/src/features/formation/course.service';
import { listDeletedModules, restoreModule, type DeletedModuleRow } from '@/src/features/formation/module.service';
import { listDeletedTalks, restoreTalk, type DeletedTalkRow } from '@/src/features/formation/talk.service';
import type { CourseRow } from '@/src/features/formation/course.types';
import type { TalkRow } from '@/src/features/formation/talk.types';
import type { ModuleRow } from '@/src/features/formation/module.types';
import { isAdminTier, type Role } from '@/src/lib/auth/middleware';

// Restore stays Admin-tier-only (DIP-FP-114-web) — isAdminTier() also fixes the
// FP-113 Admin-tier-synonym gap the old literal `role !== 'ADMIN'` had.
async function getAdminContext(token: string): Promise<{ tenantId: string; memberId: string } | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;

  if (!tenantId || !memberId || !role || !isAdminTier(role)) return null;
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

export interface RestoreActionResult<T = undefined> {
  data?: T;
  error?: string;
}

// ── Courses ──────────────────────────────────────────────────────────────────
export async function listDeletedCoursesAction(
  token: string
): Promise<RestoreActionResult<CourseRow[]>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    const data = await listDeletedCourses(ctx.tenantId);
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function restoreCourseAction(
  token: string, id: string
): Promise<RestoreActionResult<CourseRow>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    const data = await restoreCourse(id, ctx.tenantId);
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

// ── Modules ──────────────────────────────────────────────────────────────────
export async function listDeletedModulesAction(
  token: string
): Promise<RestoreActionResult<DeletedModuleRow[]>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    const data = await listDeletedModules(ctx.tenantId);
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function restoreModuleAction(
  token: string, id: string
): Promise<RestoreActionResult<ModuleRow>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    const data = await restoreModule(id, ctx.tenantId);
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

// ── Talks ─────────────────────────────────────────────────────────────────────
export async function listDeletedTalksAction(
  token: string
): Promise<RestoreActionResult<DeletedTalkRow[]>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    const data = await listDeletedTalks(ctx.tenantId);
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}

export async function restoreTalkAction(
  token: string, id: string
): Promise<RestoreActionResult<TalkRow>> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };
  try {
    const data = await restoreTalk(id, ctx.tenantId);
    return { data };
  } catch (e) { return { error: mapServiceError(e) }; }
}
