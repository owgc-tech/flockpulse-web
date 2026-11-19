import { createClient } from '@supabase/supabase-js';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export interface ActiveTalkRow {
  id: string;
  module_id: string;
  name: string;
  sequence_order: number;
  for_single_men: boolean;
  for_single_women: boolean;
  for_married_men: boolean;
  for_married_women: boolean;
}

export interface ActiveModuleRow {
  id: string;
  course_id: string;
  name: string;
  sequence_order: number;
}


export interface MemberDemographics {
  gender: string | null;
  marital_status: string | null;
}

export async function fetchActiveModulesForCourse(
  courseId: string, tenantId: string
): Promise<ActiveModuleRow[]> {
  const { data, error } = await serviceClient()
    .from('modules')
    .select('id, course_id, name, sequence_order')
    .eq('course_id', courseId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('sequence_order', { ascending: true });

  if (error) throw error;
  return (data ?? []) as ActiveModuleRow[];
}

export async function fetchActiveTalksForModules(
  moduleIds: string[], tenantId: string
): Promise<ActiveTalkRow[]> {
  if (moduleIds.length === 0) return [];
  const { data, error } = await serviceClient()
    .from('talks')
    .select('id, module_id, name, sequence_order, for_single_men, for_single_women, for_married_men, for_married_women')
    .in('module_id', moduleIds)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .order('sequence_order', { ascending: true });

  if (error) throw error;
  return (data ?? []) as ActiveTalkRow[];
}

export async function fetchCompletionsForTalks(
  memberId: string, talkIds: string[], tenantId: string
): Promise<Set<string>> {
  if (talkIds.length === 0) return new Set();
  const { data, error } = await serviceClient()
    .from('talk_completions')
    .select('talk_id')
    .eq('member_id', memberId)
    .eq('tenant_id', tenantId)
    .in('talk_id', talkIds);

  if (error) throw error;
  return new Set((data ?? []).map((r: { talk_id: string }) => r.talk_id));
}

export async function fetchMemberDemographics(
  memberId: string, tenantId: string
): Promise<MemberDemographics> {
  const { data, error } = await serviceClient()
    .from('members')
    .select('gender, marital_status')
    .eq('id', memberId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { gender: null, marital_status: null };
  return {
    gender: (data as { gender: string | null }).gender,
    marital_status: (data as { marital_status: string | null }).marital_status,
  };
}
