/**
 * DIP-FP-60-FP-61-FP-64-FP-65-FP-67 verification: Event Admin Core Surface.
 *
 * GROUP 1 — FP-60: effective status in listEvents()
 *   1.1  DRAFT event -> effective_status='DRAFT'
 *   1.2  Published (future dates) -> effective_status='SCHEDULED'
 *   1.3  Past end_datetime, within attendance window -> effective_status='COMPLETED'
 *   1.4  Past end_datetime, beyond attendance window -> effective_status='LOCKED'
 *
 * GROUP 2 — location field validation
 *   2.1  createEvent() without location_address -> DB NOT NULL violation (defense in depth)
 *   2.2  createEvent() with locationAddress set, locationUrl omitted -> location_url IS NULL
 *   2.3  updateEvent() patches locationAddress/locationUrl -> stored correctly
 *
 * GROUP 3 — FP-65: cancel_event_with_audit() state-blocking
 *   3.1  Cancel a SCHEDULED event -> succeeds, audit log actor_id set
 *   3.2  Cancel again -> INVALID_STATE_TRANSITION
 *   3.3  Cancel a LOCKED event (raw status still SCHEDULED, effective status LOCKED) ->
 *        INVALID_STATE_TRANSITION — this is the case the DIP's illustrative SQL got wrong
 *        (it checked the raw stored status column, which can never be 'LOCKED')
 *   3.4  trigger_suppress_notifications_on_cancel fires — PENDING notifications become CANCELLED
 *
 * GROUP 4 — FP-67: roster join classification
 *   4.1  rsvp_status=YES -> ACCEPTED
 *   4.2  rsvp_status=NO -> DECLINED with rsvp_reason visible
 *   4.3  No rsvps row -> NOT_RESPONDED
 *   4.4  Cross-tenant event id -> NOT_FOUND (getEventRoster refuses to leak another tenant's event)
 *
 * Run: npx tsx scripts/test-fp60-61-64-65-67-event-admin-core-surface.ts
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
const createdGroupIds: string[] = [];

async function main() {
  const { createEvent, updateEvent, listEvents, cancelEvent, getEventRoster, publishEvent } = await import(
    '../src/features/events/service'
  );

  const genEventTypeId = psqlQuery(`SELECT id FROM event_types WHERE tenant_id = '${TENANT_1}' AND code = 'GENERAL' LIMIT 1`);

  // ── GROUP 1: FP-60 effective status ────────────────────────────────────────

  console.log('\n── GROUP 1: FP-60 effective status in listEvents() ──');

  console.log('\n1.1: DRAFT event -> effective_status=DRAFT');
  let draftEventId: string | null = null;
  try {
    const future = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 90000000).toISOString();
    const ev = await createEvent({
      tenantId: TENANT_1, eventTypeId: genEventTypeId, name: 'FP-60 draft test',
      startDatetime: future, endDatetime: futureEnd,
      locationName: 'Venue', locationAddress: '1 Draft St', target: {},
    });
    draftEventId = ev.id;
    createdEventIds.push(ev.id);
    const list = await listEvents(TENANT_1);
    const row = (list as any[]).find(e => e.id === ev.id);
    row?.effective_status === 'DRAFT'
      ? pass('1.1 DRAFT effective status', `effective_status=${row?.effective_status}`)
      : fail('1.1 DRAFT effective status', `got ${JSON.stringify(row)}`);
  } catch (e) { fail('1.1 DRAFT effective status', (e as Error).message); }

  console.log('\n1.2: Published (future dates) -> effective_status=SCHEDULED');
  if (draftEventId) {
    try {
      await publishEvent(draftEventId, TENANT_1);
      const list = await listEvents(TENANT_1);
      const row = (list as any[]).find(e => e.id === draftEventId);
      row?.effective_status === 'SCHEDULED'
        ? pass('1.2 SCHEDULED effective status', `effective_status=${row?.effective_status}`)
        : fail('1.2 SCHEDULED effective status', `got ${JSON.stringify(row)}`);
    } catch (e) { fail('1.2 SCHEDULED effective status', (e as Error).message); }
  }

  console.log('\n1.3: Past end_datetime, within attendance window -> effective_status=COMPLETED');
  let completedEventId: string | null = null;
  try {
    completedEventId = newUuid();
    psql(`
      INSERT INTO events (id, tenant_id, event_type_id, name, status, start_datetime, end_datetime, location_name, location_address, target)
      VALUES ('${completedEventId}', '${TENANT_1}', '${genEventTypeId}', 'FP-60 completed test', 'SCHEDULED',
              now() - interval '3 hours', now() - interval '1 hour', 'Venue', '1 Completed St', '{}');
    `);
    createdEventIds.push(completedEventId);
    const list = await listEvents(TENANT_1);
    const row = (list as any[]).find(e => e.id === completedEventId);
    row?.effective_status === 'COMPLETED'
      ? pass('1.3 COMPLETED effective status', `effective_status=${row?.effective_status}`)
      : fail('1.3 COMPLETED effective status', `got ${JSON.stringify(row)}`);
  } catch (e) { fail('1.3 COMPLETED effective status', (e as Error).message); }

  console.log('\n1.4: Past end_datetime, beyond attendance window -> effective_status=LOCKED');
  let lockedEventId: string | null = null;
  try {
    lockedEventId = newUuid();
    psql(`
      INSERT INTO events (id, tenant_id, event_type_id, name, status, start_datetime, end_datetime, location_name, location_address, target)
      VALUES ('${lockedEventId}', '${TENANT_1}', '${genEventTypeId}', 'FP-60 locked test', 'SCHEDULED',
              now() - interval '40 hours', now() - interval '30 hours', 'Venue', '1 Locked St', '{}');
    `);
    createdEventIds.push(lockedEventId);
    const list = await listEvents(TENANT_1);
    const row = (list as any[]).find(e => e.id === lockedEventId);
    row?.effective_status === 'LOCKED'
      ? pass('1.4 LOCKED effective status', `effective_status=${row?.effective_status}`)
      : fail('1.4 LOCKED effective status', `got ${JSON.stringify(row)}`);
  } catch (e) { fail('1.4 LOCKED effective status', (e as Error).message); }

  // ── GROUP 2: location field validation ─────────────────────────────────────

  console.log('\n── GROUP 2: location field validation ──');

  console.log('\n2.1: createEvent() without location_address -> DB NOT NULL violation');
  try {
    const future = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 90000000).toISOString();
    await createEvent({
      tenantId: TENANT_1, eventTypeId: genEventTypeId, name: 'FP-61 missing address test',
      startDatetime: future, endDatetime: futureEnd,
      locationName: 'Venue', locationAddress: null as unknown as string, target: {},
    });
    fail('2.1 NOT NULL violation on location_address', 'no error thrown — constraint did not fire');
  } catch (e) {
    const msg = (e as Error).message ?? '';
    msg.toLowerCase().includes('location_address') || msg.toLowerCase().includes('null value')
      ? pass('2.1 NOT NULL violation on location_address', `threw: ${msg}`)
      : fail('2.1 NOT NULL violation on location_address', `unexpected error: ${msg}`);
  }

  console.log('\n2.2: createEvent() with locationAddress, no locationUrl -> location_url IS NULL');
  try {
    const future = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 90000000).toISOString();
    const ev = await createEvent({
      tenantId: TENANT_1, eventTypeId: genEventTypeId, name: 'FP-61 no url test',
      startDatetime: future, endDatetime: futureEnd,
      locationName: 'Venue', locationAddress: '2 NoUrl Ave', target: {},
    });
    createdEventIds.push(ev.id);
    const stored = psqlQuery(`SELECT COALESCE(location_url, 'NULL'), location_address FROM events WHERE id = '${ev.id}'`);
    stored.startsWith('NULL')
      ? pass('2.2 location_url defaults to NULL', `row: ${stored}`)
      : fail('2.2 location_url defaults to NULL', `row: ${stored}`);
  } catch (e) { fail('2.2 location_url defaults to NULL', (e as Error).message); }

  console.log('\n2.3: updateEvent() patches locationAddress/locationUrl');
  try {
    const future = new Date(Date.now() + 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 90000000).toISOString();
    const ev = await createEvent({
      tenantId: TENANT_1, eventTypeId: genEventTypeId, name: 'FP-64 patch test',
      startDatetime: future, endDatetime: futureEnd,
      locationName: 'Venue', locationAddress: '3 Old Rd', target: {},
    });
    createdEventIds.push(ev.id);
    await updateEvent(ev.id, TENANT_1, { locationAddress: '4 New Rd', locationUrl: 'https://maps.example.com/x' });
    const stored = psqlQuery(`SELECT location_address, location_url FROM events WHERE id = '${ev.id}'`);
    stored.includes('4 New Rd') && stored.includes('https://maps.example.com/x')
      ? pass('2.3 location patch via updateEvent', `row: ${stored}`)
      : fail('2.3 location patch via updateEvent', `row: ${stored}`);
  } catch (e) { fail('2.3 location patch via updateEvent', (e as Error).message); }

  // ── GROUP 3: FP-65 cancel_event_with_audit() state-blocking ────────────────

  console.log('\n── GROUP 3: FP-65 cancel_event_with_audit() state-blocking ──');

  const actorId = psqlQuery(`SELECT id FROM members WHERE tenant_id = '${TENANT_1}' AND role = 'ADMIN' LIMIT 1`);

  console.log('\n3.1: Cancel a SCHEDULED event -> succeeds, audit actor_id set');
  let cancelTargetId: string | null = null;
  try {
    cancelTargetId = newUuid();
    psql(`
      INSERT INTO events (id, tenant_id, event_type_id, name, status, start_datetime, end_datetime, location_name, location_address, target)
      VALUES ('${cancelTargetId}', '${TENANT_1}', '${genEventTypeId}', 'FP-65 cancel test', 'SCHEDULED',
              now() + interval '1 day', now() + interval '1 day 1 hour', 'Venue', '5 Cancel St', '{}');
    `);
    createdEventIds.push(cancelTargetId);
    const result = await cancelEvent(cancelTargetId, TENANT_1, actorId);
    const auditActor = psqlQuery(`SELECT actor_id FROM audit_logs WHERE entity_type='event' AND entity_id='${cancelTargetId}' AND action='cancel'`);
    result.status === 'CANCELLED' && auditActor === actorId
      ? pass('3.1 cancel succeeds', `status=${result.status}, audit actor_id=${auditActor}`)
      : fail('3.1 cancel succeeds', `status=${result.status}, auditActor=${auditActor}`);
  } catch (e) { fail('3.1 cancel succeeds', (e as Error).message); }

  console.log('\n3.2: Cancel again -> INVALID_STATE_TRANSITION');
  if (cancelTargetId) {
    try {
      await cancelEvent(cancelTargetId, TENANT_1, actorId);
      fail('3.2 double-cancel blocked', 'no error thrown');
    } catch (e) {
      (e as { code?: string }).code === 'INVALID_STATE_TRANSITION'
        ? pass('3.2 double-cancel blocked', `threw INVALID_STATE_TRANSITION`)
        : fail('3.2 double-cancel blocked', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
    }
  }

  console.log('\n3.3: Cancel a LOCKED event (raw status SCHEDULED, effective LOCKED) -> INVALID_STATE_TRANSITION');
  if (lockedEventId) {
    try {
      await cancelEvent(lockedEventId, TENANT_1, actorId);
      fail('3.3 cancel blocked on LOCKED', 'no error thrown — the effective-status fix did not fire');
    } catch (e) {
      (e as { code?: string }).code === 'INVALID_STATE_TRANSITION'
        ? pass('3.3 cancel blocked on LOCKED', `threw INVALID_STATE_TRANSITION — confirms get_event_effective_status() is used, not raw status`)
        : fail('3.3 cancel blocked on LOCKED', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
    }
  }

  console.log('\n3.4: trigger_suppress_notifications_on_cancel fires — PENDING notifications become CANCELLED');
  try {
    const notifTargetId = newUuid();
    psql(`
      INSERT INTO events (id, tenant_id, event_type_id, name, status, start_datetime, end_datetime, location_name, location_address, target)
      VALUES ('${notifTargetId}', '${TENANT_1}', '${genEventTypeId}', 'FP-65 notif suppress test', 'SCHEDULED',
              now() + interval '2 days', now() + interval '2 days 1 hour', 'Venue', '6 Notif St', '{}');
      INSERT INTO event_notifications (tenant_id, event_id, purpose, scheduled_for, status)
      VALUES ('${TENANT_1}', '${notifTargetId}', 'PRE_EVENT_REMINDER', now() + interval '1 day', 'PENDING');
    `);
    createdEventIds.push(notifTargetId);
    await cancelEvent(notifTargetId, TENANT_1, actorId);
    const notifStatus = psqlQuery(`SELECT status FROM event_notifications WHERE event_id = '${notifTargetId}'`);
    notifStatus === 'CANCELLED'
      ? pass('3.4 notification suppression trigger fires', `notification status=${notifStatus}`)
      : fail('3.4 notification suppression trigger fires', `notification status=${notifStatus}`);
  } catch (e) { fail('3.4 notification suppression trigger fires', (e as Error).message); }

  // ── GROUP 4: FP-67 roster join classification ──────────────────────────────

  console.log('\n── GROUP 4: FP-67 roster join classification ──');

  function makeMember(name: string, tenantId: string): string {
    const id = newUuid();
    const userId = newUuid();
    psql(`
      INSERT INTO members (id, tenant_id, user_id, email, role, first_name, last_name, gender, marital_status, birthdate)
      VALUES ('${id}', '${tenantId}', '${userId}', '${name.toLowerCase()}@fp6067.t', 'MEMBER', '${name}', 'Test', 'MALE', 'SINGLE', '1990-01-01');
    `);
    createdMemberIds.push(id);
    return id;
  }

  const mYes = makeMember('FP67Yes', TENANT_1);
  const mNo = makeMember('FP67No', TENANT_1);
  const mUnresponded = makeMember('FP67Unresp', TENANT_1);

  let rosterEventId: string | null = null;
  try {
    rosterEventId = newUuid();
    psql(`
      INSERT INTO events (id, tenant_id, event_type_id, name, status, start_datetime, end_datetime, location_name, location_address, target)
      VALUES ('${rosterEventId}', '${TENANT_1}', '${genEventTypeId}', 'FP-67 roster test', 'SCHEDULED',
              now() + interval '3 days', now() + interval '3 days 1 hour', 'Venue', '7 Roster St', '{}');
      INSERT INTO event_attendees (tenant_id, event_id, member_id) VALUES
      ('${TENANT_1}', '${rosterEventId}', '${mYes}'),
      ('${TENANT_1}', '${rosterEventId}', '${mNo}'),
      ('${TENANT_1}', '${rosterEventId}', '${mUnresponded}');
      INSERT INTO rsvps (tenant_id, event_id, member_id, rsvp_status, rsvp_reason, responded_at) VALUES
      ('${TENANT_1}', '${rosterEventId}', '${mYes}', 'YES', NULL, now()),
      ('${TENANT_1}', '${rosterEventId}', '${mNo}', 'NO', 'Out of town', now());
    `);
    createdEventIds.push(rosterEventId);

    const roster = await getEventRoster(rosterEventId, TENANT_1);
    const yesEntry = roster.find(r => r.member_id === mYes);
    const noEntry = roster.find(r => r.member_id === mNo);
    const unrespEntry = roster.find(r => r.member_id === mUnresponded);

    console.log('\n4.1: rsvp_status=YES -> ACCEPTED');
    yesEntry?.response === 'ACCEPTED'
      ? pass('4.1 YES -> ACCEPTED', `entry=${JSON.stringify(yesEntry)}`)
      : fail('4.1 YES -> ACCEPTED', `entry=${JSON.stringify(yesEntry)}`);

    console.log('\n4.2: rsvp_status=NO -> DECLINED with rsvp_reason visible');
    noEntry?.response === 'DECLINED' && noEntry?.rsvp_reason === 'Out of town'
      ? pass('4.2 NO -> DECLINED with reason', `entry=${JSON.stringify(noEntry)}`)
      : fail('4.2 NO -> DECLINED with reason', `entry=${JSON.stringify(noEntry)}`);

    console.log('\n4.3: No rsvps row -> NOT_RESPONDED');
    unrespEntry?.response === 'NOT_RESPONDED'
      ? pass('4.3 no rsvp -> NOT_RESPONDED', `entry=${JSON.stringify(unrespEntry)}`)
      : fail('4.3 no rsvp -> NOT_RESPONDED', `entry=${JSON.stringify(unrespEntry)}`);
  } catch (e) {
    fail('4.1 YES -> ACCEPTED', (e as Error).message);
    fail('4.2 NO -> DECLINED with reason', (e as Error).message);
    fail('4.3 no rsvp -> NOT_RESPONDED', (e as Error).message);
  }

  console.log('\n4.4: Cross-tenant event id -> NOT_FOUND (roster refuses to leak another tenant\'s event)');
  if (rosterEventId) {
    try {
      await getEventRoster(rosterEventId, TENANT_2);
      fail('4.4 cross-tenant roster blocked', 'no error thrown — leaked tenant-1 event to tenant-2 caller');
    } catch (e) {
      (e as { code?: string }).code === 'NOT_FOUND'
        ? pass('4.4 cross-tenant roster blocked', `threw NOT_FOUND`)
        : fail('4.4 cross-tenant roster blocked', `wrong code: ${(e as { code?: string }).code}`);
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  console.log('\nCleaning up fixtures...');
  for (const eid of createdEventIds) {
    psql(`
      DELETE FROM rsvps WHERE event_id = '${eid}';
      DELETE FROM event_notifications WHERE event_id = '${eid}';
      DELETE FROM event_attendees WHERE event_id = '${eid}';
      DELETE FROM audit_logs WHERE entity_type = 'event' AND entity_id = '${eid}';
      DELETE FROM events WHERE id = '${eid}';
    `);
  }
  for (const mid of createdMemberIds) {
    psql(`DELETE FROM assignments WHERE member_id = '${mid}'; DELETE FROM members WHERE id = '${mid}';`);
  }
  for (const gid of createdGroupIds) {
    psql(`DELETE FROM groups WHERE id = '${gid}';`);
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
