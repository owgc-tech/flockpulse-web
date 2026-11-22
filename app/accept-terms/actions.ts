'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { recordAcceptance } from '@/src/features/legal/acceptance.service';

export interface AcceptTermsState {
  error?: string;
}

// FP-254: one-time acceptance for an existing member. Member and tenant come from the VERIFIED
// user's app_metadata (getUser), never from the form. Both boxes must be ticked.
export async function acceptTermsAction(
  _prev: AcceptTermsState,
  formData: FormData
): Promise<AcceptTermsState> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const memberId = user.app_metadata?.member_id as string | undefined;
  if (!tenantId || !memberId) redirect('/login');

  const acceptTerms = formData.get('acceptTerms') === 'on';
  const confirmAdult = formData.get('confirmAdult') === 'on';
  if (!acceptTerms) return { error: 'Please accept the Terms of Service and the Privacy Policy.' };
  if (!confirmAdult) return { error: 'Please confirm you are 18 or older.' };

  try {
    await recordAcceptance(memberId, tenantId, true);
  } catch {
    // No personal data in the log: the error type only.
    console.error('accept-terms: could not record acceptance');
    return { error: 'We could not save your confirmation. Please try again.' };
  }

  redirect('/');
}
