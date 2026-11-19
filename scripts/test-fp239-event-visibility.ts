/**
 * FP-239 (web) — one event-visibility rule for every event endpoint; Leaders see and
 * change only their own events: tests
 *
 * Real route handlers (called with real Auth JWTs) and real service code against the
 * LOCAL database (supabase start + db reset).
 *
 * Run:  npx tsx scripts/test-fp239-event-visibility.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import * as eventsService from '../src/features/events/service';
import { createTaskAssignment, updateTaskAssignment } from '../src/features/tasks/eventTaskAssignment.service';
import { resolveAssigneeMemberIds } from '../src/features/tasks/eventTaskAssignment.repository';
import type { Role } from '../src/lib/auth/middleware';
import { GET as eventsListGET } from '../app/api/events/route';
import { GET as eventGET } from '../app/api/events/[id]/route';
import { GET as reminderGET } from '../app/api/events/[id]/reminder-context/route';
import { GET as rosterGET } from '../app/api/events/[id]/roster/route';
import { POST as viewPOST } from '../app/api/events/[id]/view/route';
import { GET as annRosterGET } from '../app/api/announcements/[eventId]/roster/route';
import { GET as assignmentsGET, POST as assignmentsPOST } from '../app/api/event-tasks-assignments/route';
import { PATCH as assignmentPATCH, DELETE as assignmentDELETE } from '../app/api/event-tasks-assignments/[id]/route';
import { POST as autoAssignPOST } from '../app/api/tasks/auto-assign/route';
import { GET as slotsGET } from '../app/api/tasks/auto-assign/slots/route';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stamp = Date.now();
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a: string[]) => [...a].sort();

let passed = 0, failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? '  -> ' + detail : ''}`); }
}
function must<T>(r: { data: T | null; error: unknown }, what: string): T {
  if (r.error || r.data === null) throw new Error(`${what}: ${JSON.stringify(r.error)}`);
  return r.data;
}

type Ctx = { params: Promise<{ id: string }> };
type CtxE = { params: Promise<{ eventId: string }> };

async function main() {
  const T1 = must(await svc.from('tenants').insert({ name: 'FP239-A-' + stamp }).select('id').single(), 't1').id as string;
  const T2 = must(await svc.from('tenants').insert({ name: 'FP239-B-' + stamp }).select('id').single(), 't2').id as string;
  const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const mkType = async (tenant: string, name: string, code: string, systemKey?: string) => {
    if (systemKey) {
      const ex = await svc.from('event_types').select('id').eq('tenant_id', tenant).eq('system_key', systemKey).maybeSingle();
      if (ex.data) return ex.data.id as string;
    }
    return must(await svc.from('event_types').insert({ tenant_id: tenant, name, code, ...(systemKey ? { system_key: systemKey } : {}) }).select('id').single(), 'type ' + name).id as string;
  };
  const et1 = await mkType(T1, 'ET', 'A' + (stamp % 1000));
  const etAnn = await mkType(T1, 'Announcement', 'N' + (stamp % 1000), 'ANNOUNCEMENT');
  const et2 = await mkType(T2, 'ET', 'B' + (stamp % 1000));

  async function mkPerson(tenant: string, first: string, role: Role) {
    const email = `${first.toLowerCase()}-${stamp}@example.test`;
    const u = await svc.auth.admin.createUser({ email, password: 'Pw-12345-abcde', email_confirm: true, app_metadata: { tenant_id: tenant, role } });
    if (u.error) throw u.error;
    const m = must(await svc.from('members').insert({
      tenant_id: tenant, user_id: u.data.user!.id, email, role, first_name: first, last_name: 'Vis',
      gender: 'FEMALE', marital_status: 'SINGLE', birthdate: '1990-04-04',
    }).select('id').single(), first) as { id: string };
    await svc.auth.admin.updateUserById(u.data.user!.id, { app_metadata: { tenant_id: tenant, role, member_id: m.id } });
    const { data: sess, error } = await anon.auth.signInWithPassword({ email, password: 'Pw-12345-abcde' });
    if (error || !sess.session) throw error ?? new Error('no session');
    return { id: m.id, token: sess.session.access_token, role };
  }
  const people = {
    Admin: await mkPerson(T1, 'Admin', 'ADMIN'),
    LA: await mkPerson(T1, 'LeaderA', 'LEADER'),
    LB: await mkPerson(T1, 'LeaderB', 'LEADER'),
    LC: await mkPerson(T1, 'LeaderC', 'LEADER'),
    LP: await mkPerson(T1, 'Pastoral', 'PASTORAL_LEADER'),
    M1: await mkPerson(T1, 'Member1', 'MEMBER'),
    M2: await mkPerson(T1, 'Member2', 'MEMBER'),
    M3: await mkPerson(T1, 'Member3', 'MEMBER'),
    M4: await mkPerson(T1, 'Member4', 'MEMBER'),
  };
  type Who = keyof typeof people;
  const WHO = Object.keys(people) as Who[];
  const t2admin = await mkPerson(T2, 'T2Admin', 'ADMIN');

  async function mkEvent(name: string, owner: string, status: 'SCHEDULED' | 'DRAFT', attendees: string[], type = et1, tenant = T1) {
    const e = must(await svc.from('events').insert({
      tenant_id: tenant, event_type_id: type, name: `${name}-${stamp}`,
      start_datetime: new Date(Date.now() + 5 * 864e5).toISOString(), end_datetime: new Date(Date.now() + 5 * 864e5 + 72e5).toISOString(),
      location_name: 'Hall', location_address: '1 Main St', target: {}, status, owner_member_id: owner, guests_allowed: false,
    }).select('id').single(), name) as { id: string };
    for (const a of attendees) must(await svc.from('event_attendees').upsert({ tenant_id: tenant, event_id: e.id, member_id: a }, { onConflict: 'event_id,member_id' }).select('event_id'), 'attendee');
    return e.id;
  }
  const task = async (name: string, tenant = T1) => must(await svc.from('tasks').insert({ tenant_id: tenant, name: `${name}-${stamp}` }).select('id').single(), 'task ' + name).id as string;

  const E1 = await mkEvent('E1', people.LA.id, 'SCHEDULED', []);
  const D1 = await mkEvent('D1', people.LA.id, 'DRAFT', []);
  const E2 = await mkEvent('E2', people.Admin.id, 'SCHEDULED', [people.LB.id, people.M1.id, people.LP.id]);
  const E3 = await mkEvent('E3', people.Admin.id, 'SCHEDULED', []);
  const D2 = await mkEvent('D2', people.Admin.id, 'DRAFT', []);
  const A1 = await mkEvent('A1', people.Admin.id, 'SCHEDULED', [people.M1.id, people.LB.id], etAnn);
  const X = await mkEvent('X', t2admin.id, 'SCHEDULED', [], et2, T2);
  const UNKNOWN = crypto.randomUUID();
  const EV: Record<string, string> = { E1, D1, E2, E3, D2, A1 };

  // E3: M2 directly and LeaderC through group G hold a task, neither is invited. D2: M3 holds a task on a DRAFT.
  const G = must(await svc.from('groups').insert({ tenant_id: T1, name: `G-${stamp}` }).select('id').single(), 'group').id as string;
  must(await svc.from('assignments').insert({ tenant_id: T1, member_id: people.LC.id, assignment_type: 'GROUP', group_id: G }).select('id'), 'group member');
  const tHold = await task('Hold');
  const a3 = (await createTaskAssignment(T1, { eventId: E3, taskId: tHold, assignee: { member_ids: [people.M2.id], group_ids: [G] } }, people.Admin.id)).id;
  await createTaskAssignment(T1, { eventId: D2, taskId: await task('HoldDraft'), assignee: { member_ids: [people.M3.id] } }, people.Admin.id);

  // who may open what (the rule under test)
  const allowed: Record<Who, string[]> = {
    Admin: [E1, D1, E2, E3, D2, A1],
    LA: [E1, D1],
    LB: [E2, A1],
    LC: [E3],
    LP: [E2],
    M1: [E2, A1],
    M2: [E3],
    M3: [],
    M4: [],
  };
  const isLeaderTier = (w: Who) => ['Admin', 'LA', 'LB', 'LC', 'LP'].includes(w);

  const req = (method: string, url: string, token?: string, body?: unknown) =>
    new NextRequest(new URL(url, 'http://localhost'), {
      method, headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
  const ctxE = (eventId: string): CtxE => ({ params: Promise.resolve({ eventId }) });
  const run = async (res: Response) => { const b = await res.json().catch(() => null); return { status: res.status, code: b?.error?.code as string | undefined, body: b }; };

  // ====================================================================== READ ENDPOINTS
  console.log('\n=== Read endpoints: the access matrix (200 = opened, 403 = FORBIDDEN_SCOPE/ROLE, 404 = NOT_FOUND)');
  type Endpoint = { name: string; call: (eventId: string, token: string) => Promise<Response>; leaderOnly?: boolean; onlyEvents?: string[] };
  const endpoints: Endpoint[] = [
    { name: 'GET /api/events/:id', call: (id, t) => eventGET(req('GET', `/api/events/${id}`, t), ctx(id)) },
    { name: 'GET /api/events/:id/reminder-context', call: (id, t) => reminderGET(req('GET', `/api/events/${id}/reminder-context`, t), ctx(id)) },
    { name: 'GET /api/events/:id/roster (default view)', call: (id, t) => rosterGET(req('GET', `/api/events/${id}/roster`, t), ctx(id)) },
    { name: 'GET /api/events/:id/roster?view=admin', call: (id, t) => rosterGET(req('GET', `/api/events/${id}/roster?view=admin`, t), ctx(id)), leaderOnly: true },
    { name: 'POST /api/events/:id/view', call: (id, t) => viewPOST(req('POST', `/api/events/${id}/view`, t, {}), ctx(id)) },
    { name: 'GET /api/event-tasks-assignments?event_id=', call: (id, t) => assignmentsGET(req('GET', `/api/event-tasks-assignments?event_id=${id}`, t)) },
    { name: 'GET /api/announcements/:eventId/roster', call: (id, t) => annRosterGET(req('GET', `/api/announcements/${id}/roster`, t), ctxE(id)), leaderOnly: true, onlyEvents: [A1] },
  ];
  const expectFor = (e: Endpoint, who: Who, eventId: string): { status: number; code?: string } => {
    if (e.leaderOnly && !isLeaderTier(who)) return { status: 403, code: 'FORBIDDEN_ROLE' };
    if (eventId === X || eventId === UNKNOWN) return { status: 404, code: 'NOT_FOUND' };
    if (allowed[who].includes(eventId)) return { status: 200 };
    return { status: 403, code: 'FORBIDDEN_SCOPE' };
  };
  const eventSet: [string, string][] = [...Object.entries(EV), ['X (other tenant)', X], ['unknown id', UNKNOWN]];
  for (const e of endpoints) {
    const mism: string[] = [];
    console.log(`\n  ${e.name}`);
    console.log('    ' + ''.padEnd(18) + WHO.map((w) => w.padEnd(6)).join(''));
    for (const [label, id] of eventSet) {
      if (e.onlyEvents && !e.onlyEvents.includes(id) && id !== X && id !== UNKNOWN) continue;
      const cells: string[] = [];
      for (const w of WHO) {
        const r = await run(await e.call(id, people[w].token));
        const exp = expectFor(e, w, id);
        const ok = r.status === exp.status && (exp.code === undefined || r.code === exp.code);
        cells.push(String(r.status).padEnd(6));
        if (!ok) mism.push(`${w}@${label} got ${r.status}${r.code ? '/' + r.code : ''} want ${exp.status}${exp.code ? '/' + exp.code : ''}`);
      }
      console.log('    ' + label.padEnd(18) + cells.join(''));
    }
    check(`${e.name}: every caller x event matches the one rule`, mism.length === 0, mism.slice(0, 6).join('; ') + (mism.length > 6 ? ` ... (+${mism.length - 6})` : ''));
  }
  const noTok = await eventGET(req('GET', `/api/events/${E1}`), ctx(E1));
  check('no token: 401', noTok.status === 401);
  const lcView = await run(await rosterGET(req('GET', `/api/events/${E3}/roster?view=admin`, people.LC.token), ctx(E3)));
  check('a Leader who holds a task (not invited) opens the admin roster view of that event (scoped to their own members, as before)', lcView.status === 200 && Array.isArray(lcView.body?.data));

  // ====================================================================== LISTS
  console.log('\n=== GET /api/events (the web Events list)');
  const idsOf = (b: { data?: { id: string }[] } | null) => (b?.data ?? []).map((r) => r.id);
  const listAs = async (w: Who, qs = '') => run(await eventsListGET(req('GET', `/api/events?limit=100${qs}`, people[w].token)));
  const memberList = await listAs('M1');
  check('a Member calling the web list gets 403 FORBIDDEN_ROLE (not every event in the community)', memberList.status === 403 && memberList.code === 'FORBIDDEN_ROLE', JSON.stringify({ s: memberList.status, c: memberList.code, n: idsOf(memberList.body).length }));
  const memberList2 = await listAs('M3');
  check('...also a Member with a task on a draft', memberList2.status === 403 && memberList2.code === 'FORBIDDEN_ROLE');
  const laList = await listAs('LA');
  check('Leader A (owns E1 and the draft D1) sees exactly E1 and D1', eq(sorted(idsOf(laList.body)), sorted([E1, D1])), JSON.stringify(idsOf(laList.body).length));
  const lbList = await listAs('LB');
  check('Leader B (invited to E2 and A1) sees exactly E2 and A1', eq(sorted(idsOf(lbList.body)), sorted([E2, A1])));
  const lcList = await listAs('LC');
  check('Leader C (a task on E3 only) sees NOTHING in the list: task-only events open from the task card but are not listed', lcList.status === 200 && idsOf(lcList.body).length === 0, JSON.stringify(idsOf(lcList.body).length));
  const lpList = await listAs('LP');
  check('a PASTORAL_LEADER (Leader tier) is scoped the same way: only E2', eq(idsOf(lpList.body), [E2]));
  const adminList = await listAs('Admin');
  check('the Admin sees every event of the community (6), as before', eq(sorted(idsOf(adminList.body)), sorted([E1, D1, E2, E3, D2, A1])));
  check('no row of another community ever appears', !idsOf(adminList.body).includes(X) && !idsOf(laList.body).includes(X));
  const laSched = await listAs('LA', '&status=SCHEDULED');
  check('status filter path, Leader A: SCHEDULED -> only E1 (the draft is filtered by status, nothing foreign appears)', eq(idsOf(laSched.body), [E1]), JSON.stringify(idsOf(laSched.body).length));
  const lbSched = await listAs('LB', '&status=SCHEDULED');
  check('status filter path, Leader B: SCHEDULED -> E2 and A1', eq(sorted(idsOf(lbSched.body)), sorted([E2, A1])));
  const lbDraft = await listAs('LB', '&status=DRAFT');
  check('status filter path, Leader B: DRAFT -> nothing (never sees drafts they do not own)', idsOf(lbDraft.body).length === 0);
  const adminSched = await listAs('Admin', '&status=SCHEDULED');
  check('status filter path, Admin: SCHEDULED -> E1, E2, E3, A1', eq(sorted(idsOf(adminSched.body)), sorted([E1, E2, E3, A1])));
  const lbTypeFilter = await listAs('LB', `&eventTypeIds=${etAnn}`);
  check('the event-type filter still applies inside the Leader scope (announcement type -> only A1)', eq(idsOf(lbTypeFilter.body), [A1]));
  const evMonth = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 7);
  const lbMonth = await listAs('LB', `&month=${evMonth}`);
  const lbFarMonth = await listAs('LB', '&month=2099-01');
  check('the month filter (gte/lt) applies inside the Leader scope: the event month -> E2 and A1, a far month -> nothing', eq(sorted(idsOf(lbMonth.body)), sorted([E2, A1])) && idsOf(lbFarMonth.body).length === 0);
  const page1 = await run(await eventsListGET(req('GET', '/api/events?limit=1&offset=0', people.LB.token)));
  const page2 = await run(await eventsListGET(req('GET', '/api/events?limit=1&offset=1', people.LB.token)));
  check('pagination inside the Leader scope: 1 + 1 rows, no overlap, hasMore true then false',
    idsOf(page1.body).length === 1 && idsOf(page2.body).length === 1 && idsOf(page1.body)[0] !== idsOf(page2.body)[0] && page1.body?.hasMore === true && page2.body?.hasMore === false,
    JSON.stringify({ a: page1.body?.hasMore, b: page2.body?.hasMore }));
  const sortedDates = (laList.body?.data ?? []).map((r: { start_datetime: string }) => r.start_datetime);
  check('rows stay ordered by start time', eq(sortedDates, [...sortedDates].sort()));
  const laRow = (laList.body?.data ?? []).find((r: { id: string }) => r.id === E1);
  check('each row still carries effective_status and the Needs attention fields', typeof laRow?.effective_status === 'string' && laRow?.needs_attention === false && Array.isArray(laRow?.needs_attention_tasks) && !('owner_member_id' in laRow));
  const svcLA = await eventsService.listEvents(T1, { limit: 100, viewer: { memberId: people.LA.id, role: 'LEADER' }, visibleTo: { memberId: people.LA.id, role: 'LEADER' } } as never);
  check('listEvents called with visibleTo the way the server page does: the same result for Leader A', eq(sorted(svcLA.data.map((r) => r.id)), sorted([E1, D1])));
  const svcAdmin = await eventsService.listEvents(T1, { limit: 100, viewer: { memberId: people.Admin.id, role: 'ADMIN' }, visibleTo: { memberId: people.Admin.id, role: 'ADMIN' } } as never);
  check('...and for the Admin (Admin tier keeps today\'s query): all 6', svcAdmin.data.length === 6);
  const svcNone = await eventsService.listEvents(T1, { limit: 100 });
  check('listEvents with no visibleTo (internal use) is unchanged: every event of the tenant', svcNone.data.length === 6);

  // ====================================================================== page helper
  console.log('\n=== canCallerOpenEvent (the web event page helper)');
  const helper = (eventsService as unknown as { canCallerOpenEvent?: (t: string, m: string, r: Role, e: string) => Promise<string> }).canCallerOpenEvent;
  if (!helper) {
    check('canCallerOpenEvent exists', false, 'not exported');
  } else {
    check("'OK' for an owner", (await helper(T1, people.LA.id, 'LEADER', E1)) === 'OK');
    check("'OK' for an assignee who is not invited", (await helper(T1, people.M2.id, 'MEMBER', E3)) === 'OK');
    check("'FORBIDDEN_SCOPE' for a Leader with no relation", (await helper(T1, people.LB.id, 'LEADER', E1)) === 'FORBIDDEN_SCOPE');
    check("'NOT_FOUND' for an unknown event and for another tenant's event", (await helper(T1, people.Admin.id, 'ADMIN', UNKNOWN)) === 'NOT_FOUND' && (await helper(T1, people.Admin.id, 'ADMIN', X)) === 'NOT_FOUND');
  }

  // ====================================================================== WRITES
  console.log('\n=== Leaders change only events they own');
  const tW = await task('Write');
  const a2 = (await createTaskAssignment(T1, { eventId: E2, taskId: tW, assignee: { member_ids: [people.M1.id] } }, people.Admin.id)).id;
  const snap = async () => ({
    rows: must(await svc.from('event_tasks_assignments').select('id, assignee, updated_at').eq('event_id', E2).order('id'), 'rows'),
    version: must(await svc.from('events').select('version').eq('id', E2).single(), 'version').version,
  });
  const before = await snap();
  const tOther = await task('WriteOther');
  const post = await run(await assignmentsPOST(req('POST', '/api/event-tasks-assignments', people.LB.token, { event_id: E2, task_id: tOther, assignee: { member_ids: [people.M4.id] } })));
  check('Leader B (not the owner) POST a task assignment on E2: 403 FORBIDDEN_SCOPE', post.status === 403 && post.code === 'FORBIDDEN_SCOPE', JSON.stringify({ s: post.status, c: post.code }));
  const patch = await run(await assignmentPATCH(req('PATCH', `/api/event-tasks-assignments/${a2}`, people.LB.token, { assignee: { member_ids: [people.M4.id] } }), ctx(a2)));
  check('Leader B PATCH an assignment on E2: 403 FORBIDDEN_SCOPE', patch.status === 403 && patch.code === 'FORBIDDEN_SCOPE', JSON.stringify({ s: patch.status, c: patch.code }));
  const del = await run(await assignmentDELETE(req('DELETE', `/api/event-tasks-assignments/${a2}`, people.LB.token), ctx(a2)));
  check('Leader B DELETE an assignment on E2: 403 FORBIDDEN_SCOPE', del.status === 403 && del.code === 'FORBIDDEN_SCOPE', JSON.stringify({ s: del.status, c: del.code }));
  const after = await snap();
  check('nothing changed: the rows and events.version on E2 are exactly as before', eq(before, after), JSON.stringify({ before: before.version, after: after.version, rows: after.rows.length }));
  const lpPatch = await run(await assignmentPATCH(req('PATCH', `/api/event-tasks-assignments/${a2}`, people.LP.token, { assignee: { member_ids: [people.M4.id] } }), ctx(a2)));
  check('a PASTORAL_LEADER (Leader tier) is refused the same way', lpPatch.status === 403 && lpPatch.code === 'FORBIDDEN_SCOPE');
  const memberPost = await run(await assignmentsPOST(req('POST', '/api/event-tasks-assignments', people.M1.token, { event_id: E2, task_id: tOther, assignee: { member_ids: [people.M4.id] } })));
  check('a Member still gets 403 FORBIDDEN_ROLE (unchanged)', memberPost.status === 403 && memberPost.code === 'FORBIDDEN_ROLE');

  const tOwn = await task('WriteOwn');
  const laPost = await run(await assignmentsPOST(req('POST', '/api/event-tasks-assignments', people.LA.token, { event_id: E1, task_id: tOwn, assignee: { member_ids: [people.M4.id] } })));
  check('Leader A (the owner) POST on E1: 201', laPost.status === 201, JSON.stringify({ s: laPost.status, c: laPost.code }));
  const laId = laPost.body?.data?.id as string;
  const laPatch = await run(await assignmentPATCH(req('PATCH', `/api/event-tasks-assignments/${laId}`, people.LA.token, { assignee: { member_ids: [people.M3.id] } }), ctx(laId)));
  check('Leader A PATCH on E1: 200', laPatch.status === 200, JSON.stringify({ s: laPatch.status, c: laPatch.code }));
  const laDel = await run(await assignmentDELETE(req('DELETE', `/api/event-tasks-assignments/${laId}`, people.LA.token), ctx(laId)));
  check('Leader A DELETE on E1: 200', laDel.status === 200);
  const adminPatch = await run(await assignmentPATCH(req('PATCH', `/api/event-tasks-assignments/${a2}`, people.Admin.token, { assignee: { member_ids: [people.M4.id] } }), ctx(a2)));
  check('the Admin PATCH on E2 (not theirs by invitation, Admin tier): 200', adminPatch.status === 200, JSON.stringify({ s: adminPatch.status, c: adminPatch.code }));
  const adminPost = await run(await assignmentsPOST(req('POST', '/api/event-tasks-assignments', people.Admin.token, { event_id: E1, task_id: await task('AdminOnE1'), assignee: { member_ids: [people.M4.id] } })));
  check('the Admin POST on a Leader\'s event: 201', adminPost.status === 201);
  const nf = await run(await assignmentPATCH(req('PATCH', `/api/event-tasks-assignments/${crypto.randomUUID()}`, people.LB.token, { assignee: { member_ids: [] } }), ctx(crypto.randomUUID())));
  check('an unknown assignment id is still 404 NOT_FOUND', nf.status === 404 && nf.code === 'NOT_FOUND');

  console.log('\n=== Auto-assign is limited to the Leader\'s own events');
  const tAuto = await task('Auto');
  const slotIds = async (w: Who) => {
    const r = await run(await slotsGET(req('GET', `/api/tasks/auto-assign/slots?task_id=${tAuto}&event_type_ids=${et1}`, people[w].token)));
    return { status: r.status, ids: ((r.body?.data ?? []) as { event_id: string }[]).map((s) => s.event_id) };
  };
  const laSlots = await slotIds('LA');
  check('Leader A\'s slot list holds only E1 and D1', laSlots.status === 200 && eq(sorted(laSlots.ids), sorted([E1, D1])), JSON.stringify(laSlots.ids.length));
  const lbSlots = await slotIds('LB');
  check('Leader B (owns nothing) gets an empty slot list', lbSlots.status === 200 && lbSlots.ids.length === 0, JSON.stringify(lbSlots.ids.length));
  const adminSlots = await slotIds('Admin');
  check('the Admin\'s slot list covers every upcoming event of the type (E1, D1, E2, E3, D2)', eq(sorted(adminSlots.ids), sorted([E1, D1, E2, E3, D2])), JSON.stringify(adminSlots.ids.length));
  const versions = async () => Object.fromEntries(await Promise.all(Object.entries(EV).map(async ([k, id]) => [k, must(await svc.from('events').select('version').eq('id', id).single(), 'v').version as number])));
  const rowsFor = async (taskId: string) => must(await svc.from('event_tasks_assignments').select('event_id, assignee').eq('task_id', taskId), 'asg rows') as { event_id: string; assignee: unknown }[];
  const vBefore = await versions();
  const laRun = await run(await autoAssignPOST(req('POST', '/api/tasks/auto-assign', people.LA.token, { task_id: tAuto, roster: [{ type: 'member', id: people.M4.id }], event_type_ids: [et1] })));
  const afterLa = await rowsFor(tAuto);
  check('Leader A\'s run succeeds and its result lists only E1 and D1', laRun.status === 200 && eq(sorted((laRun.body?.data ?? []).map((r: { event_id: string }) => r.event_id)), sorted([E1, D1])), JSON.stringify({ s: laRun.status, c: laRun.code }));
  check('...assignment rows exist only on E1 and D1 (no other event got one)', eq(sorted(afterLa.map((r) => r.event_id)), sorted([E1, D1])));
  const vAfter = await versions();
  check('...and the versions of E2, E3, D2, A1 are untouched', vBefore.E2 === vAfter.E2 && vBefore.E3 === vAfter.E3 && vBefore.D2 === vAfter.D2 && vBefore.A1 === vAfter.A1);
  const lbRun = await run(await autoAssignPOST(req('POST', '/api/tasks/auto-assign', people.LB.token, { task_id: tAuto, roster: [{ type: 'member', id: people.M1.id }], event_type_ids: [et1] })));
  check('Leader B\'s run (owns no event) changes nothing and returns an empty list', lbRun.status === 200 && (lbRun.body?.data ?? []).length === 0 && eq(sorted((await rowsFor(tAuto)).map((r) => r.event_id)), sorted([E1, D1])));
  const adminRun = await run(await autoAssignPOST(req('POST', '/api/tasks/auto-assign', people.Admin.token, { task_id: tAuto, roster: [{ type: 'member', id: people.M4.id }, { type: 'member', id: people.M1.id }], event_type_ids: [et1] })));
  check('the Admin\'s run covers every eligible event (E1, D1, E2, E3, D2)', adminRun.status === 200 && eq(sorted((await rowsFor(tAuto)).map((r) => r.event_id)), sorted([E1, D1, E2, E3, D2])), JSON.stringify({ s: adminRun.status, c: adminRun.code }));

  // ====================================================================== SQL
  console.log('\n=== The SQL functions');
  const fns: [string, Record<string, unknown>][] = [
    ['is_member_assigned_to_event', { p_tenant_id: T1, p_event_id: E3, p_member_id: people.M2.id }],
    ['list_member_visible_events', { p_tenant_id: T1, p_member_id: people.LA.id }],
    ['auto_assign_task_slots', { p_tenant_id: T1, p_task_id: tAuto, p_roster: [], p_actor_member_id: people.Admin.id, p_event_type_ids: [et1] }],
  ];
  const authed = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: `Bearer ${people.Admin.token}` } } });
  for (const [fn, args] of fns) {
    const a = await anon.rpc(fn, args);
    const u = await authed.rpc(fn, args);
    const s = await svc.rpc(fn, args);
    check(`${fn}: anon and authenticated cannot execute it, service_role can`, !!a.error && !!u.error && !s.error, JSON.stringify({ anon: a.error?.code, auth: u.error?.code, svc: s.error?.code }));
  }
  const oneAutoFn = execFileSync('docker', ['exec', '-i', 'supabase_db_flockpulse-web', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
    "select count(*) from pg_proc where proname = 'auto_assign_task_slots' and pronamespace = 'public'::regnamespace"], { encoding: 'utf8' }).trim();
  check('exactly one auto_assign_task_slots exists (the 6-argument one replaced the 5-argument one)', oneAutoFn === '1', oneAutoFn);

  console.log(' is_member_assigned_to_event agrees with resolve_assignee_member_ids (non-draft events):');
  const allAsg = must(await svc.from('event_tasks_assignments').select('event_id, assignee').eq('tenant_id', T1), 'all asg') as { event_id: string; assignee: unknown }[];
  const statusOf = Object.fromEntries(((await svc.from('events').select('id, status').eq('tenant_id', T1)).data ?? []).map((e: { id: string; status: string }) => [e.id, e.status]));
  let compared = 0, disagree = 0;
  for (const eid of Object.values(EV)) {
    const resolved = new Set<string>();
    if (statusOf[eid] !== 'DRAFT') for (const a of allAsg.filter((r) => r.event_id === eid)) for (const m of await resolveAssigneeMemberIds(T1, a.assignee)) resolved.add(m);
    for (const w of WHO) {
      const got = (await svc.rpc('is_member_assigned_to_event', { p_tenant_id: T1, p_event_id: eid, p_member_id: people[w].id })).data;
      compared++;
      if (got !== resolved.has(people[w].id)) disagree++;
    }
  }
  check(`all ${compared} (member x event) pairs agree with the resolve rule`, compared === 54 && disagree === 0, `disagreements=${disagree}`);
  check('false for the owner of an event who holds no task, true for a direct assignee and a group member', (await svc.rpc('is_member_assigned_to_event', { p_tenant_id: T1, p_event_id: E3, p_member_id: people.Admin.id })).data === false && (await svc.rpc('is_member_assigned_to_event', { p_tenant_id: T1, p_event_id: E3, p_member_id: people.M2.id })).data === true && (await svc.rpc('is_member_assigned_to_event', { p_tenant_id: T1, p_event_id: E3, p_member_id: people.LC.id })).data === true);
  check('false on a DRAFT event even for its assignee, and false across tenants', (await svc.rpc('is_member_assigned_to_event', { p_tenant_id: T1, p_event_id: D2, p_member_id: people.M3.id })).data === false && (await svc.rpc('is_member_assigned_to_event', { p_tenant_id: T2, p_event_id: E3, p_member_id: people.M2.id })).data === false);
  const vis = (await svc.rpc('list_member_visible_events', { p_tenant_id: T1, p_member_id: people.LB.id })).data as { id: string }[];
  const visLA = (await svc.rpc('list_member_visible_events', { p_tenant_id: T1, p_member_id: people.LA.id })).data as { id: string }[];
  const visNone = (await svc.rpc('list_member_visible_events', { p_tenant_id: T1, p_member_id: people.M4.id })).data as { id: string }[];
  check('list_member_visible_events: owned (drafts included) plus invited, nothing for a member with neither, nothing across tenants',
    eq(sorted(vis.map((e) => e.id)), sorted([E2, A1])) && eq(sorted(visLA.map((e) => e.id)), sorted([E1, D1])) && visNone.length === 0
    && ((await svc.rpc('list_member_visible_events', { p_tenant_id: T2, p_member_id: people.LA.id })).data as unknown[]).length === 0);
  const legacy = await svc.rpc('auto_assign_task_slots', { p_tenant_id: T1, p_task_id: tAuto, p_roster: [{ type: 'member', id: people.M4.id }], p_actor_member_id: people.Admin.id, p_event_type_ids: [et1] });
  check('the old 5-named-argument call still resolves and covers every event (no owner scope)', !legacy.error && (legacy.data as unknown[]).length === 5, JSON.stringify(legacy.error));
  let twice = 'ok';
  try {
    const sql = readFileSync('supabase/migrations/20261006000082_event_visibility_and_leader_scope.sql', 'utf8');
    for (let i = 0; i < 2; i++) execFileSync('docker', ['exec', '-i', 'supabase_db_flockpulse-web', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) { twice = 'ERROR ' + ((e as { stderr?: string }).stderr ?? (e as Error).message).slice(0, 200); }
  check('applying the migration again (twice more) is clean', twice === 'ok', twice);

  // ====================================================================== assignment follows the task
  console.log('\n=== Access follows the task');
  await updateTaskAssignment(a3, T1, { assignee: { group_ids: [G] } }, people.Admin.id);   // M2 removed from the task, group G kept
  const m2After = await run(await eventGET(req('GET', `/api/events/${E3}`, people.M2.token), ctx(E3)));
  const lcAfter = await run(await eventGET(req('GET', `/api/events/${E3}`, people.LC.token), ctx(E3)));
  check('when M2 is taken off the task they can no longer open E3 (403); Leader C, still in the group, can (200)', m2After.status === 403 && lcAfter.status === 200, JSON.stringify({ m2: m2After.status, lc: lcAfter.status }));

  console.log(`\n${passed}/${passed + failed} checks passed${failed ? '  (' + failed + ' FAILED)' : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST SCRIPT ERROR', e); process.exit(1); });
