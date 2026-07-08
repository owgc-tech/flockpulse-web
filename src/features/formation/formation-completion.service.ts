import {
  fetchActiveModulesForCourse,
  fetchActiveTalksForModules,
  fetchCompletionsForTalks,
  fetchMemberDemographics,
  type ActiveTalkRow,
  type MemberDemographics,
} from './formation-completion.repository';
import { listCourses } from './course.repository';

export interface TalkProgress {
  talk_id: string;
  talk_name: string;
  completed: boolean;
  completed_at: string | null;
}

export interface ModuleProgress {
  module_id: string;
  module_name: string;
  module_completed: boolean;
  talks: TalkProgress[];
}

export interface CourseProgress {
  member_id: string;
  course_id: string;
  completed_talk_count: number;
  total_talk_count: number;
  course_completed: boolean;
  modules: ModuleProgress[];
}

/**
 * Determine whether a talk is relevant to a member given their demographics.
 *
 * Relevance mapping (DIP Grounding Check item 3):
 *   MALE + SINGLE   → for_single_men flag
 *   FEMALE + SINGLE → for_single_women flag
 *   MALE + MARRIED  → for_married_men flag
 *   FEMALE + MARRIED→ for_married_women flag
 *
 * "No restrictions" = all four flags true (DB CHECK ensures at least one must be
 * true, so a talk with all four true is universally relevant).
 *
 * If gender or marital_status is null/unknown → fail-open (include all talks).
 *
 * INVARIANT (FP-77 AC): computed live at query time; never cached or materialized.
 */
function isTalkRelevant(talk: ActiveTalkRow, demographics: MemberDemographics): boolean {
  const { gender, marital_status } = demographics;

  // Fail-open: unknown demographics → include every talk
  if (!gender || !marital_status) return true;

  if (gender === 'MALE' && marital_status === 'SINGLE') return talk.for_single_men;
  if (gender === 'FEMALE' && marital_status === 'SINGLE') return talk.for_single_women;
  if (gender === 'MALE' && marital_status === 'MARRIED') return talk.for_married_men;
  if (gender === 'FEMALE' && marital_status === 'MARRIED') return talk.for_married_women;

  // Unrecognised combination → fail-open
  return true;
}

export async function computeCourseProgress(
  memberId: string, courseId: string, tenantId: string
): Promise<CourseProgress> {
  // Fetch member demographics once (FP-77: live, no caching)
  const demographics = await fetchMemberDemographics(memberId, tenantId);

  const modules = await fetchActiveModulesForCourse(courseId, tenantId);
  const moduleIds = modules.map(m => m.id);

  const allTalks = await fetchActiveTalksForModules(moduleIds, tenantId);

  // Filter to member-relevant talks only (excluded talks drop from denominator entirely)
  const relevantTalks = allTalks.filter(t => isTalkRelevant(t, demographics));
  const relevantTalkIds = relevantTalks.map(t => t.id);

  // Single query against talk_completions (replaces old events/attendance join)
  // INVARIANT (Rule 4): only a talk_completions row constitutes completion.
  const completedSet = await fetchCompletionsForTalks(memberId, relevantTalkIds, tenantId);

  // Group relevant talks by module
  const talksByModule = new Map<string, typeof relevantTalks>();
  for (const t of relevantTalks) {
    const list = talksByModule.get(t.module_id) ?? [];
    list.push(t);
    talksByModule.set(t.module_id, list);
  }

  let completedTalkCount = 0;

  const moduleProgress: ModuleProgress[] = modules.map(mod => {
    const modTalks = talksByModule.get(mod.id) ?? [];
    const talkProgress: TalkProgress[] = modTalks.map(t => {
      const completed = completedSet.has(t.id);
      if (completed) completedTalkCount++;
      return { talk_id: t.id, talk_name: t.name, completed, completed_at: null };
    });

    // Empty or all-irrelevant module is vacuously complete.
    // See DIP-FP-29-FP-30-FP-43 Grounding Check item 6 for the reasoning.
    const module_completed = talkProgress.length === 0 || talkProgress.every(t => t.completed);
    return { module_id: mod.id, module_name: mod.name, module_completed, talks: talkProgress };
  });

  const course_completed = moduleProgress.length === 0 || moduleProgress.every(m => m.module_completed);

  return {
    member_id: memberId,
    course_id: courseId,
    completed_talk_count: completedTalkCount,
    total_talk_count: relevantTalks.length,
    course_completed,
    modules: moduleProgress,
  };
}

export async function computeAllCoursesProgress(
  memberId: string, tenantId: string
): Promise<CourseProgress[]> {
  const courses = await listCourses(tenantId, false);
  return Promise.all(courses.map(c => computeCourseProgress(memberId, c.id, tenantId)));
}
