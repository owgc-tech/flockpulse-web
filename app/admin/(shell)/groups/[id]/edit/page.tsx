import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import { getGroupById } from '@/src/features/groups/service';
import { getGroupMembers } from '@/src/features/assignments/service';
import { listMembers } from '@/src/features/members/service';
import type { GroupRow } from '@/src/features/groups/group.types';
import GroupEditForm from './GroupEditForm';

export default async function GroupEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/login');

  const tenantId = user.app_metadata?.tenant_id as string | undefined;
  const role = user.app_metadata?.role as string | undefined;
  const token = (await supabase.auth.getSession()).data.session?.access_token;

  if (!tenantId || role !== 'ADMIN' || !token) redirect('/login');

  let group: GroupRow;
  try {
    group = await getGroupById(id, tenantId) as unknown as GroupRow;
  } catch {
    redirect('/admin/groups');
  }

  // listMembers() defaults to active-only — the "add member" picker should only offer
  // active members, matching what trigger_validate_assignment_tenant() itself enforces.
  const [groupMembers, allMembers] = await Promise.all([
    getGroupMembers(id, tenantId),
    listMembers(tenantId),
  ]);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-2xl">
        <GroupEditForm
          token={token}
          group={group}
          groupMembers={groupMembers as unknown as Array<{ assignment_id: string; id: string; first_name: string; last_name: string; email: string }>}
          allMembers={allMembers as unknown as Array<{ id: string; first_name: string; last_name: string }>}
        />
      </div>
    </div>
  );
}
