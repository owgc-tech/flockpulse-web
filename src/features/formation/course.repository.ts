import { createClient } from '@supabase/supabase-js';
import type { CourseRow, CreateCourseInput, UpdateCourseInput } from './course.types';

const COLS = 'id, tenant_id, name, alias, description, sequence_order, deleted_at, created_at, updated_at';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function insertCourse(tenantId: string, input: CreateCourseInput): Promise<CourseRow> {
  const { data, error } = await serviceClient()
    .from('courses')
    .insert({
      tenant_id: tenantId,
      name: input.name,
      alias: input.alias ?? null,
      description: input.description ?? null,
      sequence_order: input.sequenceOrder,
    })
    .select(COLS)
    .single();

  if (error) throw error;
  return data as CourseRow;
}

export async function patchCourse(
  id: string, tenantId: string, input: UpdateCourseInput
): Promise<CourseRow | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.alias !== undefined) patch.alias = input.alias;
  if (input.description !== undefined) patch.description = input.description;
  if (input.sequenceOrder !== undefined) patch.sequence_order = input.sequenceOrder;
  if (input.deletedAt !== undefined) patch.deleted_at = input.deletedAt;

  const { data, error } = await serviceClient()
    .from('courses')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as CourseRow;
}

export async function getCourse(id: string, tenantId: string): Promise<CourseRow | null> {
  const { data, error } = await serviceClient()
    .from('courses')
    .select(COLS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) return null;
  return data as CourseRow;
}

export async function listCourses(tenantId: string, includeDeleted = false): Promise<CourseRow[]> {
  let q = serviceClient()
    .from('courses')
    .select(COLS)
    .eq('tenant_id', tenantId)
    .order('sequence_order', { ascending: true });

  if (!includeDeleted) q = (q as any).is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CourseRow[];
}

export async function reorderCoursesRpc(tenantId: string, orderedIds: string[]): Promise<void> {
  const { error } = await serviceClient().rpc('reorder_courses', {
    p_tenant_id: tenantId,
    p_ids: orderedIds,
  });
  if (error) throw error;
}
