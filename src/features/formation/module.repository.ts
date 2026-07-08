import { createClient } from '@supabase/supabase-js';
import type { ModuleRow, CreateModuleInput, UpdateModuleInput } from './module.types';

const COLS = 'id, tenant_id, course_id, name, alias, description, sequence_order, deleted_at, created_at, updated_at';

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
      alias: input.alias ?? null,
      description: input.description ?? null,
      sequence_order: input.sequenceOrder,
    })
    .select(COLS)
    .single();

  if (error) throw error;
  return data as ModuleRow;
}

export async function patchModule(
  id: string, tenantId: string, input: UpdateModuleInput
): Promise<ModuleRow | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.alias !== undefined) patch.alias = input.alias;
  if (input.description !== undefined) patch.description = input.description;
  if (input.sequenceOrder !== undefined) patch.sequence_order = input.sequenceOrder;
  if (input.deletedAt !== undefined) patch.deleted_at = input.deletedAt;

  const { data, error } = await serviceClient()
    .from('modules')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as ModuleRow;
}

export async function getModule(id: string, tenantId: string): Promise<ModuleRow | null> {
  const { data, error } = await serviceClient()
    .from('modules')
    .select(COLS)
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
    .select(COLS)
    .eq('course_id', courseId)
    .eq('tenant_id', tenantId)
    .order('sequence_order', { ascending: true });

  if (!includeDeleted) q = (q as any).is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ModuleRow[];
}

export async function maxActiveModuleSequenceOrder(courseId: string, tenantId: string): Promise<number> {
  const { data, error } = await serviceClient()
    .from('modules')
    .select('sequence_order')
    .eq('course_id', courseId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('sequence_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as { sequence_order: number } | null)?.sequence_order ?? 0;
}

export async function listDeletedModulesForTenant(tenantId: string): Promise<ModuleRow[]> {
  const { data, error } = await serviceClient()
    .from('modules')
    .select(COLS)
    .eq('tenant_id', tenantId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as ModuleRow[];
}

export async function reorderModulesRpc(
  courseId: string, tenantId: string, orderedIds: string[]
): Promise<void> {
  const { error } = await serviceClient().rpc('reorder_modules', {
    p_course_id: courseId,
    p_tenant_id: tenantId,
    p_ids: orderedIds,
  });
  if (error) throw error;
}
