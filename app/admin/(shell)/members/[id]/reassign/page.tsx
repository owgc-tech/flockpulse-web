import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getMemberById, listMembers } from '@/src/features/members/service';
import { getMembersAssignedToLeader } from '@/src/features/assignments/service';
import type { MemberRow } from '@/src/features/members/member.types';
import BulkReassignForm from './BulkReassignForm';

export default async function BulkReassignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !token) redirect('/login');

  let outgoingLeader: MemberRow;
  try {
    outgoingLeader = await getMemberById(id, tenantId) as unknown as MemberRow;
  } catch {
    redirect('/admin/members');
  }

  // Not role-filtered: DIP-FP-69-FP-72-adj-1 (restricting Pastoral Leader assignment to
  // LEADER/ADMIN roles) was confirmed live to have never been executed — validate_assignment_tenant()
  // has no role clause, so the incoming-Leader pool stays "any active member," matching current
  // live behavior.
  const [members, assignedMembers] = await Promise.all([
    listMembers(tenantId),
    getMembersAssignedToLeader(id, tenantId),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <BulkReassignForm
          token={token}
          outgoingLeader={outgoingLeader}
          members={(members ?? []) as unknown as MemberRow[]}
          assignedMembers={(assignedMembers ?? []) as unknown as MemberRow[]}
        />
      </div>
    </div>
  );
}
