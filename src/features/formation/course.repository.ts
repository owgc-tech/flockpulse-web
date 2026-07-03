import { createClient } from '@supabase/supabase-js';
import type { CourseRow, CreateCourseInput, UpdateCourseInput } from './course.types';

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
      sequence_order: input.sequenceOrder,
    })
    .select('id, tenant_id, name, sequence_order, deleted_at, created_at, updated_at')
    .single();

  if (error) throw error;
  return data as CourseRow;
}

export async function patchCourse(
  id: string, tenantId: string, input: UpdateCourseInput
): Promise<CourseRow | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.sequenceOrder !== undefined) patch.sequence_order = input.sequenceOrder;
  if (input.deletedAt !== undefined) patch.deleted_at = input.deletedAt;

  const { data, error } = await serviceClient()
    .from('courses')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, tenant_id, name, sequence_order, deleted_at, created_at, updated_at')
    .single();

  if (error) throw error;
  return data as CourseRow;
}

export async function getCourse(id: string, tenantId: string): Promise<CourseRow | null> {
  const { data, error } = await serviceClient()
    .from('courses')
    .select('id, tenant_id, name, sequence_order, deleted_at, created_at, updated_at')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) return null;
  return data as CourseRow;
}

export async function listCourses(tenantId: string, includeDeleted = false): Promise<CourseRow[]> {
  let q = serviceClient()
    .from('courses')
    .select('id, tenant_id, name, sequence_order, deleted_at, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('sequence_order', { ascending: true });

  if (!includeDeleted) q = (q as any).is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CourseRow[];
}
