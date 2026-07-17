'use server';

import { createClient } from '@supabase/supabase-js';
import { updateMyProfile } from '@/src/features/members/service';

// FP-135: self-service profile edit — any authenticated member/leader/admin
// may update their own record, unlike Community's Admin-tier-only getAdminContext.
async function getSelfContext(token: string): Promise<{ tenantId: string; memberId: string } | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  if (!tenantId || !memberId) return null;
  return { tenantId, memberId };
}

function mapError(e: unknown): string {
  const code = (e as { code?: string }).code;
  const msg = (e as Error).message ?? 'An unexpected error occurred';
  if (code === 'INVALID_VALUE') return msg;
  return 'An unexpected error occurred. Please try again.';
}

export interface ProfileActionResult {
  error?: string;
}

export async function updateMyProfileAction(
  token: string,
  formData: FormData
): Promise<ProfileActionResult> {
  const ctx = await getSelfContext(token);
  if (!ctx) return { error: 'Unauthorized' };

  const firstName = (formData.get('firstName') as string | null)?.trim();
  const lastName = (formData.get('lastName') as string | null)?.trim();
  const gender = (formData.get('gender') as string | null) || undefined;
  const maritalStatus = (formData.get('maritalStatus') as string | null) || undefined;
  const birthdate = (formData.get('birthdate') as string | null) || undefined;

  try {
    await updateMyProfile(ctx.memberId, ctx.tenantId, {
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      gender: gender as 'MALE' | 'FEMALE' | undefined,
      maritalStatus: maritalStatus as 'SINGLE' | 'MARRIED' | 'WIDOWED' | 'DIVORCED' | 'SEPARATED' | undefined,
      birthdate,
    });
    return {};
  } catch (e) {
    return { error: mapError(e) };
  }
}
