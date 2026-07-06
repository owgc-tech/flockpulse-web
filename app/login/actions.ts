'use server';

import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { redirect } from 'next/navigation';

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = (formData.get('email') as string)?.trim();
  const password = formData.get('password') as string;

  if (!email || !password) return { error: 'Email and password are required.' };

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: 'Invalid email or password.' };
  }

  const role = data.user?.app_metadata?.role as string | undefined;
  if (role !== 'ADMIN') {
    await supabase.auth.signOut();
    return { error: 'This account does not have Admin access.' };
  }

  // Check MFA enrollment — mandatory for all Admins.
  // listFactors() returns factors registered for the current session's user.
  const { data: factorData } = await supabase.auth.mfa.listFactors();
  const hasVerifiedFactor = factorData?.totp?.some(f => f.status === 'verified') ?? false;

  if (!hasVerifiedFactor) {
    // Redirect to enrollment — no bypass possible.
    redirect('/admin/mfa-enroll');
  }

  // Password-only login confirmed; MFA challenge required before /admin access.
  // Proxy will redirect to /login/mfa-challenge on any /admin/* request.
  // Send the user there now directly to avoid that bounce.
  redirect('/login/mfa-challenge');
}
