/**
 * FP-222 (web, part 1) — Needs Attention / Recently Modified server support: tests
 *
 * Real service code against the LOCAL database (supabase start + db reset):
 *   - Needs Attention rules (owner + Admin only, current refusals, live events only)
 *   - Recently Modified rules (events.version vs the caller's last-viewed version)
 *   - the editor rule (the person who made a change never sees it as modified)
 *   - plumbing: list and detail carry the same flags; query count is constant
 *   - remove_member() deletes view rows; access / cross-tenant rejections
 *
 * Run:  npx tsx scripts/test-fp222-indicator-flags.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { createClient } from '@supabase/supabase-js';
import {
  listEventsForMember, getEventById, updateEvent, recordEventView, recordEventViewForCaller,
} from '../src/features/events/service';
import {
  createTaskAssignment, updateTaskAssignment, deleteTaskAssignment, submitTaskAssignmentResponse,
} from '../src/features/tasks/eventTaskAssignment.service';
import { runTaskAutoAssign } from '../src/features/tasks/autoAssign.service';
import { removeMember } from '../src/features/members/service';
import type { Role } from '../src/lib/auth/middleware';
import { NextRequest } from 'next/server';
import { POST as viewPOST } from '../app/api/events/[id]/view/route';
import { GET as detailGET } from '../app/api/events/[id]/route';
import { GET as mineGET } from '../app/api/events/mine/route';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stamp = Date.now();

let passed = 0, failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? '  -> ' + detail : ''}`); }
}
function must<T>(r: { data: T | null; error: unknown }, what: string): T {
  if (r.error || r.data === null) throw new Error(`${what}: ${JSON.stringify(r.error)}`);
  return r.data;
}
const codeOf = async (fn: () => Promise<unknown>) => { try { await fn(); return 'OK'; } catch (e) { return (e as { code?: string }).code ?? 'ERR'; } };

async function main() {
  // ------------------------------------------------------------------ fixtures
  const T1 = must(await svc.from('tenants').insert({ name: 'FP222-A-' + stamp }).select('id').single(), 'tenant 1').id as string;
  const T2 = must(await svc.from('tenants').insert({ name: 'FP222-B-' + stamp }).select('id').single(), 'tenant 2').id as string;
  const et1 = must(await svc.from('event_types').insert({ tenant_id: T1, name: 'ET', code: 'ET' + (stamp % 1000) }).select('id').single(), 'et1').id as string;
  const et2 = must(await svc.from('event_types').insert({ tenant_id: T2, name: 'ET', code: 'ET' + (stamp % 1000) }).select('id').single(), 'et2').id as string;

  async function mkMember(tenantId: string, first: string, role: Role) {
    const m = must(await svc.from('members').insert({
      tenant_id: tenantId, user_id: crypto.randomUUID(), email: `${first.toLowerCase()}-${stamp}@example.test`, role,
      first_name: first, last_name: 'Tester', gender: 'FEMALE', marital_status: 'SINGLE', birthdate: '1990-04-04',
    }).select('id').single(), 'member ' + first);
    return (m as { id: string }).id;
  }
  const admin = await mkMember(T1, 'Admin', 'ADMIN');
  const admin2 = await mkMember(T1, 'AdminTwo', 'ADMIN');
  const owner = await mkMember(T1, 'Owner', 'LEADER');
  const otherLeader = await mkMember(T1, 'OtherLeader', 'LEADER');
  const plainMember = await mkMember(T1, 'Plain', 'MEMBER');
  const R = await mkMember(T1, 'Refuser', 'MEMBER');
  const R2 = await mkMember(T1, 'RefuserTwo', 'MEMBER');
  const R3 = await mkMember(T1, 'RefuserThree', 'MEMBER');
  const outsider = await mkMember(T1, 'Outsider', 'MEMBER');            // not invited to anything
  const t2Member = await mkMember(T2, 'OtherTenant', 'MEMBER');

  let evCounter = 0;
  async function mkEvent(opts: { tenant?: string; type?: string; owner?: string | null; status?: string; startOffsetDays?: number; attendees?: string[] }) {
    evCounter++;
    const days = opts.startOffsetDays ?? (2 + evCounter);
    const e = must(await svc.from('events').insert({
      tenant_id: opts.tenant ?? T1, event_type_id: opts.type ?? et1, name: `E${evCounter}-${stamp}`,
      start_datetime: new Date(Date.now() + days * 864e5).toISOString(),
      end_datetime: new Date(Date.now() + days * 864e5 + 72e5).toISOString(),
      location_name: 'Hall', location_address: '1 Main St', target: {}, status: opts.status ?? 'SCHEDULED',
      owner_member_id: opts.owner === undefined ? owner : opts.owner,
    }).select('id').single(), 'event');
    const id = (e as { id: string }).id;
    for (const m of opts.attendees ?? []) {
      must(await svc.from('event_attendees').upsert({ tenant_id: opts.tenant ?? T1, event_id: id, member_id: m }, { onConflict: 'event_id,member_id' }).select('event_id'), 'attendee');
    }
    return id;
  }
  const task = must(await svc.from('tasks').insert({ tenant_id: T1, name: 'Task-' + stamp }).select('id').single(), 'task').id as string;
  const task2 = must(await svc.from('tasks').insert({ tenant_id: T1, name: 'Task2-' + stamp }).select('id').single(), 'task2').id as string;

  type Flags = { needs_attention: boolean; is_modified: boolean };
  async function listFlags(caller: string, role: Role, eventId: string): Promise<Flags | undefined> {
    const rows = await listEventsForMember(T1, caller, role) as unknown as { id: string; needs_attention: boolean; is_modified: boolean }[];
    const r = rows.find((x) => x.id === eventId);
    return r ? { needs_attention: r.needs_attention, is_modified: r.is_modified } : undefined;
  }
  async function detailFlags(caller: string, role: Role, eventId: string): Promise<Flags> {
    const d = await getEventById(eventId, T1, caller, role);
    return { needs_attention: d.needs_attention, is_modified: d.is_modified };
  }
  const roles: [string, string, Role][] = [['admin', admin, 'ADMIN'], ['owner', owner, 'LEADER'], ['otherLeader', otherLeader, 'LEADER'], ['plainMember', plainMember, 'MEMBER']];
  const evVersion = async (id: string) => (must(await svc.from('events').select('version').eq('id', id).single(), 'version') as { version: number }).version;
  const viewRow = async (event: string, member: string) => (await svc.from('event_member_views').select('last_seen_version').eq('event_id', event).eq('member_id', member).maybeSingle()).data as { last_seen_version: number } | null;

  // ============================================================= NEEDS ATTENTION
  console.log('\n=== Needs Attention');
  const attendeesNA = [plainMember, otherLeader, R, R2, R3];
  const E1 = await mkEvent({ attendees: attendeesNA });
  const a1 = (await createTaskAssignment(T1, { eventId: E1, taskId: task, assignee: { member_ids: [R] } }, admin)).id;

  console.log(' no refusal yet:');
  for (const [name, id, role] of roles) check(`${name}: false before any refusal`, (await listFlags(id, role, E1))?.needs_attention === false);

  await submitTaskAssignmentResponse(T1, R, a1, 'REFUSED');
  console.log(' R refuses:');
  const expectNA: Record<string, boolean> = { admin: true, owner: true, otherLeader: false, plainMember: false };
  for (const [name, id, role] of roles) {
    const l = await listFlags(id, role, E1); const d = await detailFlags(id, role, E1);
    check(`${name}: needs_attention=${expectNA[name]} (list and detail)`, l?.needs_attention === expectNA[name] && d.needs_attention === expectNA[name], JSON.stringify({ l, d }));
  }
  check('the refuser sees false', (await detailFlags(R, 'MEMBER', E1)).needs_attention === false);
  check('a second Admin sees true too', (await listFlags(admin2, 'ADMIN', E1))?.needs_attention === true);

  console.log(' two refusals, then partial clearing:');
  await updateTaskAssignment(a1, T1, { assignee: { member_ids: [R, R2] } }, admin);
  await submitTaskAssignmentResponse(T1, R2, a1, 'REFUSED');
  check('two refusals: still true', (await detailFlags(owner, 'LEADER', E1)).needs_attention === true);
  await submitTaskAssignmentResponse(T1, R2, a1, 'COMMITTED');
  check('one of two switches to Commit: still true (the other still refuses)', (await detailFlags(owner, 'LEADER', E1)).needs_attention === true);
  await submitTaskAssignmentResponse(T1, R, a1, 'COMMITTED');
  check('the last refuser changes to Commit: false (owner and Admin)', (await detailFlags(owner, 'LEADER', E1)).needs_attention === false && (await detailFlags(admin, 'ADMIN', E1)).needs_attention === false);
  check('history rows (is_current=false) were ignored: both answered Refuse earlier but only current rows count',
    ((await svc.from('event_task_assignment_responses').select('id', { count: 'exact', head: true }).eq('event_id', E1).eq('is_current', false)).count ?? 0) >= 2);

  console.log(' refuser replaced:');
  await submitTaskAssignmentResponse(T1, R, a1, 'REFUSED');
  check('R refuses again: true', (await detailFlags(owner, 'LEADER', E1)).needs_attention === true);
  await updateTaskAssignment(a1, T1, { assignee: { member_ids: [R2] } }, admin);   // R replaced by R2 (who committed)
  check('R replaced (answer cleared): false', (await detailFlags(owner, 'LEADER', E1)).needs_attention === false && (await detailFlags(admin, 'ADMIN', E1)).needs_attention === false);

  console.log(' refuser removed (FP-234 / FP-235 path):');
  await submitTaskAssignmentResponse(T1, R2, a1, 'REFUSED');
  check('R2 refuses: true', (await detailFlags(owner, 'LEADER', E1)).needs_attention === true);
  await removeMember(R2, T1, 'DEACTIVATED');
  check('R2 removed: false', (await detailFlags(owner, 'LEADER', E1)).needs_attention === false && (await detailFlags(admin, 'ADMIN', E1)).needs_attention === false);

  console.log(' event with no owner is Admin-only:');
  const E2 = await mkEvent({ owner: null, attendees: [R3, plainMember, otherLeader] });
  const a2 = (await createTaskAssignment(T1, { eventId: E2, taskId: task, assignee: { member_ids: [R3] } }, admin)).id;
  await submitTaskAssignmentResponse(T1, R3, a2, 'REFUSED');
  check('Admin: true', (await detailFlags(admin, 'ADMIN', E2)).needs_attention === true);
  check('Leader (not owner): false', (await detailFlags(otherLeader, 'LEADER', E2)).needs_attention === false);
  check('Leader who owns other events: false', (await detailFlags(owner, 'LEADER', E2)).needs_attention === false);

  console.log(' cancelled / draft / ended events:');
  const mkDirectRefusal = async (eventId: string, member: string) => {
    const a = must(await svc.from('event_tasks_assignments').insert({ tenant_id: T1, event_id: eventId, task_id: task, assignee: { member_ids: [member] } }).select('id').single(), 'direct assignment') as { id: string };
    must(await svc.from('event_task_assignment_responses').insert({ tenant_id: T1, assignment_id: a.id, event_id: eventId, task_id: task, member_id: member, status: 'REFUSED' }).select('id'), 'direct refusal');
  };
  const E3 = await mkEvent({ attendees: [R3] }); await mkDirectRefusal(E3, R3);
  check('live event with a direct refusal row is true (control)', (await detailFlags(owner, 'LEADER', E3)).needs_attention === true);
  await svc.from('events').update({ status: 'CANCELLED' }).eq('id', E3);
  check('cancelled: false', (await detailFlags(owner, 'LEADER', E3)).needs_attention === false && (await detailFlags(admin, 'ADMIN', E3)).needs_attention === false);
  const E4 = await mkEvent({ status: 'DRAFT', attendees: [] }); await mkDirectRefusal(E4, R3);
  check('draft: false', (await detailFlags(owner, 'LEADER', E4)).needs_attention === false && (await detailFlags(admin, 'ADMIN', E4)).needs_attention === false);
  const E5 = await mkEvent({ startOffsetDays: -30, attendees: [R3] }); await mkDirectRefusal(E5, R3);
  check('ended: false', (await detailFlags(owner, 'LEADER', E5)).needs_attention === false && (await detailFlags(admin, 'ADMIN', E5)).needs_attention === false);

  console.log(' history rows only:');
  const E6 = await mkEvent({ attendees: [R3] });
  const a6 = must(await svc.from('event_tasks_assignments').insert({ tenant_id: T1, event_id: E6, task_id: task, assignee: { member_ids: [R3] } }).select('id').single(), 'a6') as { id: string };
  must(await svc.from('event_task_assignment_responses').insert({ tenant_id: T1, assignment_id: a6.id, event_id: E6, task_id: task, member_id: R3, status: 'REFUSED', is_current: false, cleared_at: new Date().toISOString(), cleared_reason: 'SUPERSEDED' }).select('id'), 'history row');
  check('only a history REFUSED row (is_current=false): false', (await detailFlags(owner, 'LEADER', E6)).needs_attention === false && (await detailFlags(admin, 'ADMIN', E6)).needs_attention === false);

  // ============================================================ RECENTLY MODIFIED
  console.log('\n=== Recently Modified');
  const E7 = await mkEvent({ attendees: [plainMember, otherLeader, R3] });
  check('never opened: false', (await detailFlags(plainMember, 'MEMBER', E7)).is_modified === false && (await listFlags(plainMember, 'MEMBER', E7))?.is_modified === false);
  await updateEvent(E7, T1, { name: 'Renamed once ' + stamp, actorMemberId: owner }, undefined);
  check('never opened, event edited: still false (first-time viewer sees no indicator)', (await detailFlags(plainMember, 'MEMBER', E7)).is_modified === false);

  await recordEventViewForCaller(T1, plainMember, 'MEMBER', E7);
  check('opened at the current version: false', (await detailFlags(plainMember, 'MEMBER', E7)).is_modified === false);
  const v0 = await evVersion(E7);
  await updateEvent(E7, T1, { locationName: 'New hall ' + stamp, actorMemberId: owner }, undefined);
  check('event field edited after the view: version moved up', (await evVersion(E7)) > v0);
  check('open, then edit: TRUE for the viewer (list and detail)', (await detailFlags(plainMember, 'MEMBER', E7)).is_modified === true && (await listFlags(plainMember, 'MEMBER', E7))?.is_modified === true);
  await recordEventViewForCaller(T1, plainMember, 'MEMBER', E7);
  check('open again: false', (await detailFlags(plainMember, 'MEMBER', E7)).is_modified === false);

  const E8 = await mkEvent({ attendees: [plainMember, R3] });
  const a8 = (await createTaskAssignment(T1, { eventId: E8, taskId: task, assignee: { member_ids: [R3] } }, admin)).id;
  await recordEventViewForCaller(T1, plainMember, 'MEMBER', E8);
  check('viewer opened E8: false', (await detailFlags(plainMember, 'MEMBER', E8)).is_modified === false);
  await submitTaskAssignmentResponse(T1, R3, a8, 'REFUSED');
  check('a refusal alone is NOT a modification: false', (await detailFlags(plainMember, 'MEMBER', E8)).is_modified === false);
  await updateTaskAssignment(a8, T1, { assignee: { member_ids: [plainMember] } }, admin);   // task reassignment by the Admin
  check('a task reassignment IS a modification: true for the viewer', (await detailFlags(plainMember, 'MEMBER', E8)).is_modified === true);

  console.log(' the editor never sees their own change:');
  const E9 = await mkEvent({ attendees: [plainMember, R3] });
  await recordEventViewForCaller(T1, owner, 'LEADER', E9);
  await recordEventViewForCaller(T1, admin, 'ADMIN', E9);
  await recordEventViewForCaller(T1, plainMember, 'MEMBER', E9);
  await updateEvent(E9, T1, { name: 'Owner edit ' + stamp, actorMemberId: owner }, undefined);
  check('event edit: the editor (owner) sees false', (await detailFlags(owner, 'LEADER', E9)).is_modified === false && (await listFlags(owner, 'LEADER', E9))?.is_modified === false);
  check('event edit: others who had opened it (Admin, Member) see true', (await detailFlags(admin, 'ADMIN', E9)).is_modified === true && (await detailFlags(plainMember, 'MEMBER', E9)).is_modified === true);
  await recordEventViewForCaller(T1, admin, 'ADMIN', E9); await recordEventViewForCaller(T1, plainMember, 'MEMBER', E9);
  const tA = await createTaskAssignment(T1, { eventId: E9, taskId: task, assignee: { member_ids: [R3] } }, admin);
  check('task create: the editor (Admin) sees false', (await detailFlags(admin, 'ADMIN', E9)).is_modified === false);
  check('task create: the owner (had opened it earlier) sees true', (await detailFlags(owner, 'LEADER', E9)).is_modified === true);
  await recordEventViewForCaller(T1, owner, 'LEADER', E9);
  await updateTaskAssignment(tA.id, T1, { assignee: { member_ids: [plainMember] } }, admin);
  check('task update: the editor sees false', (await detailFlags(admin, 'ADMIN', E9)).is_modified === false);
  check('task update: another viewer sees true', (await detailFlags(owner, 'LEADER', E9)).is_modified === true);
  await recordEventViewForCaller(T1, owner, 'LEADER', E9);
  const vBeforeNoop = await evVersion(E9);
  await updateTaskAssignment(tA.id, T1, { assignee: { member_ids: [plainMember] } }, admin);  // identical -> no bump
  check('identical task update: no version bump and nobody sees a change', (await evVersion(E9)) === vBeforeNoop && (await detailFlags(owner, 'LEADER', E9)).is_modified === false);
  await deleteTaskAssignment(tA.id, T1, admin);
  check('task delete: the editor sees false, another viewer sees true', (await detailFlags(admin, 'ADMIN', E9)).is_modified === false && (await detailFlags(owner, 'LEADER', E9)).is_modified === true);

  // auto-assign: the actor runs it, others who opened the events see "modified"
  const etAuto = must(await svc.from('event_types').insert({ tenant_id: T1, name: 'AutoType', code: 'AU' + (stamp % 1000) }).select('id').single(), 'etAuto').id as string;
  const E10 = await mkEvent({ type: etAuto, attendees: [plainMember, R3] });
  await recordEventViewForCaller(T1, admin, 'ADMIN', E10);
  await recordEventViewForCaller(T1, owner, 'LEADER', E10);
  await runTaskAutoAssign(T1, task2, [{ type: 'member', id: R3 }], admin, [etAuto]);
  check('auto-assign: the actor (Admin) sees false', (await detailFlags(admin, 'ADMIN', E10)).is_modified === false);
  check('auto-assign: the owner (had opened it) sees true', (await detailFlags(owner, 'LEADER', E10)).is_modified === true);

  console.log(' auto-assign records the actor view ONLY for events it really changed:');
  // (1) a run that covers an event someone else edited, and changes nothing on it
  await recordEventViewForCaller(T1, admin, 'ADMIN', E10);                       // the admin has now seen E10 as it is
  await updateEvent(E10, T1, { name: 'Edited by the owner ' + stamp, actorMemberId: owner }, undefined);   // someone else edits it
  const seenE10 = (await viewRow(E10, admin))?.last_seen_version ?? -1;
  check('precondition: the admin\'s last_seen_version is older than the event\'s version, so is_modified is TRUE',
    seenE10 < (await evVersion(E10)) && (await detailFlags(admin, 'ADMIN', E10)).is_modified === true, `seen=${seenE10} current=${await evVersion(E10)}`);
  const vE10Before = await evVersion(E10);
  await runTaskAutoAssign(T1, task2, [{ type: 'member', id: R3 }], admin, [etAuto]);   // same roster as before: E10's slot is already R3
  check('precondition: the run changed nothing on that event (version unchanged)', (await evVersion(E10)) === vE10Before);
  check('(1) a run that covers an event someone else edited and changes nothing on it leaves is_modified TRUE for the admin',
    (await detailFlags(admin, 'ADMIN', E10)).is_modified === true && (await listFlags(admin, 'ADMIN', E10))?.is_modified === true);
  check('(1b) ...and the admin\'s stored last_seen_version was not touched', (await viewRow(E10, admin))?.last_seen_version === seenE10);

  // (2) a run that really changes a slot: the actor sees false, someone who had opened the event sees true
  const E13 = await mkEvent({ type: etAuto, attendees: [plainMember, R3] });
  await recordEventViewForCaller(T1, admin, 'ADMIN', E13);
  await recordEventViewForCaller(T1, owner, 'LEADER', E13);
  const vE13Before = await evVersion(E13);
  await runTaskAutoAssign(T1, task2, [{ type: 'member', id: R3 }], admin, [etAuto]);
  check('precondition: the run really changed a slot on E13 (version increased)', (await evVersion(E13)) > vE13Before);
  check('(2) an event on which the run changed a slot gives is_modified FALSE for the actor', (await detailFlags(admin, 'ADMIN', E13)).is_modified === false && (await listFlags(admin, 'ADMIN', E13))?.is_modified === false);
  check('(2b) ...while the owner, who had opened it, sees TRUE', (await detailFlags(owner, 'LEADER', E13)).is_modified === true);
  check('(2c) ...and E10 (covered by the same run, unchanged) is still TRUE for the admin', (await detailFlags(admin, 'ADMIN', E10)).is_modified === true);

  console.log(' recording rules:');
  const E11 = await mkEvent({ attendees: [plainMember] });
  await updateEvent(E11, T1, { name: 'bump ' + stamp, actorMemberId: owner }, undefined);
  await updateEvent(E11, T1, { name: 'bump2 ' + stamp, actorMemberId: owner }, undefined);
  const cur = await evVersion(E11);
  await recordEventView(T1, plainMember, E11, cur);
  check('stored version equals the posted version', (await viewRow(E11, plainMember))?.last_seen_version === cur);
  await recordEventView(T1, plainMember, E11, 1);
  check('a lower version posted later never lowers the stored one', (await viewRow(E11, plainMember))?.last_seen_version === cur);
  await recordEventView(T1, otherLeader, E11, cur + 50);
  check('a version above the current one is clamped to the current version', (await viewRow(E11, otherLeader))?.last_seen_version === cur);
  check('and a clamped viewer is not "modified"', (await detailFlags(otherLeader, 'LEADER', E11)).is_modified === false);
  check('invalid version -> VALIDATION_ERROR', (await codeOf(() => recordEventView(T1, plainMember, E11, -3))) === 'VALIDATION_ERROR' && (await codeOf(() => recordEventView(T1, plainMember, E11, 1.5))) === 'VALIDATION_ERROR');
  check('calling it repeatedly is safe (still one row)', await (async () => { await recordEventViewForCaller(T1, plainMember, 'MEMBER', E11); await recordEventViewForCaller(T1, plainMember, 'MEMBER', E11); return ((await svc.from('event_member_views').select('event_id', { count: 'exact', head: true }).eq('event_id', E11).eq('member_id', plainMember)).count ?? 0) === 1; })());

  console.log(' access:');
  check('a caller without access (Member not invited) is rejected: FORBIDDEN_SCOPE', (await codeOf(() => recordEventViewForCaller(T1, outsider, 'MEMBER', E11))) === 'FORBIDDEN_SCOPE');
  check('a Leader who neither owns nor is invited is rejected: FORBIDDEN_SCOPE', (await codeOf(() => recordEventViewForCaller(T1, otherLeader, 'LEADER', E9))) === 'FORBIDDEN_SCOPE');
  check('an Admin may view any event of the tenant', (await codeOf(() => recordEventViewForCaller(T1, admin2, 'ADMIN', E11))) === 'OK');
  check('an unknown event: NOT_FOUND', (await codeOf(() => recordEventViewForCaller(T1, admin, 'ADMIN', crypto.randomUUID()))) === 'NOT_FOUND');
  const T2event = await mkEvent({ tenant: T2, type: et2, owner: t2Member, attendees: [t2Member] });
  check('a cross-tenant event is rejected (NOT_FOUND), even for an Admin', (await codeOf(() => recordEventViewForCaller(T1, admin, 'ADMIN', T2event))) === 'NOT_FOUND');
  check('...and recordEventView itself is tenant-scoped too', (await codeOf(() => recordEventView(T1, admin, T2event))) === 'NOT_FOUND');
  check('no view row was written for the cross-tenant event', (await viewRow(T2event, admin)) === null);
  const bad = await svc.from('event_member_views').insert({ tenant_id: T1, event_id: T2event, member_id: admin, last_seen_version: 1 });
  check('table trigger: a row mixing tenants is rejected', !!bad.error, bad.error?.message?.slice(0, 80) ?? 'no error');

  // ============================================================== PLUMBING
  console.log('\n=== Plumbing');
  for (const [name, id, role] of roles) {
    const list = await listEventsForMember(T1, id, role) as unknown as { id: string; needs_attention: boolean; is_modified: boolean }[];
    let same = true, n = 0;
    for (const row of list.slice(0, 12)) {
      const d = await detailFlags(id, role, row.id); n++;
      if (d.needs_attention !== row.needs_attention || d.is_modified !== row.is_modified) same = false;
    }
    check(`${name}: list and detail carry the same flags (${n} events compared)`, same && n > 0);
  }
  check('the list payload has the flags and no internals leaking (no version / owner_member_id)',
    await (async () => { const r = (await listEventsForMember(T1, admin, 'ADMIN'))[0] as unknown as Record<string, unknown>; return 'needs_attention' in r && 'is_modified' in r && !('version' in r) && !('owner_member_id' in r); })());

  // query count per list request must not grow with the number of events
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => { if (String(input instanceof Request ? input.url : input).startsWith(URL_)) calls++; return origFetch(input, init); }) as typeof fetch;
  const countCalls = async (role: Role, id: string) => { calls = 0; const rows = await listEventsForMember(T1, id, role); return { calls, n: rows.length }; };
  const small = await countCalls('ADMIN', admin);
  for (let i = 0; i < 25; i++) await mkEvent({ attendees: [plainMember] });
  calls = 0;
  const large = await countCalls('ADMIN', admin);
  const smallM = await countCalls('MEMBER', plainMember);
  globalThis.fetch = origFetch;
  console.log(`  (Admin list: ${small.n} events -> ${small.calls} requests; ${large.n} events -> ${large.calls} requests; Member list: ${smallM.n} events -> ${smallM.calls} requests)`);
  check('database requests per list call do not grow with the number of events', large.n > small.n + 20 && large.calls === small.calls, JSON.stringify({ small, large }));


  // ============================================================== ROUTES
  // The real route handlers, called with real Auth JWTs (withAuth verifies the token).
  console.log('\n=== Routes (real handlers, real JWTs)');
  const anonClient = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  async function loginAs(first: string, role: Role, tenantId = T1) {
    const email = `${first.toLowerCase()}-route-${stamp}@example.test`;
    const u = await svc.auth.admin.createUser({ email, password: 'Pw-12345-abcde', email_confirm: true, app_metadata: { tenant_id: tenantId, role } });
    if (u.error) throw u.error;
    const m = must(await svc.from('members').insert({
      tenant_id: tenantId, user_id: u.data.user!.id, email, role, first_name: first, last_name: 'Route', gender: 'FEMALE', marital_status: 'SINGLE', birthdate: '1990-04-04',
    }).select('id').single(), 'route member') as { id: string };
    await svc.auth.admin.updateUserById(u.data.user!.id, { app_metadata: { tenant_id: tenantId, role, member_id: m.id } });
    const { data: sess, error } = await anonClient.auth.signInWithPassword({ email, password: 'Pw-12345-abcde' });
    if (error || !sess.session) throw error ?? new Error('no session');
    return { id: m.id, token: sess.session.access_token };
  }
  const rMember = await loginAs('RouteMember', 'MEMBER');
  const rAdmin = await loginAs('RouteAdmin', 'ADMIN');
  const RE = await mkEvent({ attendees: [rMember.id] });
  const RE2 = await mkEvent({ attendees: [] });               // rMember is NOT invited to this one
  const req = (method: string, url: string, token?: string, body?: string) =>
    new NextRequest(new URL(url, 'http://localhost'), { method, headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {}, body });
  const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

  const noAuth = await viewPOST(req('POST', `/api/events/${RE}/view`), ctxFor(RE));
  check('POST /view without a token: 401', noAuth.status === 401, String(noAuth.status));
  const ok1 = await viewPOST(req('POST', `/api/events/${RE}/view`, rMember.token), ctxFor(RE));
  check('POST /view, no body: 204 with an empty body', ok1.status === 204 && (await ok1.text()) === '', String(ok1.status));
  check('...and the view row was written at the current version', (await viewRow(RE, rMember.id))?.last_seen_version === (await evVersion(RE)));
  const ok2 = await viewPOST(req('POST', `/api/events/${RE}/view`, rMember.token, JSON.stringify({ version: 99999 })), ctxFor(RE));
  check('POST /view with a version above the current one: 204, clamped', ok2.status === 204 && (await viewRow(RE, rMember.id))?.last_seen_version === (await evVersion(RE)));
  const again = await viewPOST(req('POST', `/api/events/${RE}/view`, rMember.token, JSON.stringify({ version: 1 })), ctxFor(RE));
  check('POST /view repeated with a lower version: 204, stored version not lowered', again.status === 204 && (await viewRow(RE, rMember.id))?.last_seen_version === (await evVersion(RE)));
  const badBody = await viewPOST(req('POST', `/api/events/${RE}/view`, rMember.token, JSON.stringify({ version: 'two' })), ctxFor(RE));
  check('POST /view with a non-numeric version: 422', badBody.status === 422, String(badBody.status));
  const notJson = await viewPOST(req('POST', `/api/events/${RE}/view`, rMember.token, 'not json'), ctxFor(RE));
  check('POST /view with a body that is not JSON: 400', notJson.status === 400, String(notJson.status));
  const noAccess = await viewPOST(req('POST', `/api/events/${RE2}/view`, rMember.token), ctxFor(RE2));
  check('POST /view for an event the Member cannot see: 403 FORBIDDEN_SCOPE', noAccess.status === 403 && (await noAccess.json()).error?.code === 'FORBIDDEN_SCOPE');
  const missing = await viewPOST(req('POST', `/api/events/${crypto.randomUUID()}/view`, rAdmin.token), ctxFor('x'));
  const missingId = crypto.randomUUID();
  const missing2 = await viewPOST(req('POST', `/api/events/${missingId}/view`, rAdmin.token), ctxFor(missingId));
  check('POST /view for an unknown event: 404 NOT_FOUND', missing2.status === 404 && (await missing2.json()).error?.code === 'NOT_FOUND');
  void missing;
  const xt = await viewPOST(req('POST', `/api/events/${T2event}/view`, rAdmin.token), ctxFor(T2event));
  check("POST /view for another tenant's event, as an Admin: 404", xt.status === 404, String(xt.status));
  const adminAny = await viewPOST(req('POST', `/api/events/${RE2}/view`, rAdmin.token), ctxFor(RE2));
  check('POST /view as an Admin on any event of the tenant: 204', adminAny.status === 204);

  // detail + list carry the flags through the real handlers
  await updateEvent(RE, T1, { name: 'Edited by owner ' + stamp, actorMemberId: owner }, undefined);
  const det = await detailGET(req('GET', `/api/events/${RE}`, rMember.token), ctxFor(RE));
  const detBody = (await det.json()).data;
  check('GET /api/events/:id returns is_modified=true and needs_attention=false for the Member after an edit', det.status === 200 && detBody.is_modified === true && detBody.needs_attention === false, JSON.stringify({ s: det.status, m: detBody?.is_modified, n: detBody?.needs_attention }));
  const mine = await mineGET(req('GET', '/api/events/mine', rMember.token), { params: Promise.resolve({}) } as never);
  const mineRow = ((await mine.json()).data as { id: string; is_modified: boolean; needs_attention: boolean }[]).find((e) => e.id === RE);
  check('GET /api/events/mine carries the same flags', mine.status === 200 && mineRow?.is_modified === true && mineRow?.needs_attention === false);
  const reopen = await viewPOST(req('POST', `/api/events/${RE}/view`, rMember.token), ctxFor(RE));
  const det2 = (await (await detailGET(req('GET', `/api/events/${RE}`, rMember.token), ctxFor(RE))).json()).data;
  check('after POST /view the detail shows is_modified=false', reopen.status === 204 && det2.is_modified === false);

  // ============================================================== REMOVAL
  console.log('\n=== Removal');
  await recordEventViewForCaller(T1, R3, 'MEMBER', E7);
  await recordEventViewForCaller(T1, R3, 'MEMBER', E8);
  const before = (await svc.from('event_member_views').select('event_id', { count: 'exact', head: true }).eq('member_id', R3)).count ?? 0;
  check('R3 has view rows before removal', before >= 2, String(before));
  await removeMember(R3, T1, 'DEACTIVATED');
  check('remove_member() deleted the removed member\'s view rows', ((await svc.from('event_member_views').select('event_id', { count: 'exact', head: true }).eq('member_id', R3)).count ?? 0) === 0);
  await recordEventView(T1, R3, E7);   // a late best-effort call for a removed member must not recreate a row
  check('a late view for a removed member writes nothing', ((await svc.from('event_member_views').select('event_id', { count: 'exact', head: true }).eq('member_id', R3)).count ?? 0) === 0);
  check('view rows of other members were untouched', (await viewRow(E7, plainMember)) !== null);
  const rm2 = await svc.rpc('remove_member', { p_tenant_id: T1, p_member_id: R3, p_reason: 'DEACTIVATED' });
  check('remove_member() twice: no error, still no rows', !rm2.error);

  const privs = await svc.from('event_member_views').select('event_id').limit(1);
  check('service role can read the table (control)', !privs.error);
  const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const anonRead = await anon.from('event_member_views').select('event_id').limit(1);
  check('anon cannot read event_member_views (FP-228: API-only)', !!anonRead.error);
  const anonRpc = await anon.rpc('record_event_view', { p_tenant_id: T1, p_event_id: E7, p_member_id: admin, p_version: 1 });
  check('anon cannot call record_event_view', !!anonRpc.error);

  console.log(`\n${passed}/${passed + failed} checks passed${failed ? '  (' + failed + ' FAILED)' : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST SCRIPT ERROR', e); process.exit(1); });
