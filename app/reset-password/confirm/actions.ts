'use server';

import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export interface ResetConfirmState {
  error?: string;
}

export async function confirmPasswordResetAction(
  accessToken: string,
  _prev: ResetConfirmState,
  formData: FormData
): Promise<ResetConfirmState> {
  if (!accessToken) return { error: 'No active session. Please request a new reset link.' };

  const password = formData.get('password') as string;
  const confirm = formData.get('confirmPassword') as string;

  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (password !== confirm) return { error: 'Passwords do not match.' };

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: 'Could not update password. The reset link may have expired.' };

  // Globally invalidate ALL sessions for this account — not just this browser's.
  // Without this, an attacker who triggered the password reset (or was already
  // logged in on another device) keeps their active session untouched.
  // Admin API signOut with scope='global' revokes every refresh token for the user.
  // We use the accessToken passed in (the reset session's JWT) to identify the user.
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  await svc.auth.admin.signOut(accessToken, 'global');

  // Clear MFA trust cookie on this browser too — belt-and-suspenders.
  const cookieStore = await cookies();
  cookieStore.delete('fp_mfa_expires_at');

  redirect('/login');
}
