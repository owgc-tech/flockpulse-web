import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// FP-254: true when this member has not yet accepted the CURRENT Terms of Service and Privacy Policy
// (and confirmed 18+). Ids come from the caller's verified JWT, never from a request.
export async function getAcceptanceRequired(memberId: string, tenantId: string): Promise<boolean> {
  const { data, error } = await serviceClient().rpc('member_acceptance_required', {
    p_tenant_id: tenantId,
    p_member_id: memberId,
  });
  if (error) throw error;
  return data === true;
}

// FP-254: stores the acceptance (current effective dates, 18+ yes, time). Idempotent: accepting again
// for the same effective dates keeps the first row. Returns the stored time.
export async function recordAcceptance(
  memberId: string,
  tenantId: string,
  confirmAdult: boolean
): Promise<string> {
  const { data, error } = await serviceClient().rpc('record_member_acceptance', {
    p_tenant_id: tenantId,
    p_member_id: memberId,
    p_confirm_18: confirmAdult,
  });
  if (error) {
    if (error.code === 'FP422') {
      const err = new Error(error.message) as Error & { code: string };
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    if (error.code === 'FP404') {
      const err = new Error('Member not found for this tenant') as Error & { code: string };
      err.code = 'NOT_FOUND_IN_TENANT';
      throw err;
    }
    throw error;
  }
  return data as string;
}
