'use server';

import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export interface MFAChallengeState {
  error?: string;
}

export async function mfaChallengeAction(
  next: string,
  _prev: MFAChallengeState,
  formData: FormData
): Promise<MFAChallengeState> {
  const code = (formData.get('code') as string)?.trim().replace(/\s/g, '');
  if (!code || code.length !== 6) return { error: 'Enter the 6-digit code from your authenticator app.' };

  const supabase = await createSupabaseServerClient();

  // Identify the verified TOTP factor for this user.
  const { data: factorData, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: 'Could not load MFA factors. Please sign in again.' };

  const factor = factorData?.totp?.find(f => f.status === 'verified');
  if (!factor) {
    // No verified factor — send to enrollment.
    redirect('/admin/mfa-enroll');
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });

  if (error) return { error: 'Incorrect code. Please try again.' };

  // Look up the member's configured trust duration.
  const { data: { user } } = await supabase.auth.getUser();
  const memberId = user?.app_metadata?.member_id as string | undefined;

  let trustDays = 28;
  if (memberId) {
    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: member } = await svc
      .from('members')
      .select('mfa_trust_duration_days')
      .eq('id', memberId)
      .single();
    if (member?.mfa_trust_duration_days) trustDays = member.mfa_trust_duration_days;
  }

  const expiresAt = Date.now() + trustDays * 24 * 60 * 60 * 1000;
  const cookieStore = await cookies();
  cookieStore.set('fp_mfa_expires_at', String(expiresAt), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: trustDays * 24 * 60 * 60,
  });

  // Redirect to the originally-requested admin route, or default to /admin/invitations.
  const destination = next && next.startsWith('/admin') ? next : '/admin/invitations';
  redirect(destination);
}
