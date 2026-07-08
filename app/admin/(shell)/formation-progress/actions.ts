'use server';

import { listMembers } from '@/src/features/members/service';
import { computeAllCoursesProgress } from '@/src/features/formation/formation-completion.service';
import { recordManualCompletion } from '@/src/features/formation/talk-completions.service';

export async function listMembersAction(tenantId: string) {
  return listMembers(tenantId);
}

export async function getMemberProgressAction(memberId: string, tenantId: string) {
  return computeAllCoursesProgress(memberId, tenantId);
}

export async function recordManualCompletionAction(
  tenantId: string,
  adminMemberId: string,
  memberId: string,
  talkId: string,
  completedAt: string
) {
  return recordManualCompletion(tenantId, adminMemberId, memberId, talkId, completedAt);
}
