/**
 * DIP-FP-58-FP-59-FP-62 verification: Event Management Foundation.
 *
 * GROUP 1 — FP-58: Event Type CRUD
 *   1.1  createEventType() happy path — row created, code stored
 *   1.2  listEventTypes() includes the new type
 *   1.3  Duplicate code in same tenant → VALIDATION_ERROR (unique index collision)
 *   1.4  updateEventType() renames and soft-deletes — excluded from listEventTypes() after
 *   1.5  updateEventType() on a nonexistent id → NOT_FOUND
 *
 * GROUP 2 — FP-62: multi-group/multi-member event targeting
 *   2.1  target={group_ids:[G1,G2]} — attendees = union of both groups' members
 *   2.2  target={group_ids:[G1], member_ids:[M4]} — group members + explicit member
 *   2.3  Dedup: a member in both a targeted group and member_ids appears once (no conflict error)
 *   2.4  Cross-tenant safety: a group_id from a different tenant contributes zero attendees
 *   2.5  Cross-tenant safety: a member_id from a different tenant contributes zero attendees
 *   2.6  "Everyone" is not a special case — a group containing every member works via the same path
 *
 * GROUP 3 — FP-59: talkId/actorMemberId wiring (service-layer verification —
 *   this codebase's test scripts exercise the service/RPC layer, never the HTTP route layer;
 *   the route change itself is a thin body-destructure pass-through verified manually against
 *   the Vercel preview per the DIP's stop point)
 *   3.1  createEvent() with talkId + actorMemberId — events.talk_id stored, audit_logs.actor_id
 *        stored on the 'event'/'create' entry (previously always NULL)
 *
 * Run: npx tsx scripts/test-fp58-59-62-event-management-foundation.ts
 * Requires local Supabase running.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { execSync } from 'child_process';

const TENANT_1 = '00000000-0000-0000-0000-000000000001';
const TENANT_2 = '00000000-0000-0000-0000-000000000002';

function psql(sql: string) {
  execSync(`docker exec -i supabase_db_flockpulse-web psql -U postgres -d postgres`, {
    input: sql, stdio: ['pipe', 'inherit', 'pipe'],
  });
}
function psqlQuery(sql: string): string {
  return execSync(`docker exec -i supabase_db_flockpulse-web psql -U postgres -d postgres -t`, {
    input: sql, stdio: ['pipe', 'pipe', 'pipe'],
  }).toString().trim();
}
function psqlQueryRows(sql: string): string[] {
  return psqlQuery(sql).split('\n').map(s => s.trim()).filter(Boolean);
}

type Result = { name: string; passed: boolean; detail: string };
const results: Result[] = [];
function pass(name: string, detail: string) {
  results.push({ name, passed: true, detail });
  console.log(`  ✅ PASSED: ${name}\n     ${detail}`);
}
function fail(name: string, detail: string) {
  results.push({ name, passed: false, detail });
  console.error(`  ❌ FAILED: ${name}\n     ${detail}`);
}

async function main() {
  const { createEventType, updateEventType, listEventTypes } = await import(
    '../src/features/event-types/event-type.service'
  );
  const { createEvent, publishEvent } = await import('../src/features/events/service');

  // ── GROUP 1: FP-58 Event Type CRUD ─────────────────────────────────────────

  console.log('\n── GROUP 1: FP-58 Event Type CRUD ──');

  console.log('\n1.1: createEventType() happy path');
  let et1Id: string | null = null;
  try {
    const et = await createEventType(TENANT_1, { name: 'Retreat', code: 'FP58_RETREAT' });
    et1Id = et.id;
    et.code === 'FP58_RETREAT' && et.name === 'Retreat'
      ? pass('1.1 create happy path', `event_type id=${et.id}, code=${et.code}`)
      : fail('1.1 create happy path', `unexpected row: ${JSON.stringify(et)}`);
  } catch (e) { fail('1.1 create happy path', (e as Error).message); }

  console.log('\n1.2: listEventTypes() includes the new type');
  try {
    const list = await listEventTypes(TENANT_1);
    list.some(e => e.id === et1Id)
      ? pass('1.2 list includes new type', `found in list of ${list.length} types`)
      : fail('1.2 list includes new type', `not found among ${list.length} types`);
  } catch (e) { fail('1.2 list includes new type', (e as Error).message); }

  console.log('\n1.3: Duplicate code in same tenant → VALIDATION_ERROR');
  try {
    await createEventType(TENANT_1, { name: 'Retreat 2', code: 'FP58_RETREAT' });
    fail('1.3 duplicate code rejected', 'no error thrown — unique index did not fire');
  } catch (e) {
    (e as { code?: string }).code === 'VALIDATION_ERROR'
      ? pass('1.3 duplicate code rejected', `threw VALIDATION_ERROR: ${(e as Error).message}`)
      : fail('1.3 duplicate code rejected', `wrong code: ${(e as { code?: string }).code}`);
  }

  console.log('\n1.4: updateEventType() renames and soft-deletes');
  if (et1Id) {
    try {
      const now = new Date().toISOString();
      const updated = await updateEventType(et1Id, TENANT_1, { name: 'Retreat (renamed)', deletedAt: now });
      const list = await listEventTypes(TENANT_1);
      const stillListed = list.some(e => e.id === et1Id);
      updated.name === 'Retreat (renamed)' && updated.deleted_at !== null && !stillListed
        ? pass('1.4 update + soft-delete', `renamed and excluded from active list`)
        : fail('1.4 update + soft-delete', `name=${updated.name}, deleted_at=${updated.deleted_at}, stillListed=${stillListed}`);
    } catch (e) { fail('1.4 update + soft-delete', (e as Error).message); }
  }

  console.log('\n1.5: updateEventType() on nonexistent id → NOT_FOUND');
  try {
    await updateEventType('00000000-dead-dead-dead-000000000000', TENANT_1, { name: 'x' });
    fail('1.5 nonexistent id → NOT_FOUND', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'NOT_FOUND'
      ? pass('1.5 nonexistent id → NOT_FOUND', `threw NOT_FOUND`)
      : fail('1.5 nonexistent id → NOT_FOUND', `wrong code: ${(e as { code?: string }).code}`);
  }

  // ── GROUP 2: FP-62 multi-group/multi-member targeting ──────────────────────

  console.log('\n── GROUP 2: FP-62 multi-group/multi-member targeting ──');

  const genEventTypeId = psqlQuery(`SELECT id FROM event_types WHERE tenant_id = '${TENANT_1}' AND code = 'GENERAL' LIMIT 1`);

  function newUuid(): string {
    return psqlQuery(`SELECT gen_random_uuid()`);
  }

  function makeGroup(name: string, tenantId: string): string {
    const id = newUuid();
    psql(`INSERT INTO groups (id, tenant_id, name) VALUES ('${id}', '${tenantId}', '${name}');`);
    return id;
  }

  function makeMember(name: string, tenantId: string): string {
    const id = newUuid();
    const userId = newUuid();
    psql(`
      INSERT INTO members (id, tenant_id, user_id, email, role, first_name, last_name, gender, marital_status, birthdate)
      VALUES ('${id}', '${tenantId}', '${userId}', '${name.toLowerCase()}@fp62.t', 'MEMBER', '${name}', 'Test', 'MALE', 'SINGLE', '1990-01-01');
    `);
    return id;
  }

  // Fixtures: tenant 1 — two groups, four members.
  const g1 = makeGroup('FP62 Group 1', TENANT_1);
  const g2 = makeGroup('FP62 Group 2', TENANT_1);
  const everyoneGroup = makeGroup('FP62 Everyone', TENANT_1);

  const m1 = makeMember('FP62M1', TENANT_1);
  const m2 = makeMember('FP62M2', TENANT_1);
  const m3 = makeMember('FP62M3', TENANT_1);
  const m4 = makeMember('FP62M4', TENANT_1);

  psql(`
    INSERT INTO assignments (tenant_id, member_id, assignment_type, group_id) VALUES
    ('${TENANT_1}', '${m1}', 'GROUP', '${g1}'),
    ('${TENANT_1}', '${m2}', 'GROUP', '${g1}'),
    ('${TENANT_1}', '${m3}', 'GROUP', '${g2}'),
    ('${TENANT_1}', '${m1}', 'GROUP', '${everyoneGroup}'),
    ('${TENANT_1}', '${m2}', 'GROUP', '${everyoneGroup}'),
    ('${TENANT_1}', '${m3}', 'GROUP', '${everyoneGroup}'),
    ('${TENANT_1}', '${m4}', 'GROUP', '${everyoneGroup}');
  `);

  // Fixtures: tenant 2 — separate group + member, for cross-tenant safety checks.
  const gX = makeGroup('FP62 Tenant2 Group', TENANT_2);
  const mX = makeMember('FP62MX', TENANT_2);
  psql(`INSERT INTO assignments (tenant_id, member_id, assignment_type, group_id) VALUES ('${TENANT_2}', '${mX}', 'GROUP', '${gX}');`);

  const createdEventIds: string[] = [];

  async function publishAndGetAttendees(target: Record<string, unknown>): Promise<string[]> {
    const future = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 90000000).toISOString();
    const ev = await createEvent({
      tenantId: TENANT_1,
      eventTypeId: genEventTypeId,
      name: 'FP-62 targeting test',
      startDatetime: future,
      endDatetime: futureEnd,
      locationName: 'Test Venue',
      target,
    });
    createdEventIds.push(ev.id);
    await publishEvent(ev.id, TENANT_1);
    return psqlQueryRows(`SELECT member_id FROM event_attendees WHERE event_id = '${ev.id}' ORDER BY member_id`);
  }

  console.log('\n2.1: target={group_ids:[G1,G2]} — attendees = union of both groups');
  try {
    const attendees = await publishAndGetAttendees({ group_ids: [g1, g2] });
    const expected = [m1, m2, m3].sort();
    const actual = attendees.sort();
    JSON.stringify(actual) === JSON.stringify(expected)
      ? pass('2.1 multi-group union', `attendees=${actual.length}, matches G1+G2 members exactly`)
      : fail('2.1 multi-group union', `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } catch (e) { fail('2.1 multi-group union', (e as Error).message); }

  console.log('\n2.2: target={group_ids:[G1], member_ids:[M4]} — group members + explicit member');
  try {
    const attendees = await publishAndGetAttendees({ group_ids: [g1], member_ids: [m4] });
    const expected = [m1, m2, m4].sort();
    const actual = attendees.sort();
    JSON.stringify(actual) === JSON.stringify(expected)
      ? pass('2.2 group + explicit member', `attendees match G1 + M4 exactly`)
      : fail('2.2 group + explicit member', `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } catch (e) { fail('2.2 group + explicit member', (e as Error).message); }

  console.log('\n2.3: Dedup — member in both targeted group and member_ids appears once, no conflict error');
  try {
    const attendees = await publishAndGetAttendees({ group_ids: [g1, g2], member_ids: [m2] });
    const expected = [m1, m2, m3].sort();
    const actual = attendees.sort();
    const noDuplicates = new Set(actual).size === actual.length;
    JSON.stringify(actual) === JSON.stringify(expected) && noDuplicates
      ? pass('2.3 dedup', `no duplicate row for M2 despite appearing in both group_ids and member_ids`)
      : fail('2.3 dedup', `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } catch (e) { fail('2.3 dedup', (e as Error).message); }

  console.log('\n2.4: Cross-tenant safety — group_id from a different tenant contributes zero attendees');
  try {
    const attendees = await publishAndGetAttendees({ group_ids: [gX] });
    attendees.length === 0
      ? pass('2.4 cross-tenant group_id blocked', `attendees=0 — tenant-2 group contributed nothing to tenant-1 event`)
      : fail('2.4 cross-tenant group_id blocked', `expected 0 attendees, got ${JSON.stringify(attendees)}`);
  } catch (e) { fail('2.4 cross-tenant group_id blocked', (e as Error).message); }

  console.log('\n2.5: Cross-tenant safety — member_id from a different tenant contributes zero attendees');
  try {
    const attendees = await publishAndGetAttendees({ member_ids: [mX] });
    attendees.length === 0
      ? pass('2.5 cross-tenant member_id blocked', `attendees=0 — tenant-2 member did not leak into tenant-1 event`)
      : fail('2.5 cross-tenant member_id blocked', `expected 0 attendees, got ${JSON.stringify(attendees)}`);
  } catch (e) { fail('2.5 cross-tenant member_id blocked', (e as Error).message); }

  console.log('\n2.6: "Everyone" is not a special case — a group containing every member works via the same path');
  try {
    const attendees = await publishAndGetAttendees({ group_ids: [everyoneGroup] });
    const expected = [m1, m2, m3, m4].sort();
    const actual = attendees.sort();
    JSON.stringify(actual) === JSON.stringify(expected)
      ? pass('2.6 everyone-as-group', `all 4 members resolved through the ordinary group_ids path`)
      : fail('2.6 everyone-as-group', `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } catch (e) { fail('2.6 everyone-as-group', (e as Error).message); }

  // ── GROUP 3: FP-59 talkId/actorMemberId wiring (service-layer) ─────────────

  console.log('\n── GROUP 3: FP-59 talkId/actorMemberId wiring ──');

  console.log('\n3.1: createEvent() with talkId + actorMemberId — stored on event and audit log');
  try {
    const courseId = newUuid();
    psql(`INSERT INTO courses (id, tenant_id, name, sequence_order) VALUES ('${courseId}', '${TENANT_1}', 'FP59 Course', 999);`);
    const moduleId = newUuid();
    psql(`INSERT INTO modules (id, tenant_id, course_id, name, sequence_order) VALUES ('${moduleId}', '${TENANT_1}', '${courseId}', 'FP59 Module', 1);`);
    const talkId = newUuid();
    psql(`
      INSERT INTO talks (id, tenant_id, module_id, name, sequence_order, for_single_men, for_single_women, for_married_men, for_married_women)
      VALUES ('${talkId}', '${TENANT_1}', '${moduleId}', 'FP59 Talk', 1, true, true, true, true);
    `);

    const future = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 90000000).toISOString();
    const ev = await createEvent({
      tenantId: TENANT_1,
      eventTypeId: genEventTypeId,
      name: 'FP-59 talk/actor wiring test',
      startDatetime: future,
      endDatetime: futureEnd,
      locationName: 'Test Venue',
      target: {},
      talkId,
      actorMemberId: m1,
    });
    createdEventIds.push(ev.id);

    const storedTalkId = psqlQuery(`SELECT talk_id FROM events WHERE id = '${ev.id}'`);
    const auditActorId = psqlQuery(`
      SELECT actor_id FROM audit_logs WHERE entity_type = 'event' AND entity_id = '${ev.id}' AND action = 'create'
    `);

    storedTalkId === talkId && auditActorId === m1
      ? pass('3.1 talkId + actorMemberId stored', `events.talk_id=${storedTalkId}, audit_logs.actor_id=${auditActorId}`)
      : fail('3.1 talkId + actorMemberId stored', `talk_id=${storedTalkId} (expected ${talkId}), actor_id=${auditActorId} (expected ${m1})`);

    psql(`
      DELETE FROM talks WHERE id = '${talkId}';
      DELETE FROM modules WHERE id = '${moduleId}';
      DELETE FROM courses WHERE id = '${courseId}';
    `);
  } catch (e) { fail('3.1 talkId + actorMemberId stored', (e as Error).message); }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  console.log('\nCleaning up fixtures...');
  for (const eid of createdEventIds) {
    psql(`
      DELETE FROM event_notifications WHERE event_id = '${eid}';
      DELETE FROM event_attendees WHERE event_id = '${eid}';
      DELETE FROM audit_logs WHERE entity_type = 'event' AND entity_id = '${eid}';
      DELETE FROM events WHERE id = '${eid}';
    `);
  }
  if (et1Id) psql(`DELETE FROM event_types WHERE id = '${et1Id}';`);
  psql(`
    DELETE FROM assignments WHERE tenant_id IN ('${TENANT_1}', '${TENANT_2}') AND group_id IN ('${g1}', '${g2}', '${everyoneGroup}', '${gX}');
    DELETE FROM members WHERE id IN ('${m1}', '${m2}', '${m3}', '${m4}', '${mX}');
    DELETE FROM groups WHERE id IN ('${g1}', '${g2}', '${everyoneGroup}', '${gX}');
  `);

  const passed = results.filter(r => r.passed).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
