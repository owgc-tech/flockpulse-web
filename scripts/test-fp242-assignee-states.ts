/**
 * FP-242 (web) — assignee states on the task list API: tests
 *
 * Pure helpers, the list_event_task_assignee_states SQL function, the service and the real
 * route handler (real Auth JWTs) against the LOCAL database (supabase start + db reset).
 *
 * Run:  npx tsx scripts/test-fp242-assignee-states.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import {
  createTaskAssignment, updateTaskAssignment, submitTaskAssignmentResponse, listTaskAssignmentsForEventWithRefusals,
} from '../src/features/tasks/eventTaskAssignment.service';
import { resolveAssigneeMemberIds } from '../src/features/tasks/eventTaskAssignment.repository';
import { orderAssigneeStates, capAssigneeStates, refusedByFromStates, ASSIGNEE_PILL_CAP } from '../src/features/tasks/assigneeStates';
import type { AssigneeStateEntry, EventTaskAssignmentWithRefusals } from '../src/features/tasks/eventTaskAssignment.types';
import { removeMember } from '../src/features/members/service';
import type { Role } from '../src/lib/auth/middleware';
import { GET as assignmentsGET } from '../app/api/event-tasks-assignments/route';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stamp = Date.now();
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

let passed = 0, failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? '  -> ' + detail : ''}`); }
}
function must<T>(r: { data: T | null; error: unknown }, what: string): T {
  if (r.error || r.data === null) throw new Error(`${what}: ${JSON.stringify(r.error)}`);
  return r.data;
}

const entry = (name: string, state: AssigneeStateEntry['state'], via: string | null = null, id = name): AssigneeStateEntry =>
  ({ member_id: id, name, state, via_group_id: via });

async function main() {
  // ============================================================ PURE helpers
  console.log('\n=== Pure helpers');
  const G1 = 'g1', G2 = 'g2';
  const mixed = [
    entry('Zed', 'COMMITTED', G2), entry('Amy', 'PENDING', G1), entry('Bob', 'REFUSED', G1), entry('Cal', 'COMMITTED', null),
    entry('Dee', 'REFUSED', null), entry('Eve', 'PENDING', null), entry('Fay', 'COMMITTED', G1), entry('Gus', 'REFUSED', G2),
  ];
  const ordered = orderAssigneeStates(mixed, { group_ids: [G2, G1] });
  check('sections: direct first, then groups in assignee.group_ids order (G2 before G1)',
    eq(ordered.map((e) => e.via_group_id), [null, null, null, G2, G2, G1, G1, G1]), JSON.stringify(ordered.map((e) => e.via_group_id)));
  check('within a section: REFUSED, then PENDING, then COMMITTED',
    eq(ordered.slice(0, 3).map((e) => e.state), ['REFUSED', 'PENDING', 'COMMITTED']) && eq(ordered.slice(3, 5).map((e) => e.state), ['REFUSED', 'COMMITTED']) && eq(ordered.slice(5).map((e) => e.state), ['REFUSED', 'PENDING', 'COMMITTED']));
  const byName = orderAssigneeStates([entry('Mia', 'PENDING'), entry('Abe', 'PENDING'), entry('Zoe', 'PENDING')], null);
  check('then by name', eq(byName.map((e) => e.name), ['Abe', 'Mia', 'Zoe']));
  const tie = orderAssigneeStates([entry('Same', 'PENDING', null, 'b'), entry('Same', 'PENDING', null, 'a')], null);
  check('then member_id as the tie-break', eq(tie.map((e) => e.member_id), ['a', 'b']));
  const inputCopy = [entry('B', 'PENDING'), entry('A', 'PENDING')];
  const before = JSON.stringify(inputCopy);
  orderAssigneeStates(inputCopy, null);
  check('the input array is not mutated (a new array is returned)', JSON.stringify(inputCopy) === before);
  check('an empty assignee list and a null assignee both work', eq(orderAssigneeStates([], null), []) && eq(orderAssigneeStates([], { group_ids: ['x'] }), []));
  check('a group not listed in assignee.group_ids sorts after the listed ones (never throws)',
    eq(orderAssigneeStates([entry('Q', 'PENDING', 'unlisted'), entry('P', 'PENDING', G1)], { group_ids: [G1] }).map((e) => e.name), ['P', 'Q']));

  const big: AssigneeStateEntry[] = Array.from({ length: 150 }, (_, i) =>
    entry(`P${String(i).padStart(3, '0')}`, i >= 140 ? 'REFUSED' : i % 2 ? 'COMMITTED' : 'PENDING', G1, `id${i}`));
  const bigOrdered = orderAssigneeStates(big, { group_ids: [G1] });
  const capped = capAssigneeStates(bigOrdered);
  check(`a 150-member set: ${ASSIGNEE_PILL_CAP} shown, total 150`, capped.shown.length === 100 && capped.total === 150 && ASSIGNEE_PILL_CAP === 100);
  check('refused people sort first, so none of the 10 refusals falls behind the cap', capped.shown.slice(0, 10).every((e) => e.state === 'REFUSED'));
  const lateRefusal = orderAssigneeStates(
    [...Array.from({ length: 100 }, (_, i) => entry(`D${String(i).padStart(3, '0')}`, 'PENDING', null, `d${i}`)), entry('Zoe Late', 'REFUSED', G1, 'late')], { group_ids: [G1] });
  const lateCapped = capAssigneeStates(lateRefusal);
  check('a refusal in a LATER section can fall beyond the cap on screen...', !lateCapped.shown.some((e) => e.member_id === 'late') && lateCapped.total === 101);
  check('...but refused_by is computed from the UNCAPPED list, so the refusal is still reported', eq(refusedByFromStates(lateRefusal), [{ member_id: 'late', name: 'Zoe Late' }]));
  check('capAssigneeStates honours a smaller cap and leaves a short list whole', capAssigneeStates(bigOrdered, 5).shown.length === 5 && capAssigneeStates([entry('x', 'PENDING')]).shown.length === 1);
  check('refusedByFromStates: only REFUSED, sorted by name, shape { member_id, name }',
    eq(refusedByFromStates([entry('Zed', 'REFUSED'), entry('Amy', 'REFUSED'), entry('Mid', 'COMMITTED'), entry('Pen', 'PENDING')]), [{ member_id: 'Amy', name: 'Amy' }, { member_id: 'Zed', name: 'Zed' }]));

  // ============================================================ DB fixtures
  const T1 = must(await svc.from('tenants').insert({ name: 'FP242-A-' + stamp }).select('id').single(), 't1').id as string;
  const T2 = must(await svc.from('tenants').insert({ name: 'FP242-B-' + stamp }).select('id').single(), 't2').id as string;
  const et1 = must(await svc.from('event_types').insert({ tenant_id: T1, name: 'ET', code: 'A' + (stamp % 1000) }).select('id').single(), 'et1').id as string;
  const et2 = must(await svc.from('event_types').insert({ tenant_id: T2, name: 'ET', code: 'B' + (stamp % 1000) }).select('id').single(), 'et2').id as string;
  const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  async function mkMember(tenantId: string, first: string, role: Role, withLogin = false, last = 'Tester') {
    let userId: string = crypto.randomUUID();
    const email = `${first.toLowerCase()}-${stamp}-${Math.random().toString(36).slice(2, 6)}@example.test`;
    if (withLogin) {
      const u = await svc.auth.admin.createUser({ email, password: 'Pw-12345-abcde', email_confirm: true, app_metadata: { tenant_id: tenantId, role } });
      if (u.error) throw u.error;
      userId = u.data.user!.id;
    }
    const m = must(await svc.from('members').insert({
      tenant_id: tenantId, user_id: userId, email, role, first_name: first, last_name: last,
      gender: 'FEMALE', marital_status: 'SINGLE', birthdate: '1990-04-04',
    }).select('id').single(), 'member ' + first) as { id: string };
    if (withLogin) await svc.auth.admin.updateUserById(userId, { app_metadata: { tenant_id: tenantId, role, member_id: m.id } });
    return { id: m.id, email };
  }
  async function loginAs(first: string, role: Role, tenantId = T1) {
    const m = await mkMember(tenantId, first, role, true);
    const { data: sess, error } = await anon.auth.signInWithPassword({ email: m.email, password: 'Pw-12345-abcde' });
    if (error || !sess.session) throw error ?? new Error('no session');
    return { id: m.id, token: sess.session.access_token };
  }
  async function mkEvent(owner: string | null, tenant = T1, type = et1) {
    return (must(await svc.from('events').insert({
      tenant_id: tenant, event_type_id: type, name: `Ev-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
      start_datetime: new Date(Date.now() + 5 * 864e5).toISOString(), end_datetime: new Date(Date.now() + 5 * 864e5 + 72e5).toISOString(),
      location_name: 'Hall', location_address: '1 Main St', target: {}, status: 'SCHEDULED', owner_member_id: owner, guests_allowed: false,
    }).select('id').single(), 'event') as { id: string }).id;
  }
  const task = async (name: string, tenant = T1) => must(await svc.from('tasks').insert({ tenant_id: tenant, name: `${name}-${stamp}` }).select('id').single(), 'task').id as string;
  const mkGroup = async (name: string, members: string[], tenant = T1) => {
    const g = must(await svc.from('groups').insert({ tenant_id: tenant, name: `${name}-${stamp}` }).select('id').single(), 'group').id as string;
    for (const m of members) must(await svc.from('assignments').insert({ tenant_id: tenant, member_id: m, assignment_type: 'GROUP', group_id: g }).select('id'), 'group member');
    return g;
  };

  const adminL = await loginAs('Admin', 'ADMIN');
  const ownerL = await loginAs('Owner', 'LEADER');
  const otherLeaderL = await loginAs('OtherLeader', 'LEADER');
  const memberL = await loginAs('PlainMember', 'MEMBER');
  const refuserL = await loginAs('Refuser', 'MEMBER');
  const t2admin = await loginAs('T2Admin', 'ADMIN', T2);
  const ann = (await mkMember(T1, 'Ann', 'MEMBER', false, 'Alpha')).id;
  const ben = (await mkMember(T1, 'Ben', 'MEMBER', false, 'Bravo')).id;
  const cat = (await mkMember(T1, 'Cat', 'MEMBER', false, 'Charlie')).id;
  const dan = (await mkMember(T1, 'Dan', 'MEMBER', false, 'Delta')).id;
  const eli = (await mkMember(T1, 'Eli', 'MEMBER', false, 'Echo')).id;
  const fox = (await mkMember(T1, 'Fox', 'MEMBER', false, 'Foxtrot')).id;

  const states = async (eventId: string, caller = { memberId: adminL.id, role: 'ADMIN' as Role }) => listTaskAssignmentsForEventWithRefusals(eventId, T1, caller);
  const rowOf = (rows: EventTaskAssignmentWithRefusals[], id: string) => rows.find((r) => r.id === id)!;
  const stateOf = (row: EventTaskAssignmentWithRefusals, memberId: string) => row.assignee_states.find((s) => s.member_id === memberId)?.state;

  // ============================================================ SQL + service
  console.log('\n=== The SQL function and the service');
  const ev = await mkEvent(ownerL.id);
  const tA = await task('A'), tB = await task('B'), tC = await task('C'), tD = await task('D');
  const gOne = await mkGroup('G-One', [ann, ben, cat]);
  const gTwo = await mkGroup('G-Two', [cat, dan]);
  const aDirect = (await createTaskAssignment(T1, { eventId: ev, taskId: tA, assignee: { member_ids: [fox, eli] } }, adminL.id)).id;
  const aGroup = (await createTaskAssignment(T1, { eventId: ev, taskId: tB, assignee: { group_ids: [gOne] } }, adminL.id)).id;
  const aBoth = (await createTaskAssignment(T1, { eventId: ev, taskId: tC, assignee: { member_ids: [ann], group_ids: [gOne] } }, adminL.id)).id;
  const aTwoGroups = (await createTaskAssignment(T1, { eventId: ev, taskId: tD, assignee: { group_ids: [gTwo, gOne] } }, adminL.id)).id;

  let rows = await states(ev);
  const dRow = rowOf(rows, aDirect);
  check('direct members: one pill each, via_group_id null, all PENDING, in name order (Echo, Foxtrot)',
    eq(dRow.assignee_states.map((s) => [s.name, s.state, s.via_group_id]), [['Eli Echo', 'PENDING', null], ['Fox Foxtrot', 'PENDING', null]]) && dRow.assignee_states_total === 2, JSON.stringify(dRow.assignee_states));
  const gRow = rowOf(rows, aGroup);
  check('a group task: one pill per CURRENT group member, each tagged with the group id', eq(gRow.assignee_states.map((s) => s.name), ['Ann Alpha', 'Ben Bravo', 'Cat Charlie']) && gRow.assignee_states.every((s) => s.via_group_id === gOne) && gRow.assignee_states_total === 3);
  const bRow = rowOf(rows, aBoth);
  check('direct AND group: a person reached both ways appears once, as direct (via_group_id null)',
    bRow.assignee_states.length === 3 && bRow.assignee_states.find((s) => s.member_id === ann)?.via_group_id === null && bRow.assignee_states.find((s) => s.member_id === ben)?.via_group_id === gOne && bRow.assignee_states[0].member_id === ann);
  const tRow = rowOf(rows, aTwoGroups);
  check('one person in two groups appears ONCE, under the first group listed (Cat -> G-Two)',
    tRow.assignee_states.filter((s) => s.member_id === cat).length === 1 && tRow.assignee_states.find((s) => s.member_id === cat)?.via_group_id === gTwo && tRow.assignee_states_total === 4, JSON.stringify(tRow.assignee_states));
  check('...and G-Two members come before G-One members (assignee.group_ids order)', eq(tRow.assignee_states.map((s) => s.via_group_id), [gTwo, gTwo, gOne, gOne]));

  console.log(' responses follow the person:');
  await submitTaskAssignmentResponse(T1, ann, aGroup, 'COMMITTED');
  await submitTaskAssignmentResponse(T1, ben, aGroup, 'REFUSED');
  rows = await states(ev);
  check('Commit -> COMMITTED, Refuse -> REFUSED, no answer -> PENDING', stateOf(rowOf(rows, aGroup), ann) === 'COMMITTED' && stateOf(rowOf(rows, aGroup), ben) === 'REFUSED' && stateOf(rowOf(rows, aGroup), cat) === 'PENDING');
  check('REFUSED sorts first within the group section', rowOf(rows, aGroup).assignee_states[0].member_id === ben);
  check('refused_by (kept for older phones) has the same shape and lists exactly the refuser', eq(rowOf(rows, aGroup).refused_by, [{ member_id: ben, name: 'Ben Bravo' }]) && eq(rowOf(rows, aDirect).refused_by, []));
  await submitTaskAssignmentResponse(T1, ben, aGroup, 'COMMITTED');
  rows = await states(ev);
  check('Refuse -> Commit: the pill follows after a reload; refused_by empties', stateOf(rowOf(rows, aGroup), ben) === 'COMMITTED' && eq(rowOf(rows, aGroup).refused_by, []));
  await submitTaskAssignmentResponse(T1, ben, aGroup, 'REFUSED');
  rows = await states(ev);
  check('Commit -> Refuse again follows too', stateOf(rowOf(rows, aGroup), ben) === 'REFUSED');

  console.log(' replacing, removing, leaving:');
  await updateTaskAssignment(aDirect, T1, { assignee: { member_ids: [fox, dan] } }, adminL.id);   // Eli replaced by Dan
  rows = await states(ev);
  check('replacing a person: the old pill disappears, the new person is PENDING', stateOf(rowOf(rows, aDirect), eli) === undefined && stateOf(rowOf(rows, aDirect), dan) === 'PENDING' && rowOf(rows, aDirect).assignee_states_total === 2);
  await submitTaskAssignmentResponse(T1, fox, aDirect, 'REFUSED');
  await updateTaskAssignment(aDirect, T1, { assignee: { member_ids: [dan] } }, adminL.id);        // Fox leaves; the refusal is cleared
  await updateTaskAssignment(aDirect, T1, { assignee: { member_ids: [fox, dan] } }, adminL.id);   // Fox back: no current answer
  rows = await states(ev);
  check('a cleared refusal (person removed, then re-added) shows PENDING, not REFUSED', stateOf(rowOf(rows, aDirect), fox) === 'PENDING' && eq(rowOf(rows, aDirect).refused_by, []));
  must(await svc.from('assignments').update({ deleted_at: new Date().toISOString() }).eq('tenant_id', T1).eq('group_id', gOne).eq('member_id', cat).select('id'), 'leave group');
  rows = await states(ev);
  check('a member removed from a group (assignments.deleted_at) disappears from that group pill list', stateOf(rowOf(rows, aGroup), cat) === undefined && rowOf(rows, aGroup).assignee_states_total === 2);
  check('...but is still shown under the other group that still has them (Cat in G-Two)', rowOf(rows, aTwoGroups).assignee_states.find((s) => s.member_id === cat)?.via_group_id === gTwo);
  await removeMember(ben, T1, 'DEACTIVATED');
  rows = await states(ev);
  check('a removed member (removeMember) disappears from every task', rows.every((r) => !r.assignee_states.some((s) => s.member_id === ben)));
  const stillThere = must(await svc.from('members').select('deleted_at').eq('id', ben).single(), 'ben');
  check('...and is genuinely removed (deleted_at set)', stillThere.deleted_at !== null);
  // a removed member whose id is still listed directly must not show either
  must(await svc.from('members').update({ deleted_at: new Date().toISOString() }).eq('id', fox).select('id'), 'soft delete fox');
  rows = await states(ev);
  check('a member with deleted_at set but still listed directly in member_ids is excluded', stateOf(rowOf(rows, aDirect), fox) === undefined);
  must(await svc.from('members').update({ deleted_at: null }).eq('id', fox).select('id'), 'restore fox');

  console.log(' tenants:');
  const t2ev = await mkEvent(t2admin.id, T2, et2);
  const raw = async (tenant: string, eventId: string) => (await svc.rpc('list_event_task_assignee_states', { p_tenant_id: tenant, p_event_id: eventId })).data as unknown[];
  check("another tenant's event id with the caller's tenant returns []", eq(await raw(T1, t2ev), []));
  check('an unknown event returns []', eq(await raw(T1, crypto.randomUUID()), []));
  check('the other tenant asking for this event returns []', eq(await raw(T2, ev), []));
  const foreign = (await mkMember(T2, 'Foreign', 'MEMBER')).id;
  const fIds = await mkEvent(ownerL.id);
  const tF = await task('Foreign-ID');
  // the cross-tenant trigger blocks storing a foreign id through the service, so plant it with a raw insert attempt
  const tryRaw = await svc.from('event_tasks_assignments').insert({ tenant_id: T1, event_id: fIds, task_id: tF, assignee: { member_ids: [foreign, ann] } }).select('id').single();
  if (tryRaw.error) {
    check('a foreign-tenant member id cannot even be stored in an assignee (the existing validator rejects it)', true);
  } else {
    const fr = (await states(fIds)).find((r) => r.id === (tryRaw.data as { id: string }).id)!;
    check('a foreign-tenant member id in member_ids is excluded; the real member still shows', fr.assignee_states.length === 1 && fr.assignee_states[0].member_id === ann);
  }

  console.log(' equivalence with resolve_assignee_member_ids (minus removed members):');
  rows = await states(ev);
  let disagreements = 0, compared = 0;
  for (const r of rows) {
    const resolved = new Set(await resolveAssigneeMemberIds(T1, r.assignee));
    const removed = new Set(((await svc.from('members').select('id').in('id', [...resolved]).not('deleted_at', 'is', null)).data ?? []).map((m: { id: string }) => m.id));
    const expected = [...resolved].filter((id) => !removed.has(id)).sort();
    const got = r.assignee_states.map((s) => s.member_id).sort();
    compared++;
    if (!eq(expected, got)) disagreements++;
  }
  check(`for all ${compared} assignments the set of member ids equals resolve_assignee_member_ids minus removed members (0 extra, 0 missing)`, compared >= 4 && disagreements === 0, `disagreements=${disagreements}`);

  console.log(' a big group:');
  const crowd: string[] = [];
  for (let i = 0; i < 150; i += 25) {
    const batch = await Promise.all(Array.from({ length: 25 }, (_, k) => mkMember(T1, `Crowd${i + k}`, 'MEMBER', false, `Z${String(i + k).padStart(3, '0')}`)));
    crowd.push(...batch.map((b) => b.id));
  }
  const gEveryone = must(await svc.from('groups').insert({ tenant_id: T1, name: `Everyone-${stamp}` }).select('id').single(), 'everyone').id as string;
  must(await svc.from('assignments').insert(crowd.map((m) => ({ tenant_id: T1, member_id: m, assignment_type: 'GROUP', group_id: gEveryone }))).select('id'), 'everyone members');
  const bigEv = await mkEvent(ownerL.id);
  const bigAsg = (await createTaskAssignment(T1, { eventId: bigEv, taskId: await task('Big'), assignee: { group_ids: [gEveryone] } }, adminL.id)).id;
  await submitTaskAssignmentResponse(T1, crowd[149], bigAsg, 'REFUSED');
  await submitTaskAssignmentResponse(T1, crowd[3], bigAsg, 'COMMITTED');
  const bigRaw = await raw(T1, bigEv);
  check('the SQL function returns ALL 150 states in a single call', Array.isArray(bigRaw) && bigRaw.length === 150);
  const bigRow = rowOf(await states(bigEv), bigAsg);
  check('the service caps the pills at 100 with a total of 150', bigRow.assignee_states.length === 100 && bigRow.assignee_states_total === 150);
  check('the refusal (which would sort last by name) is pill number 1, and still in refused_by', bigRow.assignee_states[0].member_id === crowd[149] && eq(bigRow.refused_by.map((r) => r.member_id), [crowd[149]]));

  // ============================================================ privileges
  console.log('\n=== Privileges');
  const anonRes = await anon.rpc('list_event_task_assignee_states', { p_tenant_id: T1, p_event_id: ev });
  check('anon cannot execute the function', !!anonRes.error);
  const authed = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${adminL.token}` } } });
  const authRes = await authed.rpc('list_event_task_assignee_states', { p_tenant_id: T1, p_event_id: ev });
  check('authenticated cannot execute the function (a logged-in user cannot pick a tenant)', !!authRes.error);
  check('service_role can', (await svc.rpc('list_event_task_assignee_states', { p_tenant_id: T1, p_event_id: ev })).error === null);

  // ============================================================ endpoint gating
  console.log('\n=== GET /api/event-tasks-assignments (real JWTs)');
  const routeEv = await mkEvent(ownerL.id);
  // FP-239: the endpoint now requires that the caller may open the event, so the non-owner Leader and the plain
  // Member are INVITED here (the refuser holds a task, which also grants access); what is checked is still that
  // none of them receives the states.
  for (const m of [otherLeaderL.id, memberL.id]) must(await svc.from('event_attendees').insert({ tenant_id: T1, event_id: routeEv, member_id: m }).select('event_id'), 'invite');
  const routeTask = await task('Route');
  const routeAsg = (await createTaskAssignment(T1, { eventId: routeEv, taskId: routeTask, assignee: { member_ids: [refuserL.id, ann] } }, adminL.id)).id;
  await submitTaskAssignmentResponse(T1, refuserL.id, routeAsg, 'REFUSED');
  await submitTaskAssignmentResponse(T1, ann, routeAsg, 'COMMITTED');
  const req = (url: string, token?: string) => new NextRequest(new URL(url, 'http://localhost'), { method: 'GET', headers: token ? { authorization: `Bearer ${token}` } : {} });
  for (const [name, who, sees] of [['Admin', adminL, true], ['the event owner (a Leader)', ownerL, true], ['a non-owner Leader', otherLeaderL, false], ['a plain Member', memberL, false], ['the refusing member themself', refuserL, false]] as const) {
    const res = await assignmentsGET(req(`/api/event-tasks-assignments?event_id=${routeEv}`, who.token));
    const body = await res.json();
    const row = (body.data as EventTaskAssignmentWithRefusals[]).find((r) => r.id === routeAsg)!;
    const ok = res.status === 200 && 'data' in body && (sees
      ? row.assignee_states_total === 2 && row.assignee_states.length === 2 && eq(row.refused_by, [{ member_id: refuserL.id, name: 'Refuser Tester' }]) && row.assignee_states[0].state === 'REFUSED' && row.assignee_states[1].state === 'COMMITTED'
      : eq(row.assignee_states, []) && row.assignee_states_total === 0 && eq(row.refused_by, []));
    check(`as ${name}: ${sees ? 'assignee_states, total and refused_by are filled' : 'assignee_states [] , total 0, refused_by [] (the row itself is unchanged)'}`, ok, JSON.stringify(row));
    if (!sees) check(`   ...${name} still receives the normal task row fields`, row.id === routeAsg && row.task_id === routeTask && eq(row.assignee, { member_ids: [refuserL.id, ann] }));
  }
  const noAuth = await assignmentsGET(req(`/api/event-tasks-assignments?event_id=${routeEv}`));
  check('no token: 401', noAuth.status === 401);
  const xt = await assignmentsGET(req(`/api/event-tasks-assignments?event_id=${t2ev}`, adminL.token));
  check("a T1 Admin asking for a T2 event gets 404 NOT_FOUND (FP-239; it used to be an empty list), no rows, no states", xt.status === 404 && (await xt.json()).error?.code === 'NOT_FOUND');

  // ============================================================ query count
  console.log('\n=== Query count is constant');
  const countCalls = async (eventId: string, caller: { memberId: string; role: Role }) => {
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => { if (String(input instanceof Request ? input.url : input).startsWith(URL_)) calls++; return orig(input, init); }) as typeof fetch;
    try { await listTaskAssignmentsForEventWithRefusals(eventId, T1, caller); } finally { globalThis.fetch = orig; }
    return calls;
  };
  const tinyEv = await mkEvent(ownerL.id);
  await createTaskAssignment(T1, { eventId: tinyEv, taskId: await task('Tiny'), assignee: { member_ids: [ann] } }, adminL.id);
  const manyEv = await mkEvent(ownerL.id);
  for (let i = 0; i < 10; i++) await createTaskAssignment(T1, { eventId: manyEv, taskId: await task('Many' + i), assignee: i % 2 ? { group_ids: [gEveryone] } : { member_ids: [ann, dan] } }, adminL.id);
  const adminTiny = await countCalls(tinyEv, { memberId: adminL.id, role: 'ADMIN' });
  const adminMany = await countCalls(manyEv, { memberId: adminL.id, role: 'ADMIN' });
  const ownerTiny = await countCalls(tinyEv, { memberId: ownerL.id, role: 'LEADER' });
  const ownerMany = await countCalls(manyEv, { memberId: ownerL.id, role: 'LEADER' });
  console.log(`  (Admin: 1 task/1 member -> ${adminTiny} calls; 10 tasks/150+ members -> ${adminMany} calls. Owner: ${ownerTiny} vs ${ownerMany})`);
  check('Admin: the same number of database calls for 1 task / 1 member as for 10 tasks / 150+ members', adminTiny === adminMany && adminMany === 2, `${adminTiny} vs ${adminMany}`);
  check('Owner (a Leader): same, plus the one owner lookup', ownerTiny === ownerMany && ownerMany === 3, `${ownerTiny} vs ${ownerMany}`);
  const memberCalls = await countCalls(manyEv, { memberId: memberL.id, role: 'MEMBER' });
  check('a plain member never triggers the states function (rows + owner lookup only)', memberCalls === 2, String(memberCalls));

  console.log(`\n${passed}/${passed + failed} checks passed${failed ? '  (' + failed + ' FAILED)' : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST SCRIPT ERROR', e); process.exit(1); });
