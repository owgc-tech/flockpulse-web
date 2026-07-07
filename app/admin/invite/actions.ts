'use server';

import { createClient } from '@supabase/supabase-js';
import { inviteMember } from '@/src/features/invitations/invitation.service';
import type { MemberRole } from '@/src/features/invitations/invitation.types';

// Resolve the calling Admin's tenantId and memberId from their JWT.
async function getAdminContext(token: string): Promise<{ tenantId: string; memberId: string } | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;

  if (!tenantId || !memberId || role !== 'ADMIN') return null;
  return { tenantId, memberId };
}

export interface InviteActionState {
  success?: boolean;
  invitationId?: string;
  error?: string;
}

export async function sendInviteAction(
  token: string,
  _prev: InviteActionState,
  formData: FormData
): Promise<InviteActionState> {
  const ctx = await getAdminContext(token);
  if (!ctx) return { error: 'Unauthorized' };

  const email = formData.get('email') as string;
  const role = formData.get('role') as MemberRole;
  const groupId = (formData.get('groupId') as string) || null;

  if (!email || !email.includes('@')) return { error: 'A valid email is required' };
  if (!['ADMIN', 'LEADER', 'MEMBER'].includes(role)) return { error: 'Invalid role' };

  try {
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL}/register/set-password`;
    const invitation = await inviteMember(ctx.tenantId, ctx.memberId, { email, role, groupId, redirectTo });
    return { success: true, invitationId: invitation.id };
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'DUPLICATE_INVITE') return { error: `A pending invite for ${email} already exists` };
    if (code === 'INVITE_FAILED') return { error: `Could not send invite: ${(err as Error).message}` };
    return { error: 'An unexpected error occurred. Please try again.' };
  }
}
