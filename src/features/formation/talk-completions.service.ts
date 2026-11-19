import { createClient } from '@supabase/supabase-js';
import {
  insertManualCompletion,
  type TalkCompletionRow,
} from './talk-completions.repository';
import { getTalkByIdForValidation } from './talk.repository';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface ManualCompletionResult {
  success: true;
  row: TalkCompletionRow;
}

export interface ManualCompletionConflict {
  success: false;
  code: 'VALIDATION_ERROR';
  message: string;
  existingRow: TalkCompletionRow;
}

export interface ManualCompletionNotFound {
  success: false;
  code: 'NOT_FOUND';
  message: string;
}

export type ManualCompletionOutcome =
  | ManualCompletionResult
  | ManualCompletionConflict
  | ManualCompletionNotFound;

/**
 * FP-81: Admin-initiated manual completion entry.
 *
 * 1. Validates member belongs to tenant and is not soft-deleted.
 * 2. Validates talk belongs to tenant and is not soft-deleted.
 * 3. Inserts a manual completion row; on conflict surfaces the existing source.
 * 4. On success, writes an audit log entry.
 *
 * Source-precedence policy (DIP Grounding Check item 9):
 *   Manual entry never overwrites an existing row — returns conflict info instead.
 */
export async function recordManualCompletion(
  tenantId: string,
  adminMemberId: string,
  memberId: string,
  talkId: string,
  completedAt: string
): Promise<ManualCompletionOutcome> {
  // 1. Validate member exists and belongs to tenant (not soft-deleted)
  const { data: memberData } = await serviceClient()
    .from('members')
    .select('id')
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!memberData) {
    return {
      success: false,
      code: 'NOT_FOUND',
      message: `Member ${memberId} not found in tenant`,
    };
  }

  // 2. Validate talk exists, belongs to tenant, and is not soft-deleted
  const talk = await getTalkByIdForValidation(talkId, tenantId);
  if (!talk) {
    return {
      success: false,
      code: 'NOT_FOUND',
      message: `Talk ${talkId} not found in tenant`,
    };
  }
  if (talk.deleted_at !== null) {
    return {
      success: false,
      code: 'NOT_FOUND',
      message: `Talk ${talkId} has been deleted`,
    };
  }

  // 3. Insert (on conflict return info, never overwrite)
  const result = await insertManualCompletion(
    tenantId, memberId, talkId, completedAt, adminMemberId
  );

  if ('conflict' in result) {
    const existing = result.conflict;
    const sourceLabel =
      existing.source === 'event_attendance'
        ? `event attendance on ${existing.completed_at.slice(0, 10)}`
        : `manual entry on ${existing.completed_at.slice(0, 10)}`;
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      message: `Talk already recorded as completed via ${sourceLabel}`,
      existingRow: existing,
    };
  }

  // 4. Write audit log
  await serviceClient().rpc('write_audit_log', {
    p_tenant_id: tenantId,
    p_entity_type: 'talk_completion',
    p_entity_id: result.id,
    p_action: 'manual_entry',
    p_actor_id: adminMemberId,
    p_before: null,
    p_after: result,
  });

  return { success: true, row: result };
}
