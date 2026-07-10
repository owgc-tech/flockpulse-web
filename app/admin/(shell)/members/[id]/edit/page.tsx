import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getMemberById, listMembers } from '@/src/features/members/service';
import { getActiveLeaderAssignment, getMembersAssignedToLeader } from '@/src/features/assignments/service';
import type { MemberRow } from '@/src/features/members/member.types';
import MemberEditForm from './MemberEditForm';

export default async function MemberEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !token) redirect('/login');

  let member: MemberRow;
  try {
    member = await getMemberById(id, tenantId) as unknown as MemberRow;
  } catch {
    redirect('/admin/members');
  }

  // listMembers() defaults to active-only — the Pastoral Leader dropdown should only offer
  // active members, matching what trigger_validate_assignment_tenant() itself enforces.
  const [members, currentLeaderAssignment, assignedMembers] = await Promise.all([
    listMembers(tenantId),
    getActiveLeaderAssignment(id, tenantId),
    getMembersAssignedToLeader(id, tenantId),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <MemberEditForm
          token={token}
          member={member}
          members={(members ?? []) as unknown as MemberRow[]}
          currentLeaderMemberId={currentLeaderAssignment?.leader_member_id ?? null}
          assignedMemberCount={(assignedMembers ?? []).length}
        />
      </div>
    </div>
  );
}
