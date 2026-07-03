import { createClient } from '@supabase/supabase-js';
import type { ModuleRow, CreateModuleInput, UpdateModuleInput } from './module.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function insertModule(tenantId: string, input: CreateModuleInput): Promise<ModuleRow> {
  const { data, error } = await serviceClient()
    .from('modules')
    .insert({
      tenant_id: tenantId,
      course_id: input.courseId,
      name: input.name,
      sequence_order: input.sequenceOrder,
    })
    .select('id, tenant_id, course_id, name, sequence_order, deleted_at, created_at, updated_at')
    .single();

  if (error) throw error;
  return data as ModuleRow;
}

export async function patchModule(
  id: string, tenantId: string, input: UpdateModuleInput
): Promise<ModuleRow | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.sequenceOrder !== undefined) patch.sequence_order = input.sequenceOrder;
  if (input.deletedAt !== undefined) patch.deleted_at = input.deletedAt;

  const { data, error } = await serviceClient()
    .from('modules')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select('id, tenant_id, course_id, name, sequence_order, deleted_at, created_at, updated_at')
    .single();

  if (error) throw error;
  return data as ModuleRow;
}

export async function getModule(id: string, tenantId: string): Promise<ModuleRow | null> {
  const { data, error } = await serviceClient()
    .from('modules')
    .select('id, tenant_id, course_id, name, sequence_order, deleted_at, created_at, updated_at')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) return null;
  return data as ModuleRow;
}

export async function listModulesByCourse(
  courseId: string, tenantId: string, includeDeleted = false
): Promise<ModuleRow[]> {
  let q = serviceClient()
    .from('modules')
    .select('id, tenant_id, course_id, name, sequence_order, deleted_at, created_at, updated_at')
    .eq('course_id', courseId)
    .eq('tenant_id', tenantId)
    .order('sequence_order', { ascending: true });

  if (!includeDeleted) q = (q as any).is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ModuleRow[];
}
