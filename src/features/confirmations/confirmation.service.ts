import { createClient } from '@supabase/supabase-js';
import type { Role } from '@/src/lib/auth/middleware';
import type { PendingConfirmationRow, SubmitConfirmationInput, ConfirmationResult } from './confirmation.types';
import {
  getAssignedMemberIds,
  getPendingConfirmations,
  getSelfReportForConfirmation,
  callResolveLeaderConfirmation,
} from './confirmation.repository';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function serviceError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

async function checkBlockedByGuard(eventId: string): Promise<boolean> {
  const { data } = await serviceClient().rpc('block_actions_on_cancelled_or_locked', {
    p_event_id: eventId,
  });
  return data === true;
}

export async function listPendingConfirmations(
  tenantId: string,
  callerId: string,
  callerRole: Role
): Promise<PendingConfirmationRow[]> {
  // ADMIN sees all pending confirmations tenant-wide; LEADER sees only assigned members.
  let memberIdFilter: string[] | null = null;

  if (callerRole === 'LEADER') {
    memberIdFilter = await getAssignedMemberIds(tenantId, callerId);
  }
  // ADMIN: memberIdFilter stays null → no filter applied

  return getPendingConfirmations(tenantId, memberIdFilter);
}

export async function submitConfirmation(
  tenantId: string,
  callerId: string,
  callerRole: Role,
  selfReportId: string,
  input: SubmitConfirmationInput
): Promise<ConfirmationResult> {
  const { decision, leaderNote } = input;

  // Step 1: Confirm the self-report exists and belongs to this tenant.
  const selfReport = await getSelfReportForConfirmation(tenantId, selfReportId);
  if (!selfReport) {
    throw serviceError('NOT_FOUND', 'Self-report not found');
  }

  // Step 2: Leader scope check — Leader can only confirm for assigned members.
  // Admin bypasses per additive RBAC (Section 4, Rule 3).
  if (callerRole === 'LEADER') {
    const assignedIds = await getAssignedMemberIds(tenantId, callerId);
    if (!assignedIds.includes(selfReport.member_id)) {
      throw serviceError('FORBIDDEN_SCOPE', 'This member is not assigned to you');
    }
  }

  // Step 3: Must be PENDING_CONFIRMATION. The SQL function enforces this atomically,
  // but an app-layer check here surfaces a cleaner error code before hitting the DB.
  if (selfReport.confirmation_status !== 'PENDING_CONFIRMATION') {
    throw serviceError('CONFIRMATION_NOT_ALLOWED', 'Self-report is not pending confirmation');
  }

  // Step 4: FP-27 lock/cancel guard.
  const blocked = await checkBlockedByGuard(selfReport.event_id);
  if (blocked) {
    throw serviceError('ATTENDANCE_NOT_OPEN', 'Confirmation is not permitted for cancelled or locked events');
  }

  // Step 5: Atomic confirm/reject via SECURITY DEFINER function.
  return callResolveLeaderConfirmation(tenantId, selfReportId, callerId, decision, leaderNote ?? null);
}
