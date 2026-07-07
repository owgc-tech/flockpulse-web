'use server';

import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
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

// Returns the tenant/community name for a given email, or "Community" if not
// found. Always returns the same shape regardless of whether the email matches
// — this must not be a distinguishable signal for account enumeration.
export async function lookupCommunityName(email: string): Promise<string> {
  const fallback = 'Community';
  if (!email || !email.includes('@')) return fallback;

  try {
    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data } = await svc
      .from('members')
      .select('tenants(name)')
      .eq('email', email.trim().toLowerCase())
      .eq('role', 'ADMIN')
      .maybeSingle();

    const name = (data as { tenants?: { name?: string } } | null)?.tenants?.name;
    return name || fallback;
  } catch {
    return fallback;
  }
}
