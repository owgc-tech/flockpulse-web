import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface TalkCompletionRow {
  id: string;
  tenant_id: string;
  member_id: string;
  talk_id: string;
  completed_at: string;
  source: 'event_attendance' | 'manual';
  source_event_id: string | null;
  recorded_by: string | null;
  created_at: string;
}

/**
 * Insert a manual completion row.
 * On unique constraint violation (23505), returns { conflict: existing row }.
 * On success, returns the new TalkCompletionRow.
 */
export async function insertManualCompletion(
  tenantId: string,
  memberId: string,
  talkId: string,
  completedAt: string,
  recordedByMemberId: string
): Promise<TalkCompletionRow | { conflict: TalkCompletionRow }> {
  const { data, error } = await serviceClient()
    .from('talk_completions')
    .insert({
      tenant_id: tenantId,
      member_id: memberId,
      talk_id: talkId,
      completed_at: completedAt,
      source: 'manual',
      recorded_by: recordedByMemberId,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      // Unique violation — fetch the existing row to surface its source
      const { data: existing } = await serviceClient()
        .from('talk_completions')
        .select()
        .eq('tenant_id', tenantId)
        .eq('member_id', memberId)
        .eq('talk_id', talkId)
        .single();
      return { conflict: existing as TalkCompletionRow };
    }
    throw error;
  }

  return data as TalkCompletionRow;
}

/**
 * Fetch a single completion row for a (tenant, member, talk) triple.
 * Returns null if no completion exists.
 */
export async function getCompletionForMemberTalk(
  tenantId: string,
  memberId: string,
  talkId: string
): Promise<TalkCompletionRow | null> {
  const { data } = await serviceClient()
    .from('talk_completions')
    .select()
    .eq('tenant_id', tenantId)
    .eq('member_id', memberId)
    .eq('talk_id', talkId)
    .maybeSingle();

  return data as TalkCompletionRow | null;
}
