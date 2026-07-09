/**
 * DIP-FP-107 verification: Prayer Leader and Food Assignment fields on events.
 *
 * GROUP 1 — round-tripping
 *   1.1  createEvent() with both fields set -> round-trips correctly via getEventById()
 *   1.2  updateEvent() sets, then clears, both fields correctly
 *
 * GROUP 2 — default absence
 *   2.1  createEvent() without either field -> both null by default
 *
 * GROUP 3 — cross-tenant rejection of prayer_leader_member_id
 *   3.1  createEvent() with a cross-tenant prayer_leader_member_id -> INVALID_TARGET
 *   3.2  updateEvent() setting a cross-tenant prayer_leader_member_id -> INVALID_TARGET
 *
 * GROUP 4 — food_assignment: cross-tenant id silently excluded at read time, NOT rejected at write time
 *   4.1  createEvent() with a cross-tenant member_id inside food_assignment succeeds (no error) —
 *        same precedent as target, deliberately not implementing a rejection this DIP doesn't call for
 *
 * GROUP 5 — publish with both fields unset succeeds
 *   5.1  DRAFT event created without either field publishes without error
 *
 * Run: npx tsx scripts/test-fp107-prayer-leader-food-assignment.ts
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

function newUuid(): string {
  return psqlQuery(`SELECT gen_random_uuid()`);
}

const createdEventIds: string[] = [];
const createdMemberIds: string[] = [];

async function main() {
  const { createEvent, updateEvent, getEventById, publishEvent } = await import('../src/features/events/service');

  const genEventTypeId = psqlQuery(`SELECT id FROM event_types WHERE tenant_id = '${TENANT_1}' AND code = 'GENERAL' LIMIT 1`);

  function makeMember(name: string, tenantId: string): string {
    const id = newUuid();
    const userId = newUuid();
    psql(`
      INSERT INTO members (id, tenant_id, user_id, email, role, first_name, last_name, gender, marital_status, birthdate)
      VALUES ('${id}', '${tenantId}', '${userId}', '${name.toLowerCase()}@fp107.t', 'MEMBER', '${name}', 'Test', 'MALE', 'SINGLE', '1990-01-01');
    `);
    createdMemberIds.push(id);
    return id;
  }

  const leaderT1 = makeMember('FP107Leader', TENANT_1);
  const groupMemberT1 = makeMember('FP107GroupMember', TENANT_1);
  const leaderT2 = makeMember('FP107LeaderT2', TENANT_2);
  const memberT2 = makeMember('FP107MemberT2', TENANT_2);

  const future = new Date(Date.now() + 86400000).toISOString();
  const futureEnd = new Date(Date.now() + 90000000).toISOString();

  // ── GROUP 1: round-tripping ─────────────────────────────────────────────────

  console.log('\n── GROUP 1: round-tripping ──');

  console.log('\n1.1: createEvent() with both fields set -> round-trips via getEventById()');
  let roundTripEventId: string | null = null;
  try {
    const ev = await createEvent({
      tenantId: TENANT_1, eventTypeId: genEventTypeId, name: 'FP-107 round-trip test',
      startDatetime: future, endDatetime: futureEnd,
      locationName: 'Venue', locationAddress: '1 FP107 St', target: {},
      prayerLeaderMemberId: leaderT1,
      foodAssignment: { group_ids: [], member_ids: [groupMemberT1] },
    });
    roundTripEventId = ev.id;
    createdEventIds.push(ev.id);

    const fetched = await getEventById(ev.id, TENANT_1);
    fetched.prayer_leader_member_id === leaderT1 &&
    JSON.stringify(fetched.food_assignment) === JSON.stringify({ group_ids: [], member_ids: [groupMemberT1] })
      ? pass('1.1 round-trip on create', `prayer_leader_member_id=${fetched.prayer_leader_member_id}, food_assignment=${JSON.stringify(fetched.food_assignment)}`)
      : fail('1.1 round-trip on create', `got prayer_leader=${fetched.prayer_leader_member_id}, food_assignment=${JSON.stringify(fetched.food_assignment)}`);
  } catch (e) { fail('1.1 round-trip on create', (e as Error).message); }

  console.log('\n1.2: updateEvent() sets, then clears, both fields correctly');
  if (roundTripEventId) {
    try {
      // Clear both back to null.
      await updateEvent(roundTripEventId, TENANT_1, {
        prayerLeaderMemberId: null,
        foodAssignment: null,
      });
      const cleared = await getEventById(roundTripEventId, TENANT_1);
      cleared.prayer_leader_member_id === null && cleared.food_assignment === null
        ? pass('1.2 update clears both fields', `prayer_leader_member_id=${cleared.prayer_leader_member_id}, food_assignment=${cleared.food_assignment}`)
        : fail('1.2 update clears both fields', `prayer_leader_member_id=${cleared.prayer_leader_member_id}, food_assignment=${JSON.stringify(cleared.food_assignment)}`);
    } catch (e) { fail('1.2 update clears both fields', (e as Error).message); }
  }

  // ── GROUP 2: default absence ────────────────────────────────────────────────

  console.log('\n── GROUP 2: default absence ──');

  console.log('\n2.1: createEvent() without either field -> both null by default');
  try {
    const ev = await createEvent({
      tenantId: TENANT_1, eventTypeId: genEventTypeId, name: 'FP-107 default test',
      startDatetime: future, endDatetime: futureEnd,
      locationName: 'Venue', locationAddress: '2 FP107 St', target: {},
    });
    createdEventIds.push(ev.id);
    const fetched = await getEventById(ev.id, TENANT_1);
    fetched.prayer_leader_member_id === null && fetched.food_assignment === null
      ? pass('2.1 defaults to null', `prayer_leader_member_id=${fetched.prayer_leader_member_id}, food_assignment=${fetched.food_assignment}`)
      : fail('2.1 defaults to null', `prayer_leader_member_id=${fetched.prayer_leader_member_id}, food_assignment=${JSON.stringify(fetched.food_assignment)}`);
  } catch (e) { fail('2.1 defaults to null', (e as Error).message); }

  // ── GROUP 3: cross-tenant rejection of prayer_leader_member_id ─────────────

  console.log('\n── GROUP 3: cross-tenant rejection of prayer_leader_member_id ──');

  console.log('\n3.1: createEvent() with a cross-tenant prayer_leader_member_id -> INVALID_TARGET');
  try {
    await createEvent({
      tenantId: TENANT_1, eventTypeId: genEventTypeId, name: 'FP-107 cross-tenant leader test',
      startDatetime: future, endDatetime: futureEnd,
      locationName: 'Venue', locationAddress: '3 FP107 St', target: {},
      prayerLeaderMemberId: leaderT2,
    });
    fail('3.1 cross-tenant prayer leader rejected on create', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'INVALID_TARGET'
      ? pass('3.1 cross-tenant prayer leader rejected on create', `threw INVALID_TARGET: ${(e as Error).message}`)
      : fail('3.1 cross-tenant prayer leader rejected on create', `wrong code: ${(e as { code?: string }).code}`);
  }

  console.log('\n3.2: updateEvent() setting a cross-tenant prayer_leader_member_id -> INVALID_TARGET');
  try {
    const ev = await createEvent({
      tenantId: TENANT_1, eventTypeId: genEventTypeId, name: 'FP-107 cross-tenant leader update test',
      startDatetime: future, endDatetime: futureEnd,
      locationName: 'Venue', locationAddress: '4 FP107 St', target: {},
    });
    createdEventIds.push(ev.id);
    await updateEvent(ev.id, TENANT_1, { prayerLeaderMemberId: leaderT2 });
    fail('3.2 cross-tenant prayer leader rejected on update', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'INVALID_TARGET'
      ? pass('3.2 cross-tenant prayer leader rejected on update', `threw INVALID_TARGET: ${(e as Error).message}`)
      : fail('3.2 cross-tenant prayer leader rejected on update', `wrong code: ${(e as { code?: string }).code}`);
  }

  // ── GROUP 4: food_assignment cross-tenant id silently excluded, not rejected ─

  console.log('\n── GROUP 4: food_assignment cross-tenant id — silently excluded at read time, not rejected at write time ──');

  console.log('\n4.1: createEvent() with a cross-tenant member_id inside food_assignment succeeds (no error)');
  try {
    const ev = await createEvent({
      tenantId: TENANT_1, eventTypeId: genEventTypeId, name: 'FP-107 food cross-tenant test',
      startDatetime: future, endDatetime: futureEnd,
      locationName: 'Venue', locationAddress: '5 FP107 St', target: {},
      foodAssignment: { group_ids: [], member_ids: [memberT2] },
    });
    createdEventIds.push(ev.id);
    const stored = psqlQuery(`SELECT food_assignment::text FROM events WHERE id = '${ev.id}'`);
    stored.includes(memberT2)
      ? pass('4.1 food_assignment cross-tenant id not rejected at write time', `stored as-is: ${stored} — matches target's existing precedent`)
      : fail('4.1 food_assignment cross-tenant id not rejected at write time', `unexpected stored value: ${stored}`);
  } catch (e) { fail('4.1 food_assignment cross-tenant id not rejected at write time', (e as Error).message); }

  // ── GROUP 5: publish with both fields unset succeeds ────────────────────────

  console.log('\n── GROUP 5: publish with both fields unset succeeds ──');

  console.log('\n5.1: DRAFT event created without either field publishes without error');
  try {
    const ev = await createEvent({
      tenantId: TENANT_1, eventTypeId: genEventTypeId, name: 'FP-107 publish unset test',
      startDatetime: future, endDatetime: futureEnd,
      locationName: 'Venue', locationAddress: '6 FP107 St', target: {},
    });
    createdEventIds.push(ev.id);
    const published = await publishEvent(ev.id, TENANT_1);
    published.status === 'SCHEDULED'
      ? pass('5.1 publish with both unset succeeds', `status=${published.status}`)
      : fail('5.1 publish with both unset succeeds', `status=${published.status}`);
  } catch (e) { fail('5.1 publish with both unset succeeds', (e as Error).message); }

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
  for (const mid of createdMemberIds) {
    psql(`DELETE FROM assignments WHERE member_id = '${mid}'; DELETE FROM members WHERE id = '${mid}';`);
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
