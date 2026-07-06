'use server';

import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

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

  // Clear MFA trust cookie — password reset requires fresh MFA verification.
  const cookieStore = await cookies();
  cookieStore.delete('fp_mfa_expires_at');

  redirect('/login');
}
