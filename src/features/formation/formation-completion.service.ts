import {
  fetchActiveModulesForCourse,
  fetchActiveTalksForModules,
  fetchEventsForTalks,
  fetchAttendedRows,
} from './formation-completion.repository';
import { listCourses } from './course.repository';

export interface TalkProgress {
  talk_id: string;
  completed: boolean;
  attendance_recorded_at: string | null;
}

export interface ModuleProgress {
  module_id: string;
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

export async function computeCourseProgress(
  memberId: string, courseId: string, tenantId: string
): Promise<CourseProgress> {
  const modules = await fetchActiveModulesForCourse(courseId, tenantId);
  const moduleIds = modules.map(m => m.id);

  const talks = await fetchActiveTalksForModules(moduleIds, tenantId);
  const talkIds = talks.map(t => t.id);

  const events = await fetchEventsForTalks(talkIds, tenantId);
  const eventIds = events.map(e => e.id);

  // INVARIANT (Rule 4): only attendance_status = 'ATTENDED' counts. No rsvps or self-reports.
  const attended = await fetchAttendedRows(memberId, eventIds, tenantId);

  // Map event_id → confirmed_at for ATTENDED rows.
  const attendedMap = new Map<string, string>(
    attended.map(a => [a.event_id, a.confirmed_at])
  );

  // Map talk_id → list of event_ids that link to it.
  const talkEventMap = new Map<string, string[]>();
  for (const ev of events) {
    const list = talkEventMap.get(ev.talk_id) ?? [];
    list.push(ev.id);
    talkEventMap.set(ev.talk_id, list);
  }

  // Group talks by module.
  const talksByModule = new Map<string, typeof talks>();
  for (const t of talks) {
    const list = talksByModule.get(t.module_id) ?? [];
    list.push(t);
    talksByModule.set(t.module_id, list);
  }

  let completedTalkCount = 0;

  const moduleProgress: ModuleProgress[] = modules.map(mod => {
    const modTalks = talksByModule.get(mod.id) ?? [];
    const talkProgress: TalkProgress[] = modTalks.map(t => {
      const linkedEvents = talkEventMap.get(t.id) ?? [];
      let attendedAt: string | null = null;
      for (const eid of linkedEvents) {
        const ts = attendedMap.get(eid);
        if (ts) { attendedAt = ts; break; }
      }
      const completed = attendedAt !== null;
      if (completed) completedTalkCount++;
      return { talk_id: t.id, completed, attendance_recorded_at: attendedAt };
    });

    // Empty module is vacuously complete (all-of-empty-set is true).
    // See DIP-FP-29-FP-30-FP-43 Grounding Check item 6 for the reasoning.
    const module_completed = talkProgress.length === 0 || talkProgress.every(t => t.completed);
    return { module_id: mod.id, module_completed, talks: talkProgress };
  });

  const course_completed = moduleProgress.length === 0 || moduleProgress.every(m => m.module_completed);

  return {
    member_id: memberId,
    course_id: courseId,
    completed_talk_count: completedTalkCount,
    total_talk_count: talks.length,
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
