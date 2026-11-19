import { createClient } from '@supabase/supabase-js';
import type { CompleteRegistrationInput, RegistrationResult } from './registration.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// completeRegistration is called in two steps:
//
// Step 1 — call complete_registration() using the registrant's own access token.
//   auth.uid() inside the SQL function resolves to the registrant, which is how
//   the function finds their PENDING invitation without trusting any client input.
//
// Step 2 — using the service-role client, write member_id back to app_metadata.
//   The registrant's own JWT cannot write app_metadata (Admin API only).
//   This is the same two-step pattern used in FP-54's inviteMember.
export async function completeRegistration(
  accessToken: string,
  input: CompleteRegistrationInput
): Promise<RegistrationResult> {
  // Step 1: call complete_registration() authenticated as the registrant.
  const registrantClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  );

  const { data: rpcRows, error: rpcError } = await registrantClient.rpc('complete_registration', {
    p_first_name:     input.firstName,
    p_last_name:      input.lastName,
    p_gender:         input.gender,
    p_marital_status: input.maritalStatus,
    p_birthdate:      input.birthdate,
  });

  if (rpcError) {
    const code = rpcError.message.includes('No pending invitation')
      ? 'NO_PENDING_INVITATION'
      : 'REGISTRATION_FAILED';
    const err = new Error(rpcError.message) as Error & { code: string };
    err.code = code;
    throw err;
  }

  const row = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as {
    member_id: string;
    tenant_id: string;
    role: string;
    group_id: string | null;
  };

  if (!row?.member_id) {
    const err = new Error('complete_registration returned no row') as Error & { code: string };
    err.code = 'REGISTRATION_FAILED';
    throw err;
  }

  // Step 2: write member_id into app_metadata using the Admin API.
  // Get existing app_metadata first so we preserve tenant_id/role/group_id set by FP-54.
  const admin = serviceClient();
  const { data: userData, error: getUserError } = await admin.auth.admin.getUserById(
    // We don't have authUserId here — get it from the registrant's own token.
    await (async () => {
      const { data: { user } } = await registrantClient.auth.getUser();
      return user!.id;
    })()
  );

  if (getUserError || !userData?.user) {
    const err = new Error('Could not resolve auth user after registration') as Error & { code: string };
    err.code = 'METADATA_WRITE_FAILED';
    throw err;
  }

  const existingMeta = userData.user.app_metadata as Record<string, unknown>;
  const { error: metaError } = await admin.auth.admin.updateUserById(userData.user.id, {
    app_metadata: { ...existingMeta, member_id: row.member_id },
  });

  if (metaError) {
    const err = new Error(`Registration succeeded but metadata write failed: ${metaError.message}`) as Error & { code: string };
    err.code = 'METADATA_WRITE_FAILED';
    throw err;
  }

  return {
    memberId: row.member_id,
    tenantId: row.tenant_id,
    role: row.role,
    groupId: row.group_id,
  };
}
