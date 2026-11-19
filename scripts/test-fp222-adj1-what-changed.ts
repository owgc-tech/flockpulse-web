/**
 * FP-222-adj-1 (web) — what changed, which task, who refused, web list marker: tests
 *
 * Real service code and the real route handlers (with real Auth JWTs) against the
 * LOCAL database (supabase start + db reset). Covers:
 *   - modified_fields: label mapping from the real columns, fixed order, union of
 *     edits, 'Tasks' for non-audited bumps, 'Details' fallback, audit gaps never error
 *   - needs_attention_tasks (only tasks with CURRENT refusals; [] unless owner/Admin)
 *   - refused_by on GET /api/event-tasks-assignments (owner + Admin only)
 *   - the web events list marker (rule + constant query count)
 *   - POST /api/events/:id/view answering 200 with the envelope
 *   - a catalog check that enumerates every events.version bump source
 *
 * Run:  npx tsx scripts/test-fp222-adj1-what-changed.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { execFileSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import {
  listEventsForMember, getEventById, listEvents, updateEvent, recordEventViewForCaller,
} from '../src/features/events/service';
import {
  createTaskAssignment, updateTaskAssignment, submitTaskAssignmentResponse, listTaskAssignmentsForEventWithRefusals,
} from '../src/features/tasks/eventTaskAssignment.service';
import { listRefusedTaskNamesByEvent } from '../src/features/tasks/refusedTasks';
import { removeMember } from '../src/features/members/service';
import {
  deriveModifiedFields, diffLabels, LABEL_ORDER, AUDITED_VERSION_BUMP_SOURCES, NON_AUDITED_VERSION_BUMP_SOURCES,
} from '../src/features/events/modifiedFields';
import type { Role } from '../src/lib/auth/middleware';
import { POST as viewPOST } from '../app/api/events/[id]/view/route';
import { GET as assignmentsGET } from '../app/api/event-tasks-assignments/route';
import { GET as listGET } from '../app/api/events/route';

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

async function main() {
  // ============================================================ PURE: label mapping
  console.log('\n=== Label mapping (the real events columns)');
  const base = {
    id: 'e1', tenant_id: 't1', name: 'N', status: 'SCHEDULED', start_datetime: '2026-01-01T10:00:00+00:00', end_datetime: '2026-01-01T12:00:00+00:00',
    location_name: 'Hall', location_address: '1 Main', target: { group_ids: ['g1'], member_ids: [] }, event_type_id: 'ty1', talk_id: null,
    online_meeting_resource_id: null, online_meeting_url: null, online_meeting_platform_label: null, rsvp_closure_days: null,
    owner_member_id: 'o1', announcement_body: null, guests_allowed: false, recurrence_series_id: null, created_by_member_id: 'c1',
    version: 3, updated_at: 'u1', created_at: 'c0',
  } as Record<string, unknown>;
  const mapping: [string, unknown, string][] = [
    ['name', 'New name', 'Name'], ['announcement_body', 'text', 'Description'],
    ['start_datetime', '2026-01-02T10:00:00+00:00', 'Date & time'], ['end_datetime', '2026-01-02T12:00:00+00:00', 'Date & time'],
    ['location_name', 'Other hall', 'Location'], ['location_address', '2 Side St', 'Location'],
    ['event_type_id', 'ty2', 'Event type'],
    ['online_meeting_url', 'https://x.test/j', 'Online meeting'], ['online_meeting_platform_label', 'Meet', 'Online meeting'], ['online_meeting_resource_id', 'res1', 'Online meeting'],
    ['talk_id', 'talk1', 'Talk'],
    ['rsvp_closure_days', 3, 'RSVP settings'], ['guests_allowed', true, 'RSVP settings'],
    ['target', { group_ids: ['g2'], member_ids: [] }, 'Invitees'],
    ['status', 'CANCELLED', 'Status'],
    ['owner_member_id', 'o2', 'Details'], ['recurrence_series_id', 'rs1', 'Details'], ['created_by_member_id', 'c2', 'Details'],
  ];
  for (const [col, value, label] of mapping) {
    const got = [...diffLabels(base, { ...base, [col]: value })];
    check(`${col} -> '${label}'`, eq(got, [label]), JSON.stringify(got));
  }
  for (const col of ['version', 'updated_at', 'created_at', 'id', 'tenant_id']) {
    check(`system column ${col} alone -> no label`, diffLabels(base, { ...base, [col]: 'different' }).size === 0);
  }
  check('target: reordered ids / absent-vs-empty arrays are not a change',
    diffLabels({ target: { group_ids: ['a', 'b'] } }, { target: { group_ids: ['b', 'a'], member_ids: [] } }).size === 0);
  check('a column that is new in a future migration -> Details', eq([...diffLabels(base, { ...base, some_new_column: 1 })], ['Details']));
  check('unreadable audit entry (null before) -> Details, no throw', eq([...diffLabels(null, base)], ['Details']));
  check('every label the mapping can produce is in LABEL_ORDER', [...new Set(mapping.map((m) => m[2]))].every((l) => (LABEL_ORDER as readonly string[]).includes(l)));

  console.log('\n=== deriveModifiedFields (pure)');
  const entry = (from: number, patch: Record<string, unknown>) => ({ before_value: { ...base, version: from }, after_value: { ...base, ...patch, version: from + 1 } });
  check('date edit only -> [Date & time]', eq(deriveModifiedFields(3, 4, [entry(3, { start_datetime: '2026-01-02T10:00:00+00:00' })]), ['Date & time']));
  check('location then name edits -> fixed order [Name, Location] regardless of edit order',
    eq(deriveModifiedFields(3, 5, [entry(3, { location_name: 'Z' }), entry(4, { name: 'Q' })]), ['Name', 'Location']));
  check('both start and end datetime in one edit -> one [Date & time]', eq(deriveModifiedFields(3, 4, [entry(3, { start_datetime: 'a', end_datetime: 'b' })]), ['Date & time']));
  check('a version with NO audit entry -> [Tasks]', eq(deriveModifiedFields(3, 4, []), ['Tasks']));
  check('edit + a missing version -> both, Tasks after the field labels', eq(deriveModifiedFields(3, 5, [entry(3, { start_datetime: 'a' })]), ['Date & time', 'Tasks']));
  check('missing version in the middle of the range is found', eq(deriveModifiedFields(3, 6, [entry(3, { name: 'A' }), entry(5, { location_name: 'B' })]), ['Name', 'Location', 'Tasks']));
  check('a no-op edit (audit entry, nothing differs) -> [Details]', eq(deriveModifiedFields(3, 4, [entry(3, {})]), ['Details']));
  check('entries at or below last_seen, or above the current version, are ignored', eq(deriveModifiedFields(3, 4, [entry(1, { name: 'old' }), entry(3, { location_name: 'L' }), entry(9, { talk_id: 't' })]), ['Location']));
  check('entries given out of order and duplicated labels de-duplicate', eq(deriveModifiedFields(3, 5, [entry(4, { location_name: 'B' }), entry(3, { location_address: 'A' })]), ['Location']));
  let threw = false;
  try { deriveModifiedFields(3, 6, [{ before_value: 'garbage', after_value: { version: 4 } }, { before_value: null, after_value: null }, { before_value: {}, after_value: { version: 'x' } }] as never); } catch { threw = true; }
  check('garbage / null audit entries never throw', !threw);

  // ============================================================ fixtures
  const T1 = must(await svc.from('tenants').insert({ name: 'ADJ1-A-' + stamp }).select('id').single(), 't1').id as string;
  const T2 = must(await svc.from('tenants').insert({ name: 'ADJ1-B-' + stamp }).select('id').single(), 't2').id as string;
  const et1 = must(await svc.from('event_types').insert({ tenant_id: T1, name: 'ET', code: 'E' + (stamp % 1000) }).select('id').single(), 'et1').id as string;
  const et1b = must(await svc.from('event_types').insert({ tenant_id: T1, name: 'ET2', code: 'F' + (stamp % 1000) }).select('id').single(), 'et1b').id as string;
  const et2 = must(await svc.from('event_types').insert({ tenant_id: T2, name: 'ET', code: 'G' + (stamp % 1000) }).select('id').single(), 'et2').id as string;
  void et2;

  async function mkMember(tenantId: string, first: string, role: Role, withLogin = false) {
    let userId: string = crypto.randomUUID();
    const email = `${first.toLowerCase()}-${stamp}@example.test`;
    if (withLogin) {
      const u = await svc.auth.admin.createUser({ email, password: 'Pw-12345-abcde', email_confirm: true, app_metadata: { tenant_id: tenantId, role } });
      if (u.error) throw u.error;
      userId = u.data.user!.id;
    }
    const m = must(await svc.from('members').insert({
      tenant_id: tenantId, user_id: userId, email, role, first_name: first, last_name: 'Tester',
      gender: 'FEMALE', marital_status: 'SINGLE', birthdate: '1990-04-04',
    }).select('id').single(), 'member ' + first) as { id: string };
    if (withLogin) await svc.auth.admin.updateUserById(userId, { app_metadata: { tenant_id: tenantId, role, member_id: m.id } });
    return { id: m.id, email };
  }
  const admin = (await mkMember(T1, 'Admin', 'ADMIN')).id;
  const owner = (await mkMember(T1, 'Owner', 'LEADER')).id;
  const otherLeader = (await mkMember(T1, 'OtherLeader', 'LEADER')).id;
  const viewer = (await mkMember(T1, 'Viewer', 'MEMBER')).id;
  const R = (await mkMember(T1, 'Refuser', 'MEMBER')).id;
  const R2 = (await mkMember(T1, 'RefuserTwo', 'MEMBER')).id;
  const R3 = (await mkMember(T1, 'RefuserThree', 'MEMBER')).id;
  const spare = (await mkMember(T1, 'Spare', 'MEMBER')).id;

  let evCounter = 0;
  async function mkEvent(opts: { tenant?: string; type?: string; owner?: string | null; status?: string; startOffsetDays?: number; attendees?: string[]; name?: string } = {}) {
    evCounter++;
    const days = opts.startOffsetDays ?? (2 + evCounter);
    const tenant = opts.tenant ?? T1;
    const e = must(await svc.from('events').insert({
      tenant_id: tenant, event_type_id: opts.type ?? et1, name: opts.name ?? `E${evCounter}-${stamp}`,
      start_datetime: new Date(Date.now() + days * 864e5).toISOString(),
      end_datetime: new Date(Date.now() + days * 864e5 + 72e5).toISOString(),
      location_name: 'Hall', location_address: '1 Main St', target: {}, status: opts.status ?? 'SCHEDULED',
      owner_member_id: opts.owner === undefined ? owner : opts.owner,
    }).select('id').single(), 'event') as { id: string };
    for (const m of opts.attendees ?? []) {
      must(await svc.from('event_attendees').upsert({ tenant_id: tenant, event_id: e.id, member_id: m }, { onConflict: 'event_id,member_id' }).select('event_id'), 'attendee');
    }
    return e.id;
  }
  const task = async (name: string, tenant = T1) => must(await svc.from('tasks').insert({ tenant_id: tenant, name: `${name}-${stamp}` }).select('id').single(), 'task ' + name).id as string;
  const taskName = (n: string) => `${n}-${stamp}`;
  const evVersion = async (id: string) => (must(await svc.from('events').select('version').eq('id', id).single(), 'version') as { version: number }).version;
  const edit = (id: string, input: Record<string, unknown>) => updateEvent(id, T1, { ...input, actorMemberId: owner } as never, undefined);
  const open = (id: string) => recordEventViewForCaller(T1, viewer, 'MEMBER', id);
  async function seen(id: string) {
    const d = await getEventById(id, T1, viewer, 'MEMBER');
    const l = (await listEventsForMember(T1, viewer, 'MEMBER')).find((e: { id: string }) => e.id === id) as unknown as { modified_fields: string[]; is_modified: boolean } | undefined;
    return { detail: d.modified_fields as string[], list: l?.modified_fields, isModified: d.is_modified as boolean };
  }
  const expectFields = async (label: string, id: string, expected: string[]) => {
    const s = await seen(id);
    check(label, eq(s.detail, expected) && eq(s.list, expected), JSON.stringify({ expected, detail: s.detail, list: s.list }));
  };

  // ============================================================ modified_fields (database)
  console.log('\n=== modified_fields from the audit log');
  const dateEv = await mkEvent({ attendees: [viewer] });
  await open(dateEv);
  const cur = must(await svc.from('events').select('start_datetime, end_datetime').eq('id', dateEv).single(), 'cur') as { start_datetime: string; end_datetime: string };
  await edit(dateEv, { startDatetime: new Date(new Date(cur.start_datetime).getTime() + 36e5).toISOString(), endDatetime: new Date(new Date(cur.end_datetime).getTime() + 36e5).toISOString() });
  await expectFields("a date edit -> ['Date & time']", dateEv, ['Date & time']);

  const lnEv = await mkEvent({ attendees: [viewer] });
  await open(lnEv);
  await edit(lnEv, { locationName: 'Other hall ' + stamp });
  await edit(lnEv, { name: 'Renamed ' + stamp });
  await expectFields("location edit then name edit -> ['Name','Location'] (fixed order, not edit order)", lnEv, ['Name', 'Location']);
  const lnEv2 = await mkEvent({ attendees: [viewer] });
  await open(lnEv2);
  await edit(lnEv2, { name: 'Both ' + stamp, locationName: 'Both hall ' + stamp });
  await expectFields("name + location in ONE edit -> ['Name','Location']", lnEv2, ['Name', 'Location']);

  const aTask = await task('Alpha');
  const bTask = await task('Beta');
  const tEv = await mkEvent({ attendees: [viewer, R] });
  const tAsg = (await createTaskAssignment(T1, { eventId: tEv, taskId: aTask, assignee: { member_ids: [R] } }, admin)).id;
  await open(tEv);
  await updateTaskAssignment(tAsg, T1, { assignee: { member_ids: [spare] } }, admin);
  await expectFields("a task reassignment -> ['Tasks']", tEv, ['Tasks']);

  const remEv = await mkEvent({ attendees: [viewer] });
  const goner = (await mkMember(T1, 'Goner', 'MEMBER')).id;
  await createTaskAssignment(T1, { eventId: remEv, taskId: aTask, assignee: { member_ids: [goner] } }, admin);
  await open(remEv);
  await removeMember(goner, T1, 'DEACTIVATED');
  await expectFields("removing a member who was assigned a task -> ['Tasks']", remEv, ['Tasks']);

  const unionEv = await mkEvent({ attendees: [viewer] });
  await open(unionEv);
  await edit(unionEv, { locationName: 'U1 ' + stamp });
  await edit(unionEv, { rsvpClosureDays: 5 });
  await expectFields("two edits since the last view union their labels -> ['Location','RSVP settings']", unionEv, ['Location', 'RSVP settings']);

  const mixEv = await mkEvent({ attendees: [viewer] });
  const mixAsg = (await createTaskAssignment(T1, { eventId: mixEv, taskId: bTask, assignee: { member_ids: [R] } }, admin)).id;
  await open(mixEv);
  await edit(mixEv, { name: 'Mix ' + stamp });
  await updateTaskAssignment(mixAsg, T1, { assignee: { member_ids: [spare] } }, admin);
  await expectFields("an edit plus a task change -> ['Name','Tasks']", mixEv, ['Name', 'Tasks']);

  await open(mixEv);
  await expectFields('after the viewer opens the event -> [] and is_modified false', mixEv, []);
  check('...is_modified is false too', (await seen(mixEv)).isModified === false);

  const neverEv = await mkEvent({ attendees: [viewer] });
  await edit(neverEv, { name: 'Never opened ' + stamp });
  await expectFields('never opened (even after an edit) -> []', neverEv, []);

  console.log(' other label columns, end to end:');
  const rsvpEv = await mkEvent({ attendees: [viewer] });
  await open(rsvpEv); await edit(rsvpEv, { guestsAllowed: true });
  await expectFields("guest setting -> ['RSVP settings']", rsvpEv, ['RSVP settings']);
  const typeEv = await mkEvent({ attendees: [viewer] });
  await open(typeEv); await edit(typeEv, { eventTypeId: et1b });
  await expectFields("event type -> ['Event type']", typeEv, ['Event type']);
  const meetEv = await mkEvent({ attendees: [viewer] });
  await open(meetEv); await edit(meetEv, { onlineMeetingUrl: 'https://meet.example.test/j/1', onlineMeetingPlatformLabel: 'Meet' });
  await expectFields("meeting link + platform -> ['Online meeting']", meetEv, ['Online meeting']);
  const grp = must(await svc.from('groups').insert({ tenant_id: T1, name: 'G' + stamp }).select('id').single(), 'grp').id as string;
  const invEv = await mkEvent({ attendees: [viewer] });
  await open(invEv); await edit(invEv, { target: { group_ids: [grp], member_ids: [viewer] } });   // the viewer stays invited (a target change re-syncs attendees)
  await expectFields("invitee selector -> ['Invitees']", invEv, ['Invitees']);
  const course = must(await svc.from('courses').insert({ tenant_id: T1, name: 'C' + stamp, sequence_order: 1 }).select('id').single(), 'course').id;
  const mod = must(await svc.from('modules').insert({ tenant_id: T1, course_id: course, name: 'M', sequence_order: 1 }).select('id').single(), 'mod').id;
  const talk = must(await svc.from('talks').insert({ tenant_id: T1, module_id: mod, name: 'Ta', sequence_order: 1, for_single_men: true }).select('id').single(), 'talk').id;
  const talkEv = await mkEvent({ attendees: [viewer] });
  await open(talkEv); await edit(talkEv, { talkId: talk });
  await expectFields("talk -> ['Talk']", talkEv, ['Talk']);

  const noopEv = await mkEvent({ attendees: [viewer], name: 'NoOp-' + stamp });
  await open(noopEv); await edit(noopEv, { name: 'NoOp-' + stamp });
  check('a no-op edit still bumped the version (so the event is modified)', (await seen(noopEv)).isModified === true);
  await expectFields("a no-op edit (nothing differs) -> ['Details']", noopEv, ['Details']);

  console.log(' missing audit entries never error:');
  const gapEv = await mkEvent({ attendees: [viewer] });
  await open(gapEv);
  const v0 = await evVersion(gapEv);
  must(await svc.from('events').update({ version: v0 + 3 }).eq('id', gapEv).select('id'), 'direct bump');
  await expectFields("version moved by 3 with NO audit entries at all -> ['Tasks'] (no error)", gapEv, ['Tasks']);
  const gap2 = await mkEvent({ attendees: [viewer] });
  await open(gap2);
  await edit(gap2, { name: 'Gap2 ' + stamp });
  const v2 = await evVersion(gap2);
  must(await svc.from('events').update({ version: v2 + 2 }).eq('id', gap2).select('id'), 'direct bump 2');
  await expectFields("audited edit + unaudited bumps -> ['Name','Tasks']", gap2, ['Name', 'Tasks']);

  console.log(' query count:');
  const origFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => { if (String(input instanceof Request ? input.url : input).startsWith(URL_)) calls++; return origFetch(input, init); }) as typeof fetch;
  const countListCalls = async () => { calls = 0; const rows = await listEventsForMember(T1, viewer, 'MEMBER'); return { calls, n: rows.length, modified: rows.filter((r: { is_modified: boolean }) => r.is_modified).length }; };
  const lowMod = await countListCalls();
  for (let i = 0; i < 20; i++) {
    const id = await mkEvent({ attendees: [viewer] });
    await open(id); await edit(id, { name: `Bulk ${i} ${stamp}` });
  }
  const highMod = await countListCalls();
  globalThis.fetch = origFetch;
  console.log(`  (member list: ${lowMod.n} events / ${lowMod.modified} modified -> ${lowMod.calls} requests; ${highMod.n} / ${highMod.modified} modified -> ${highMod.calls} requests)`);
  check('database requests for the member list do not grow with the number of modified events', highMod.modified >= lowMod.modified + 20 && highMod.calls === lowMod.calls, JSON.stringify({ lowMod, highMod }));

  // ============================================================ needs_attention_tasks
  console.log('\n=== needs_attention_tasks (only owner / Admin; only current refusals)');
  const alpha = await task('Alpha2'), beta = await task('Beta2'), gamma = await task('Gamma2');
  const naEv = await mkEvent({ attendees: [R, R2, R3, viewer, otherLeader] });
  const aA = (await createTaskAssignment(T1, { eventId: naEv, taskId: alpha, assignee: { member_ids: [R] } }, admin)).id;
  const aB = (await createTaskAssignment(T1, { eventId: naEv, taskId: beta, assignee: { member_ids: [R2] } }, admin)).id;
  const aG = (await createTaskAssignment(T1, { eventId: naEv, taskId: gamma, assignee: { member_ids: [R3] } }, admin)).id;
  const callers: [string, string, Role][] = [['admin', admin, 'ADMIN'], ['owner', owner, 'LEADER'], ['otherLeader', otherLeader, 'LEADER'], ['plain member', viewer, 'MEMBER'], ['the refuser', R, 'MEMBER']];
  const naOf = async (id: string, role: Role, ev = naEv) => {
    const d = await getEventById(ev, T1, id, role);
    const l = (await listEventsForMember(T1, id, role)).find((e: { id: string }) => e.id === ev) as unknown as { needs_attention: boolean; needs_attention_tasks: string[] } | undefined;
    return { dn: d.needs_attention as boolean, dt: d.needs_attention_tasks as string[], ln: l?.needs_attention, lt: l?.needs_attention_tasks };
  };
  const expectTasks = async (label: string, expectedForPrivileged: string[]) => {
    let ok = true; const seenValues: Record<string, unknown> = {};
    for (const [name, id, role] of callers) {
      const priv = name === 'admin' || name === 'owner';
      const exp = priv ? expectedForPrivileged : [];
      const r = await naOf(id, role);
      seenValues[name] = r;
      const consistent = r.dn === (exp.length > 0) && r.ln === (exp.length > 0);   // flag true iff names exist
      if (!(eq(r.dt, exp) && eq(r.lt, exp) && consistent)) ok = false;
    }
    check(label, ok, JSON.stringify(seenValues));
  };
  await expectTasks('no refusals: [] for everyone, flag false', []);
  await submitTaskAssignmentResponse(T1, R, aA, 'REFUSED');
  await submitTaskAssignmentResponse(T1, R2, aB, 'COMMITTED');
  await submitTaskAssignmentResponse(T1, R3, aG, 'REFUSED');
  await expectTasks("two tasks refused, one committed: owner/Admin get the two refused names (sorted, 'Beta' not listed); others []", [taskName('Alpha2'), taskName('Gamma2')]);
  await submitTaskAssignmentResponse(T1, R, aA, 'COMMITTED');
  await expectTasks('a refuser changes to Commit: that task disappears from the list', [taskName('Gamma2')]);
  await updateTaskAssignment(aG, T1, { assignee: { member_ids: [spare] } }, admin);
  await expectTasks('the refuser is REPLACED: refusal cleared, list empty, flag false', []);
  await submitTaskAssignmentResponse(T1, R2, aB, 'REFUSED');
  await expectTasks('a new refusal is listed', [taskName('Beta2')]);
  await removeMember(R2, T1, 'DEACTIVATED');
  await expectTasks('the refuser is REMOVED (FP-234/FP-235): refusal cleared, list empty', []);

  console.log(' a refusal whose person no longer resolves through their group:');
  const grpTaskEv = await mkEvent({ attendees: [viewer] });
  const gM = (await mkMember(T1, 'GroupMember', 'MEMBER')).id;
  const gId = must(await svc.from('groups').insert({ tenant_id: T1, name: 'GM' + stamp }).select('id').single(), 'gid').id as string;
  const membership = must(await svc.from('assignments').insert({ tenant_id: T1, member_id: gM, assignment_type: 'GROUP', group_id: gId }).select('id').single(), 'membership').id as string;
  const gTask = await task('Delta');
  const gAsg = (await createTaskAssignment(T1, { eventId: grpTaskEv, taskId: gTask, assignee: { group_ids: [gId] } }, admin)).id;
  await submitTaskAssignmentResponse(T1, gM, gAsg, 'REFUSED');
  const withGroup = await getEventById(grpTaskEv, T1, admin, 'ADMIN');
  check('refusal by a group member is listed while they are in the group', withGroup.needs_attention === true && eq(withGroup.needs_attention_tasks, [taskName('Delta')]));
  must(await svc.from('assignments').update({ deleted_at: new Date().toISOString() }).eq('id', membership).select('id'), 'leave group');
  const afterLeave = await getEventById(grpTaskEv, T1, admin, 'ADMIN');
  check('after they leave the group the flag AND the names agree: false / []', afterLeave.needs_attention === false && eq(afterLeave.needs_attention_tasks, []));
  const rpc = await svc.rpc('events_with_outstanding_refusals', { p_tenant_id: T1, p_event_ids: [naEv, grpTaskEv] });
  const rpcIds = new Set(((rpc.data ?? []) as { event_id: string }[]).map((r) => r.event_id));
  const helper = await listRefusedTaskNamesByEvent(T1, [naEv, grpTaskEv]);
  check('the TypeScript resolution and the SQL function never disagree (same set of events)', eq([...rpcIds].sort(), [...helper.keys()].sort()), JSON.stringify({ rpc: [...rpcIds], helper: [...helper.keys()] }));

  // ============================================================ refused_by
  console.log('\n=== refused_by on the assignments endpoint (service)');
  const rbEv = await mkEvent({ attendees: [R, R3, viewer] });
  const rbA = (await createTaskAssignment(T1, { eventId: rbEv, taskId: await task('RbA'), assignee: { member_ids: [R] } }, admin)).id;
  const rbB = (await createTaskAssignment(T1, { eventId: rbEv, taskId: await task('RbB'), assignee: { member_ids: [R3] } }, admin)).id;
  await submitTaskAssignmentResponse(T1, R, rbA, 'REFUSED');
  await submitTaskAssignmentResponse(T1, R3, rbB, 'REFUSED');
  const rbOf = async (id: string, role: Role) => await listTaskAssignmentsForEventWithRefusals(rbEv, T1, { memberId: id, role });
  for (const [name, id, role] of callers) {
    const rows = await rbOf(id, role);
    const priv = name === 'admin' || name === 'owner';
    const a = rows.find((r) => r.id === rbA), b = rows.find((r) => r.id === rbB);
    const ok = priv
      ? eq(a?.refused_by, [{ member_id: R, name: 'Refuser Tester' }]) && eq(b?.refused_by, [{ member_id: R3, name: 'RefuserThree Tester' }])
      : rows.length === 2 && rows.every((r) => Array.isArray(r.refused_by) && r.refused_by.length === 0);
    check(`${name}: refused_by ${priv ? 'filled with first + last names' : 'is an empty array on every row'}`, ok, JSON.stringify(rows.map((r) => r.refused_by)));
  }
  await submitTaskAssignmentResponse(T1, R, rbA, 'COMMITTED');
  const afterCommit = await rbOf(owner, 'LEADER');
  check('a refusal changed to Commit is no longer listed', eq(afterCommit.find((r) => r.id === rbA)?.refused_by, []) && afterCommit.find((r) => r.id === rbB)?.refused_by.length === 1);
  await updateTaskAssignment(rbB, T1, { assignee: { member_ids: [spare] } }, admin);
  check('a replaced person is no longer listed', eq((await rbOf(admin, 'ADMIN')).find((r) => r.id === rbB)?.refused_by, []));
  await submitTaskAssignmentResponse(T1, spare, rbB, 'REFUSED');
  await removeMember(spare, T1, 'DEACTIVATED');
  const afterRemoval = await rbOf(admin, 'ADMIN');
  check('a removed member is no longer listed (their emptied task was pruned away with them)', (afterRemoval.find((r) => r.id === rbB)?.refused_by ?? []).length === 0 && afterRemoval.every((r) => r.refused_by.every((x) => x.member_id !== spare)));
  check('an event with no assignments -> empty list, no error', (await listTaskAssignmentsForEventWithRefusals(await mkEvent({ attendees: [viewer] }), T1, { memberId: owner, role: 'LEADER' })).length === 0);

  // ============================================================ routes (real JWTs)
  console.log('\n=== Routes (real handlers, real JWTs)');
  const anonClient = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  async function loginAs(first: string, role: Role, tenantId = T1) {
    const m = await mkMember(tenantId, first, role, true);
    const { data: sess, error } = await anonClient.auth.signInWithPassword({ email: m.email, password: 'Pw-12345-abcde' });
    if (error || !sess.session) throw error ?? new Error('no session');
    return { id: m.id, token: sess.session.access_token };
  }
  const rOwner = await loginAs('RouteOwner', 'LEADER');
  const rAdmin = await loginAs('RouteAdmin', 'ADMIN');
  const rMember = await loginAs('RouteMember', 'MEMBER');
  const rRefuser = await loginAs('RouteRefuser', 'MEMBER');
  const routeEv = await mkEvent({ owner: rOwner.id, attendees: [rMember.id, rRefuser.id] });
  const routeTask = await task('RouteTask');
  const routeAsg = (await createTaskAssignment(T1, { eventId: routeEv, taskId: routeTask, assignee: { member_ids: [rRefuser.id] } }, admin)).id;
  await submitTaskAssignmentResponse(T1, rRefuser.id, routeAsg, 'REFUSED');
  const req = (method: string, url: string, token?: string, body?: string) =>
    new NextRequest(new URL(url, 'http://localhost'), { method, headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {}, body });
  for (const [name, who, expectNames] of [['owner', rOwner, true], ['Admin', rAdmin, true], ['plain member', rMember, false], ['the refuser', rRefuser, false]] as const) {
    const res = await assignmentsGET(req('GET', `/api/event-tasks-assignments?event_id=${routeEv}`, who.token));
    const body = await res.json();
    const row = (body.data as { id: string; refused_by: { member_id: string; name: string }[] }[]).find((r) => r.id === routeAsg);
    check(`GET /api/event-tasks-assignments as ${name}: refused_by ${expectNames ? 'lists the refuser' : '= []'}`,
      res.status === 200 && (expectNames ? eq(row?.refused_by, [{ member_id: rRefuser.id, name: 'RouteRefuser Tester' }]) : eq(row?.refused_by, [])), JSON.stringify(row));
  }
  const viewRes = await viewPOST(req('POST', `/api/events/${routeEv}/view`, rMember.token, JSON.stringify({ version: 99999 })), { params: Promise.resolve({ id: routeEv }) });
  const viewBody = await viewRes.json();
  check('POST /api/events/:id/view -> 200 with the standard envelope { data: { version } } (clamped to the current version)', viewRes.status === 200 && viewBody?.data?.version === (await evVersion(routeEv)), JSON.stringify(viewBody));

  // ============================================================ web list marker
  console.log('\n=== Web events list: Needs attention marker');
  const TL = must(await svc.from('tenants').insert({ name: 'ADJ1-LIST-' + stamp }).select('id').single(), 'TL').id as string;
  const etL = must(await svc.from('event_types').insert({ tenant_id: TL, name: 'ET', code: 'L' + (stamp % 1000) }).select('id').single(), 'etL').id as string;
  const lAdmin = (await mkMember(TL, 'LAdmin', 'ADMIN')).id;
  const lOwner = (await mkMember(TL, 'LOwner', 'LEADER')).id;
  const lOther = (await mkMember(TL, 'LOther', 'LEADER')).id;
  const lMember = (await mkMember(TL, 'LMember', 'MEMBER')).id;
  const lRef = (await mkMember(TL, 'LRef', 'MEMBER')).id;
  const lTask = await task('ListTask', TL);
  const lTask2 = await task('ListTask2', TL);
  const mkL = async (name: string, owner: string, status: string, startDays: number, withRefusal: boolean, tasks: string[] = [lTask]) => {
    const id = await mkEvent({ tenant: TL, type: etL, owner, status, startOffsetDays: startDays, name });
    if (withRefusal) {
      for (const t of tasks) {
        const a = must(await svc.from('event_tasks_assignments').insert({ tenant_id: TL, event_id: id, task_id: t, assignee: { member_ids: [lRef] } }).select('id').single(), 'asg') as { id: string };
        must(await svc.from('event_task_assignment_responses').insert({ tenant_id: TL, assignment_id: a.id, event_id: id, task_id: t, member_id: lRef, status: 'REFUSED' }).select('id'), 'ref');
      }
    }
    return id;
  };
  const LA = await mkL('LA live owner1 refusal', lOwner, 'SCHEDULED', 1, true, [lTask, lTask2]);
  const LB = await mkL('LB live owner2 refusal', lOther, 'SCHEDULED', 2, true);
  const LC = await mkL('LC cancelled refusal', lOwner, 'CANCELLED', 3, true);
  const LD = await mkL('LD draft refusal', lOwner, 'DRAFT', 4, true);
  const LE = await mkL('LE ended refusal', lOwner, 'SCHEDULED', -30, true);
  const LF = await mkL('LF live no refusal', lOwner, 'SCHEDULED', 5, false);
  const rowsFor = async (viewerArg: { memberId: string; role: Role } | undefined, opts: Record<string, unknown> = {}) => {
    const res = await listEvents(TL, { limit: 100, viewer: viewerArg, ...opts });
    return new Map((res.data as unknown as { id: string; needs_attention: boolean; needs_attention_tasks: string[] }[]).map((r) => [r.id, r]));
  };
  const marked = (m: Map<string, { needs_attention: boolean }>) => ({ LA: m.get(LA)?.needs_attention, LB: m.get(LB)?.needs_attention, LC: m.get(LC)?.needs_attention, LD: m.get(LD)?.needs_attention, LE: m.get(LE)?.needs_attention, LF: m.get(LF)?.needs_attention });
  const adminRows = await rowsFor({ memberId: lAdmin, role: 'ADMIN' });
  check('Admin: true for both live events with a refusal; false for cancelled, draft, ended and no-refusal', eq(marked(adminRows), { LA: true, LB: true, LC: false, LD: false, LE: false, LF: false }), JSON.stringify(marked(adminRows)));
  check("the marker names the refused tasks ('ListTask, ListTask2' sorted)", eq(adminRows.get(LA)?.needs_attention_tasks, [taskName('ListTask'), taskName('ListTask2')]) && eq(adminRows.get(LB)?.needs_attention_tasks, [taskName('ListTask')]) && eq(adminRows.get(LF)?.needs_attention_tasks, []));
  const ownerRows = await rowsFor({ memberId: lOwner, role: 'LEADER' });
  check('owning Leader: true only for the live event they own that has a refusal', eq(marked(ownerRows), { LA: true, LB: false, LC: false, LD: false, LE: false, LF: false }), JSON.stringify(marked(ownerRows)));
  const otherRows = await rowsFor({ memberId: lOther, role: 'LEADER' });
  check('a Leader who owns a different event: true only for their own', eq(marked(otherRows), { LA: false, LB: true, LC: false, LD: false, LE: false, LF: false }), JSON.stringify(marked(otherRows)));
  const memberRows = await rowsFor({ memberId: lMember, role: 'MEMBER' });
  check('a plain member: false everywhere', Object.values(marked(memberRows)).every((v) => v === false));
  const noViewerRows = await rowsFor(undefined);
  check('no viewer (other callers of listEvents): false / [] everywhere', Object.values(marked(noViewerRows)).every((v) => v === false) && [...noViewerRows.values()].every((r) => r.needs_attention_tasks.length === 0));
  check('rows carry no owner_member_id (internal only)', [...adminRows.values()].every((r) => !('owner_member_id' in r)));

  const statusRows = await rowsFor({ memberId: lAdmin, role: 'ADMIN' }, { status: ['SCHEDULED'] });
  check('the status-filter path marks the same way', eq([statusRows.get(LA)?.needs_attention, statusRows.get(LB)?.needs_attention, statusRows.get(LF)?.needs_attention, statusRows.has(LC)], [true, true, false, false]));
  const page1 = await listEvents(TL, { limit: 2, offset: 0, viewer: { memberId: lAdmin, role: 'ADMIN' } });
  const page2 = await listEvents(TL, { limit: 2, offset: 2, viewer: { memberId: lAdmin, role: 'ADMIN' } });
  const ids = [...page1.data, ...page2.data].map((r) => r.id);
  check('pagination still works (2 + 2 rows, no overlap, hasMore true while more remain)', page1.data.length === 2 && page2.data.length === 2 && new Set(ids).size === 4 && page1.hasMore === true);
  const dateOrder = (await listEvents(TL, { limit: 100, viewer: { memberId: lAdmin, role: 'ADMIN' } })).data.map((r) => r.start_datetime);
  check('sorting by start time is unchanged', eq(dateOrder, [...dateOrder].sort()));

  const lr = await loginAs('ListRouteAdmin', 'ADMIN', TL);
  const listRes = await listGET(req('GET', '/api/events?limit=100', lr.token));
  const listBody = await listRes.json();
  const laRow = (listBody.data as { id: string; needs_attention: boolean; needs_attention_tasks: string[] }[]).find((r) => r.id === LA);
  check('GET /api/events (the table\'s infinite-scroll feed) carries the marker data for an Admin', listRes.status === 200 && laRow?.needs_attention === true && laRow.needs_attention_tasks.length === 2);

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => { if (String(input instanceof Request ? input.url : input).startsWith(URL_)) calls++; return origFetch(input, init); }) as typeof fetch;
  const listCalls = async (limit: number) => { calls = 0; const r = await listEvents(TL, { limit, viewer: { memberId: lAdmin, role: 'ADMIN' } }); return { calls, rows: r.data.length, marked: r.data.filter((x) => x.needs_attention).length }; };
  const smallPage = await listCalls(3);
  for (let i = 0; i < 30; i++) await mkL(`Filler ${i} ${stamp}`, lOwner, 'SCHEDULED', 10 + i, i % 5 === 0);
  const bigPage = await listCalls(40);
  globalThis.fetch = origFetch;
  console.log(`  (list page of ${smallPage.rows} rows / ${smallPage.marked} marked -> ${smallPage.calls} requests; ${bigPage.rows} rows / ${bigPage.marked} marked -> ${bigPage.calls} requests)`);
  check('database requests for a page of rows do not grow with the number of rows (or marked rows)', bigPage.rows > smallPage.rows + 20 && bigPage.marked > smallPage.marked && bigPage.calls === smallPage.calls, JSON.stringify({ smallPage, bigPage }));

  // ============================================================ version-bump sources
  console.log('\n=== Every events.version bump source is accounted for');
  let catalog = '';
  try {
    catalog = execFileSync('docker', ['exec', '-i', 'supabase_db_flockpulse-web', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-F', '|', '-c',
      "select proname, (prosrc ~* 'write_audit_log') from pg_proc where pronamespace = 'public'::regnamespace and prosrc ~* 'version\\s*=\\s*(events|e)\\.version\\s*\\+\\s*1' order by 1"], { encoding: 'utf8' }).trim();
  } catch (e) { catalog = 'ERROR ' + (e as Error).message; }
  const found = catalog.split('\n').filter(Boolean).map((l) => { const [name, audits] = l.split('|'); return { name, audits: audits === 't' }; });
  const known = [...AUDITED_VERSION_BUMP_SOURCES, ...NON_AUDITED_VERSION_BUMP_SOURCES].slice().sort();
  check('the database functions that bump events.version are exactly the documented sources (a NEW bump source fails this)',
    eq(found.map((f) => f.name).sort(), known), JSON.stringify({ found: found.map((f) => f.name), known }));
  check('every audited source writes an audit entry', AUDITED_VERSION_BUMP_SOURCES.every((n) => found.find((f) => f.name === n)?.audits === true));
  check('no non-audited source writes an audit entry (else its bumps would be double counted)', NON_AUDITED_VERSION_BUMP_SOURCES.every((n) => found.find((f) => f.name === n)?.audits === false));
  console.log(`  audited: ${AUDITED_VERSION_BUMP_SOURCES.join(', ')}   non-audited: ${NON_AUDITED_VERSION_BUMP_SOURCES.join(', ')}`);

  console.log(`\n${passed}/${passed + failed} checks passed${failed ? '  (' + failed + ' FAILED)' : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST SCRIPT ERROR', e); process.exit(1); });
