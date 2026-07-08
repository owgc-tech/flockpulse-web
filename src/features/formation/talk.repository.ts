import { createClient } from '@supabase/supabase-js';
import type { TalkRow, CreateTalkInput, UpdateTalkInput } from './talk.types';

const COLS = 'id, tenant_id, module_id, name, alias, description, sequence_order, for_single_men, for_single_women, for_married_men, for_married_women, deleted_at, created_at, updated_at';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function insertTalk(tenantId: string, input: CreateTalkInput): Promise<TalkRow> {
  const { data, error } = await serviceClient()
    .from('talks')
    .insert({
      tenant_id: tenantId,
      module_id: input.moduleId,
      name: input.name,
      alias: input.alias ?? null,
      description: input.description ?? null,
      sequence_order: input.sequenceOrder,
      for_single_men: input.forSingleMen ?? true,
      for_single_women: input.forSingleWomen ?? true,
      for_married_men: input.forMarriedMen ?? true,
      for_married_women: input.forMarriedWomen ?? true,
    })
    .select(COLS)
    .single();

  if (error) throw error;
  return data as TalkRow;
}

export async function patchTalk(
  id: string, tenantId: string, input: UpdateTalkInput
): Promise<TalkRow | null> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.alias !== undefined) patch.alias = input.alias;
  if (input.description !== undefined) patch.description = input.description;
  if (input.sequenceOrder !== undefined) patch.sequence_order = input.sequenceOrder;
  if (input.forSingleMen !== undefined) patch.for_single_men = input.forSingleMen;
  if (input.forSingleWomen !== undefined) patch.for_single_women = input.forSingleWomen;
  if (input.forMarriedMen !== undefined) patch.for_married_men = input.forMarriedMen;
  if (input.forMarriedWomen !== undefined) patch.for_married_women = input.forMarriedWomen;
  if (input.deletedAt !== undefined) patch.deleted_at = input.deletedAt;

  const { data, error } = await serviceClient()
    .from('talks')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(COLS)
    .single();

  if (error) throw error;
  return data as TalkRow;
}

export async function getTalk(id: string, tenantId: string): Promise<TalkRow | null> {
  const { data, error } = await serviceClient()
    .from('talks')
    .select(COLS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) return null;
  return data as TalkRow;
}

export async function listTalksByModule(
  moduleId: string, tenantId: string, includeDeleted = false
): Promise<TalkRow[]> {
  let q = serviceClient()
    .from('talks')
    .select(COLS)
    .eq('module_id', moduleId)
    .eq('tenant_id', tenantId)
    .order('sequence_order', { ascending: true });

  if (!includeDeleted) q = (q as any).is('deleted_at', null);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TalkRow[];
}

export async function getTalkByIdForValidation(
  id: string, tenantId: string
): Promise<{ id: string; deleted_at: string | null } | null> {
  const { data, error } = await serviceClient()
    .from('talks')
    .select('id, deleted_at')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single();

  if (error) return null;
  return data as { id: string; deleted_at: string | null };
}

export async function reorderTalksRpc(
  moduleId: string, tenantId: string, orderedIds: string[]
): Promise<void> {
  const { error } = await serviceClient().rpc('reorder_talks', {
    p_module_id: moduleId,
    p_tenant_id: tenantId,
    p_ids: orderedIds,
  });
  if (error) throw error;
}
