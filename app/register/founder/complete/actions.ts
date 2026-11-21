'use server';

import { createTenantAndFoundingAdmin } from '@/src/features/founder-registration/founder-registration.service';

export interface FounderCompleteState {
  success?: boolean;
  tenantId?: string;
  memberId?: string;
  error?: string;
}

export async function completeFounderRegistrationAction(
  accessToken: string,
  _prev: FounderCompleteState,
  formData: FormData
): Promise<FounderCompleteState> {
  if (!accessToken) return { error: 'No active session. Please restart registration.' };

  const communityName = (formData.get('communityName') as string)?.trim();
  const description   = (formData.get('description') as string)?.trim() || null;
  const firstName     = (formData.get('firstName') as string)?.trim();
  const lastName      = (formData.get('lastName') as string)?.trim();
  const gender        = formData.get('gender') as string;
  const maritalStatus = formData.get('maritalStatus') as string;
  const confirmAdult  = formData.get('confirmAdult') === 'on';
  const acceptTerms   = formData.get('acceptTerms') === 'on';

  if (!communityName) return { error: 'Community name is required' };
  if (!firstName)     return { error: 'First name is required' };
  if (!lastName)      return { error: 'Last name is required' };
  if (!gender)        return { error: 'Gender is required' };
  if (!maritalStatus) return { error: 'Marital status is required' };
  if (!confirmAdult)  return { error: 'Please confirm you are 18 or older.' };
  if (!acceptTerms)   return { error: 'Please accept the Terms of Service and the Privacy Policy.' };

  try {
    const result = await createTenantAndFoundingAdmin(accessToken, {
      communityName, description, firstName, lastName, gender, maritalStatus, confirmAdult, acceptTerms,
    });
    return { success: true, tenantId: result.tenantId, memberId: result.memberId };
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'ALREADY_REGISTERED') {
      return { error: 'This account is already registered to a community.' };
    }
    if (code === 'ADULT_NOT_CONFIRMED') {
      return { error: 'Please confirm you are 18 or older.' };
    }
    if (code === 'TERMS_NOT_ACCEPTED') {
      return { error: 'Please accept the Terms of Service and the Privacy Policy.' };
    }
    return { error: 'Registration failed. Please try again or contact support.' };
  }
}
