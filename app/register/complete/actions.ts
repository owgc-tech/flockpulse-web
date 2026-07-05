'use server';

import { completeRegistration } from '@/src/features/registration/registration.service';
import type { Gender, MaritalStatus } from '@/src/features/registration/registration.types';

export interface CompleteRegistrationState {
  success?: boolean;
  memberId?: string;
  error?: string;
}

export async function completeRegistrationAction(
  accessToken: string,
  _prev: CompleteRegistrationState,
  formData: FormData
): Promise<CompleteRegistrationState> {
  if (!accessToken) return { error: 'No active session. Please restart registration.' };

  const firstName    = (formData.get('firstName') as string)?.trim();
  const lastName     = (formData.get('lastName') as string)?.trim();
  const gender       = formData.get('gender') as Gender;
  const maritalStatus = formData.get('maritalStatus') as MaritalStatus;
  const birthdate    = formData.get('birthdate') as string;

  if (!firstName) return { error: 'First name is required' };
  if (!lastName)  return { error: 'Last name is required' };
  if (!['MALE', 'FEMALE'].includes(gender)) return { error: 'Gender is required' };
  if (!['SINGLE', 'MARRIED'].includes(maritalStatus)) return { error: 'Marital status is required' };
  if (!birthdate) return { error: 'Birthdate is required' };

  try {
    const result = await completeRegistration(accessToken, {
      firstName,
      lastName,
      gender,
      maritalStatus,
      birthdate,
    });
    return { success: true, memberId: result.memberId };
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === 'NO_PENDING_INVITATION') {
      return { error: 'No pending invitation found for this account. The link may have already been used or expired.' };
    }
    if (code === 'METADATA_WRITE_FAILED') {
      return { error: 'Registration completed but account setup failed. Please contact support.' };
    }
    return { error: 'Registration failed. Please try again or contact support.' };
  }
}
