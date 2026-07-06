'use server';

import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export interface MFAEnrollVerifyState {
  error?: string;
}

// Starts enrollment — returns the QR code SVG and factor ID.
// Called as a regular Server Action (not form action) so the client
// can display the QR code before asking for the verification code.
export async function startMFAEnrollAction(): Promise<
  { factorId: string; qrCode: string; secret: string } | { error: string }
> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'FlockPulse Admin',
  });

  if (error || !data?.totp) {
    return { error: error?.message ?? 'Could not start MFA enrollment.' };
  }

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

// Verifies the TOTP code entered by the admin against the enrolled factor.
// On success: promotes session to aal2, sets MFA trust cookie, redirects to /admin/invitations.
export async function verifyMFAEnrollAction(
  factorId: string,
  _prev: MFAEnrollVerifyState,
  formData: FormData
): Promise<MFAEnrollVerifyState> {
  const code = (formData.get('code') as string)?.trim().replace(/\s/g, '');
  if (!code || code.length !== 6) return { error: 'Enter the 6-digit code from your authenticator app.' };

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
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

  redirect('/admin/invitations');
}
