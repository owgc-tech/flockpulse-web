'use server';

import { createClient } from '@supabase/supabase-js';
import { completeRegistration } from '@/src/features/registration/registration.service';
import { getRoleCatalogEntry } from '@/src/features/role-catalog/role-catalog.repository';
import type { Gender, MaritalStatus } from '@/src/features/registration/registration.types';

export interface CompleteRegistrationState {
  success?: boolean;
  memberId?: string;
  error?: string;
}

// FP-228: resolves the invited role's configured title for the pre-registration
// screen. The caller has no members row yet, so withAuth does not apply; instead
// the token is verified with auth.getUser and tenant_id / role_catalog_entry_id are
// taken from the VERIFIED user's app_metadata, never from the client. The lookup
// itself uses the service role, so the user's token needs no table access.
// Best-effort: any failure just means the form falls back to the generic label.
export async function getInviteRoleTitleAction(accessToken: string): Promise<string | null> {
  if (!accessToken) return null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data: { user }, error } = await supabase.auth.getUser(accessToken);
  if (error || !user) return null;

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const entryId = user.app_metadata?.role_catalog_entry_id as string | undefined;
  if (!tenantId || !entryId) return null;

  const entry = await getRoleCatalogEntry(entryId, tenantId);
  return entry?.name ?? null;
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
