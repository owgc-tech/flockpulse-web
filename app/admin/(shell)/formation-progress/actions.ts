'use server';

import { createClient } from '@supabase/supabase-js';
import { computeAllCoursesProgress } from '@/src/features/formation/formation-completion.service';
import { recordManualCompletion } from '@/src/features/formation/talk-completions.service';
import { getAssignedMemberIds } from '@/src/features/confirmations/confirmation.repository';
import { isAdminTier, isExactlyLeaderTier, isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';

// DIP-FP-114-web: these actions previously had zero auth check of their own —
// relying entirely on the page-level gate to keep them out of reach. That's not
// a real boundary for a Next.js Server Action, which is independently callable
// by its compiled reference regardless of what rendered the button that calls
// it. Now that this page is Leader-tier-reachable too, an explicit check is
// required here — mirrors the token-based getAdminContext() pattern already
// used in community/actions.ts, but resolves the caller's role rather than
// hardcoding Admin-tier, since reads here are Leader-tier-or-above.
async function getCallerContext(token: string): Promise<{ tenantId: string; memberId: string; role: Role } | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const role = user.app_metadata?.role as Role | undefined;

  if (!tenantId || !memberId || !role) return null;
  return { tenantId, memberId, role };
}

export async function getMemberProgressAction(token: string, memberId: string, tenantId: string) {
  const ctx = await getCallerContext(token);
  if (!ctx || !isLeaderTierOrAbove(ctx.role) || ctx.tenantId !== tenantId) {
    throw new Error('Unauthorized');
  }
  if (isExactlyLeaderTier(ctx.role)) {
    const assignedMemberIds = await getAssignedMemberIds(tenantId, ctx.memberId);
    if (!assignedMemberIds.includes(memberId)) {
      throw new Error('Unauthorized');
    }
  }
  return computeAllCoursesProgress(memberId, tenantId);
}

export async function recordManualCompletionAction(
  token: string,
  tenantId: string,
  adminMemberId: string,
  memberId: string,
  talkId: string,
  completedAt: string
) {
  const ctx = await getCallerContext(token);
  if (!ctx || !isAdminTier(ctx.role) || ctx.tenantId !== tenantId || ctx.memberId !== adminMemberId) {
    throw new Error('Unauthorized');
  }
  return recordManualCompletion(tenantId, adminMemberId, memberId, talkId, completedAt);
}
