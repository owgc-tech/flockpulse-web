import { createClient } from '@supabase/supabase-js';
import type { FounderRegistrationResult } from './founder-registration.types';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// createTenantAndFoundingAdmin mirrors the two-step pattern from registration.service.ts:
//
// Step 1 — call create_tenant_and_founding_admin() authenticated as the founder.
//   auth.uid() inside the SQL function resolves to the founder, which is how
//   the function reads their email from auth.users without trusting client input.
//
// Step 2 — using the service-role client, write tenant_id, role, member_id to
//   app_metadata. The founder's own JWT cannot write app_metadata (Admin API only).
//
// The caller is responsible for refreshing the browser session afterward so the
// new claims propagate to the in-memory JWT.
export async function createTenantAndFoundingAdmin(
  accessToken: string,
  params: {
    communityName: string;
    firstName: string;
    lastName: string;
    gender: string;
    maritalStatus: string;
    birthdate: string;
  }
): Promise<FounderRegistrationResult> {
  // Step 1: call the RPC authenticated as the founder.
  const founderClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  );

  const { data: rpcRows, error: rpcError } = await founderClient.rpc(
    'create_tenant_and_founding_admin',
    {
      p_community_name:  params.communityName,
      p_first_name:      params.firstName,
      p_last_name:       params.lastName,
      p_gender:          params.gender,
      p_marital_status:  params.maritalStatus,
      p_birthdate:       params.birthdate,
    }
  );

  if (rpcError) {
    const code = rpcError.message.includes('already registered')
      ? 'ALREADY_REGISTERED'
      : 'REGISTRATION_FAILED';
    const err = new Error(rpcError.message) as Error & { code: string };
    err.code = code;
    throw err;
  }

  const row = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as {
    tenant_id: string;
    member_id: string;
  } | null;

  if (!row?.tenant_id || !row?.member_id) {
    const err = new Error('create_tenant_and_founding_admin returned no row') as Error & { code: string };
    err.code = 'REGISTRATION_FAILED';
    throw err;
  }

  // Step 2: write app_metadata via the service-role Admin API.
  const svc = serviceClient();
  const { data: authUser } = await founderClient.auth.getUser();
  const userId = authUser?.user?.id;

  if (!userId) {
    const err = new Error('Could not resolve founder user id') as Error & { code: string };
    err.code = 'REGISTRATION_FAILED';
    throw err;
  }

  const { error: metaError } = await svc.auth.admin.updateUserById(userId, {
    app_metadata: {
      tenant_id: row.tenant_id,
      role: 'ADMIN',
      member_id: row.member_id,
    },
  });

  if (metaError) {
    const err = new Error('Failed to set app_metadata: ' + metaError.message) as Error & { code: string };
    err.code = 'METADATA_FAILED';
    throw err;
  }

  return { tenantId: row.tenant_id, memberId: row.member_id };
}
