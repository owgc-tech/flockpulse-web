import { createClient } from '@supabase/supabase-js';
import type { TaskRow, CreateTaskInput, UpdateTaskInput } from './task.types';

const COLS = 'id, tenant_id, name, deleted_at, created_at, updated_at';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function insertTask(tenantId: string, input: CreateTaskInput): Promise<TaskRow> {
  const { data, error } = await serviceClient()
    .from('tasks')
    .insert({
      tenant_id: tenantId,
      name: input.name,
    })
    .select(COLS)
    .single();

  if (error) throw error;
  return data as TaskRow;
}

export async function patchTask(
  id: string, tenantId: string, input: UpdateTaskInput
): Promise<TaskRow | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.deletedAt !== undefined) patch.deleted_at = input.deletedAt;

  const { data, error } = await serviceClient()
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as TaskRow;
}

export async function getTask(id: string, tenantId: string): Promise<TaskRow | null> {
  const { data, error } = await serviceClient()
    .from('tasks')
    .select(COLS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) return null;
  return data as TaskRow;
}

export async function listTasks(tenantId: string, includeDeleted = false): Promise<TaskRow[]> {
  let q = serviceClient()
    .from('tasks')
    .select(COLS)
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });

  if (!includeDeleted) q = (q as any).is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TaskRow[];
}
