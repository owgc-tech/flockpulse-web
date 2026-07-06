'use server';

import { createSupabaseServerClient } from '@/src/lib/supabase/server';

export interface ResetRequestState {
  success?: boolean;
  error?: string;
}

export async function requestPasswordResetAction(
  _prev: ResetRequestState,
  formData: FormData
): Promise<ResetRequestState> {
  const email = (formData.get('email') as string)?.trim();
  if (!email) return { error: 'Email address is required.' };

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/reset-password/confirm`,
  });

  if (error) return { error: 'Could not send reset email. Please try again.' };

  return { success: true };
}
