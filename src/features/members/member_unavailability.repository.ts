import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface MemberUnavailabilityRangeRow {
  id: string;
  member_id: string;
  start_date: string;
  end_date: string;
  created_at: string;
}

const COLS = 'id, member_id, start_date, end_date, created_at';

export async function listMemberUnavailabilityRanges(
  memberId: string, tenantId: string
): Promise<MemberUnavailabilityRangeRow[]> {
  const { data, error } = await serviceClient()
    .from('member_unavailability_ranges')
    .select(COLS)
    .eq('member_id', memberId)
    .eq('tenant_id', tenantId)
    .order('start_date', { ascending: true });

  if (error) throw error;
  return (data ?? []) as MemberUnavailabilityRangeRow[];
}

export async function insertMemberUnavailabilityRange(
  memberId: string, tenantId: string, startDate: string, endDate: string
): Promise<MemberUnavailabilityRangeRow> {
  const { data, error } = await serviceClient()
    .from('member_unavailability_ranges')
    .insert({ member_id: memberId, tenant_id: tenantId, start_date: startDate, end_date: endDate })
    .select(COLS)
    .single();

  if (error) throw error;
  return data as MemberUnavailabilityRangeRow;
}

// DIP-FP-190-web-adj-2: same defensive triple-scoping as
// deleteMemberUnavailabilityRange below — id + member_id + tenant_id
// together, so an id from another member's range simply matches zero rows
// rather than updating someone else's data.
export async function updateMemberUnavailabilityRange(
  id: string, memberId: string, tenantId: string, startDate: string, endDate: string
): Promise<MemberUnavailabilityRangeRow | null> {
  const { data, error } = await serviceClient()
    .from('member_unavailability_ranges')
    .update({ start_date: startDate, end_date: endDate })
    .eq('id', id)
    .eq('member_id', memberId)
    .eq('tenant_id', tenantId)
    .select(COLS)
    .maybeSingle();

  if (error) throw error;
  return data as MemberUnavailabilityRangeRow | null;
}

// Scoped by member_id in addition to id/tenant_id — mirrors FP-187's
// "structurally impossible to act on anyone but yourself" pattern: even if
// an id from another member's range somehow reached this call, the delete
// simply matches zero rows rather than deleting someone else's data.
export async function deleteMemberUnavailabilityRange(
  id: string, memberId: string, tenantId: string
): Promise<boolean> {
  const { error, count } = await serviceClient()
    .from('member_unavailability_ranges')
    .delete({ count: 'exact' })
    .eq('id', id)
    .eq('member_id', memberId)
    .eq('tenant_id', tenantId);

  if (error) throw error;
  return (count ?? 0) > 0;
}
