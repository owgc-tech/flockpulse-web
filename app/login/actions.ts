'use server';

import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { redirect } from 'next/navigation';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';

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

  // DIP-FP-114-web: rank-based (Admin-tier or Leader-tier), not a literal
  // `role !== 'ADMIN'` — widens login to Leader-tier while still correctly
  // covering FP-113's Admin-tier synonyms (SR_COORDINATOR/COORDINATOR/
  // COMMUNITY_SERVANT), which the old literal check would have rejected.
  const role = data.user?.app_metadata?.role as Role | undefined;
  if (!role || !isLeaderTierOrAbove(role)) {
    await supabase.auth.signOut();
    return { error: 'This account does not have access to the Leadership sign-in.' };
  }

  // Check MFA enrollment — mandatory for all Admin-tier and Leader-tier accounts.
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
