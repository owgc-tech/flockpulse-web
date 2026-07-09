/**
 * DIP-FP-106 verification: Convert an existing single event into a new recurring series.
 *
 * GROUP 1 — off-by-one slicing correctness
 *   1.1  Existing event's own dates untouched; exactly N-1 new siblings created (not N, not N-2);
 *        no new sibling duplicates the existing event's exact time slot
 *
 * GROUP 2 — rejecting an event that already belongs to a series
 *   2.1  recurrence_series_id already set -> VALIDATION_ERROR
 *
 * GROUP 3 — rejecting ineligible effective status
 *   3.1  CANCELLED -> INVALID_STATE_TRANSITION
 *   3.2  LOCKED (raw status still SCHEDULED, effective status LOCKED) -> INVALID_STATE_TRANSITION
 *   3.3  COMPLETED -> INVALID_STATE_TRANSITION
 *
 * GROUP 4 — cap enforcement on the total (1 + additional) count
 *   4.1  Exactly at cap (MONTHLY: 1 existing + 11 additional = 12) -> succeeds
 *   4.2  One over cap (MONTHLY: 1 + 12 = 13) -> VALIDATION_ERROR
 *
 * GROUP 5 — byte-for-byte field preservation
 *   5.1  After conversion, every field on the original event except recurrence_series_id
 *        (and updated_at) is unchanged
 *
 * Run: npx tsx scripts/test-fp106-convert-event-to-series.ts
 * Requires local Supabase running.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { execSync } from 'child_process';

const TENANT_1 = '00000000-0000-0000-0000-000000000001';

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

const createdSeriesIds: string[] = [];
const createdEventIds: string[] = [];

async function main() {
  const { convertEventToSeries } = await import('../src/features/events/event-series.service');

  const genEventTypeId = psqlQuery(`SELECT id FROM event_types WHERE tenant_id = '${TENANT_1}' AND code = 'GENERAL' LIMIT 1`);
  const actorId = psqlQuery(`SELECT id FROM members WHERE tenant_id = '${TENANT_1}' AND role = 'ADMIN' LIMIT 1`);

  function makeStandaloneEvent(opts: {
    name?: string; status?: string; startOffset: string; endOffset: string; recurrenceSeriesId?: string | null;
  }): string {
    const id = newUuid();
    psql(`
      INSERT INTO events (id, tenant_id, event_type_id, name, status, start_datetime, end_datetime, location_name, location_address, target, recurrence_series_id)
      VALUES ('${id}', '${TENANT_1}', '${genEventTypeId}', '${opts.name ?? 'FP-106 test event'}', '${opts.status ?? 'SCHEDULED'}',
              now() + interval '${opts.startOffset}', now() + interval '${opts.endOffset}', 'Venue', '1 Convert St', '{}',
              ${opts.recurrenceSeriesId ? `'${opts.recurrenceSeriesId}'` : 'NULL'});
    `);
    createdEventIds.push(id);
    return id;
  }

  // ── GROUP 1: off-by-one slicing correctness ────────────────────────────────

  console.log('\n── GROUP 1: off-by-one slicing correctness ──');

  console.log('\n1.1: existing event dates untouched; exactly N-1 new siblings created');
  try {
    const eventId = makeStandaloneEvent({ startOffset: '1 day', endOffset: '1 day 1 hour' });
    const before = psqlQuery(`SELECT start_datetime, end_datetime FROM events WHERE id = '${eventId}'`);

    const eventRow = psqlQuery(`SELECT start_datetime FROM events WHERE id = '${eventId}'`);
    const endRow = psqlQuery(`SELECT end_datetime FROM events WHERE id = '${eventId}'`);

    const result = await convertEventToSeries({
      eventId, tenantId: TENANT_1,
      startDatetime: new Date(eventRow), endDatetime: new Date(endRow),
      frequency: 'WEEKLY', mode: 'COUNT', countOrUntil: 4, // total 4 -> 3 additional siblings
      actorMemberId: actorId,
    });
    createdSeriesIds.push(result.series_id);
    createdEventIds.push(...result.event_ids.filter(id => id !== eventId));

    const after = psqlQuery(`SELECT start_datetime, end_datetime FROM events WHERE id = '${eventId}'`);
    const siblingCount = parseInt(psqlQuery(`SELECT COUNT(*) FROM events WHERE recurrence_series_id = '${result.series_id}' AND id != '${eventId}'`));
    const duplicateSlot = psqlQuery(`
      SELECT COUNT(*) FROM events
      WHERE recurrence_series_id = '${result.series_id}' AND id != '${eventId}' AND start_datetime = '${eventRow}'::timestamptz
    `);

    result.event_ids.includes(eventId) && result.event_ids.length === 4 && siblingCount === 3 &&
    before === after && duplicateSlot === '0'
      ? pass('1.1 off-by-one slicing', `total event_ids=${result.event_ids.length}, siblings=${siblingCount}, original dates unchanged, no duplicate slot`)
      : fail('1.1 off-by-one slicing', `event_ids=${result.event_ids.length}, siblings=${siblingCount}, before="${before}", after="${after}", duplicateSlot=${duplicateSlot}`);
  } catch (e) { fail('1.1 off-by-one slicing', (e as Error).message); }

  // ── GROUP 2: rejecting an event already in a series ────────────────────────

  console.log('\n── GROUP 2: rejecting an event already in a series ──');

  console.log('\n2.1: recurrence_series_id already set -> VALIDATION_ERROR');
  try {
    const dummySeriesId = newUuid();
    psql(`
      INSERT INTO event_series (id, tenant_id, frequency, occurrence_count, name, event_type_id, location_name, location_address, target)
      VALUES ('${dummySeriesId}', '${TENANT_1}', 'WEEKLY', 1, 'FP-106 dummy series', '${genEventTypeId}', 'Venue', '1 Dummy St', '{}');
    `);
    createdSeriesIds.push(dummySeriesId);
    const eventId = makeStandaloneEvent({ startOffset: '2 days', endOffset: '2 days 1 hour', recurrenceSeriesId: dummySeriesId });

    await convertEventToSeries({
      eventId, tenantId: TENANT_1,
      startDatetime: new Date(Date.now() + 2 * 86400000), endDatetime: new Date(Date.now() + 2 * 86400000 + 3600000),
      frequency: 'WEEKLY', mode: 'COUNT', countOrUntil: 3, actorMemberId: actorId,
    });
    fail('2.1 already-in-series rejected', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'VALIDATION_ERROR'
      ? pass('2.1 already-in-series rejected', `threw VALIDATION_ERROR: ${(e as Error).message}`)
      : fail('2.1 already-in-series rejected', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
  }

  // ── GROUP 3: rejecting ineligible effective status ─────────────────────────

  console.log('\n── GROUP 3: rejecting ineligible effective status ──');

  console.log('\n3.1: CANCELLED -> INVALID_STATE_TRANSITION');
  try {
    const eventId = makeStandaloneEvent({ status: 'CANCELLED', startOffset: '3 days', endOffset: '3 days 1 hour' });
    await convertEventToSeries({
      eventId, tenantId: TENANT_1,
      startDatetime: new Date(Date.now() + 3 * 86400000), endDatetime: new Date(Date.now() + 3 * 86400000 + 3600000),
      frequency: 'WEEKLY', mode: 'COUNT', countOrUntil: 3, actorMemberId: actorId,
    });
    fail('3.1 CANCELLED rejected', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'INVALID_STATE_TRANSITION'
      ? pass('3.1 CANCELLED rejected', `threw INVALID_STATE_TRANSITION`)
      : fail('3.1 CANCELLED rejected', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
  }

  console.log('\n3.2: LOCKED (raw status SCHEDULED, effective LOCKED) -> INVALID_STATE_TRANSITION');
  try {
    const eventId = makeStandaloneEvent({ startOffset: '-40 hours', endOffset: '-30 hours' }); // well past attendance window
    await convertEventToSeries({
      eventId, tenantId: TENANT_1,
      startDatetime: new Date(Date.now() - 40 * 3600000), endDatetime: new Date(Date.now() - 30 * 3600000),
      frequency: 'WEEKLY', mode: 'COUNT', countOrUntil: 3, actorMemberId: actorId,
    });
    fail('3.2 LOCKED rejected', 'no error thrown — effective-status check did not fire');
  } catch (e) {
    (e as { code?: string }).code === 'INVALID_STATE_TRANSITION'
      ? pass('3.2 LOCKED rejected', `threw INVALID_STATE_TRANSITION — confirms get_event_effective_status() is used, not raw status`)
      : fail('3.2 LOCKED rejected', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
  }

  console.log('\n3.3: COMPLETED -> INVALID_STATE_TRANSITION');
  try {
    const eventId = makeStandaloneEvent({ startOffset: '-3 hours', endOffset: '-1 hours' }); // past end, within attendance window
    await convertEventToSeries({
      eventId, tenantId: TENANT_1,
      startDatetime: new Date(Date.now() - 3 * 3600000), endDatetime: new Date(Date.now() - 3600000),
      frequency: 'WEEKLY', mode: 'COUNT', countOrUntil: 3, actorMemberId: actorId,
    });
    fail('3.3 COMPLETED rejected', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'INVALID_STATE_TRANSITION'
      ? pass('3.3 COMPLETED rejected', `threw INVALID_STATE_TRANSITION`)
      : fail('3.3 COMPLETED rejected', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
  }

  // ── GROUP 4: cap enforcement on the total count ─────────────────────────────

  console.log('\n── GROUP 4: cap enforcement on the total (1 + additional) count ──');

  console.log('\n4.1: exactly at cap (MONTHLY: 1 + 11 additional = 12) -> succeeds');
  try {
    const eventId = makeStandaloneEvent({ startOffset: '4 days', endOffset: '4 days 1 hour' });
    const result = await convertEventToSeries({
      eventId, tenantId: TENANT_1,
      startDatetime: new Date(Date.now() + 4 * 86400000), endDatetime: new Date(Date.now() + 4 * 86400000 + 3600000),
      frequency: 'MONTHLY', mode: 'COUNT', countOrUntil: 12, actorMemberId: actorId,
    });
    createdSeriesIds.push(result.series_id);
    createdEventIds.push(...result.event_ids.filter(id => id !== eventId));
    result.event_ids.length === 12
      ? pass('4.1 exactly-at-cap succeeds', `total event_ids=${result.event_ids.length}`)
      : fail('4.1 exactly-at-cap succeeds', `expected 12, got ${result.event_ids.length}`);
  } catch (e) { fail('4.1 exactly-at-cap succeeds', (e as Error).message); }

  console.log('\n4.2: one over cap (MONTHLY: 1 + 12 additional = 13) -> VALIDATION_ERROR');
  try {
    const eventId = makeStandaloneEvent({ startOffset: '5 days', endOffset: '5 days 1 hour' });
    await convertEventToSeries({
      eventId, tenantId: TENANT_1,
      startDatetime: new Date(Date.now() + 5 * 86400000), endDatetime: new Date(Date.now() + 5 * 86400000 + 3600000),
      frequency: 'MONTHLY', mode: 'COUNT', countOrUntil: 13, actorMemberId: actorId,
    });
    fail('4.2 one-over-cap rejected', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'VALIDATION_ERROR'
      ? pass('4.2 one-over-cap rejected', `threw VALIDATION_ERROR: ${(e as Error).message}`)
      : fail('4.2 one-over-cap rejected', `wrong code: ${(e as { code?: string }).code}`);
  }

  // ── GROUP 5: byte-for-byte field preservation ───────────────────────────────

  console.log('\n── GROUP 5: byte-for-byte field preservation ──');

  console.log('\n5.1: every field except recurrence_series_id (and updated_at) is unchanged');
  try {
    const eventId = newUuid();
    const talkCourseId = newUuid();
    psql(`INSERT INTO courses (id, tenant_id, name, sequence_order) VALUES ('${talkCourseId}', '${TENANT_1}', 'FP-106 Course', 998);`);
    const moduleId = newUuid();
    psql(`INSERT INTO modules (id, tenant_id, course_id, name, sequence_order) VALUES ('${moduleId}', '${TENANT_1}', '${talkCourseId}', 'FP-106 Module', 1);`);
    const talkId = newUuid();
    psql(`
      INSERT INTO talks (id, tenant_id, module_id, name, sequence_order, for_single_men, for_single_women, for_married_men, for_married_women)
      VALUES ('${talkId}', '${TENANT_1}', '${moduleId}', 'FP-106 Talk', 1, true, true, true, true);
    `);
    psql(`
      INSERT INTO events (id, tenant_id, event_type_id, name, status, start_datetime, end_datetime, location_name, location_address, location_url, target, talk_id)
      VALUES ('${eventId}', '${TENANT_1}', '${genEventTypeId}', 'FP-106 preservation test', 'SCHEDULED',
              now() + interval '6 days', now() + interval '6 days 1 hour', 'Preservation Venue', '99 Preserve Ave', 'https://example.com/map', '{"group_ids":[]}', '${talkId}');
    `);
    createdEventIds.push(eventId);

    const before = psqlQuery(`
      SELECT name, event_type_id, location_name, location_address, location_url, target::text, talk_id, start_datetime, end_datetime
      FROM events WHERE id = '${eventId}'
    `);

    const eventRow = psqlQuery(`SELECT start_datetime FROM events WHERE id = '${eventId}'`);
    const endRow = psqlQuery(`SELECT end_datetime FROM events WHERE id = '${eventId}'`);
    const result = await convertEventToSeries({
      eventId, tenantId: TENANT_1,
      startDatetime: new Date(eventRow), endDatetime: new Date(endRow),
      frequency: 'WEEKLY', mode: 'COUNT', countOrUntil: 2, actorMemberId: actorId,
    });
    createdSeriesIds.push(result.series_id);
    createdEventIds.push(...result.event_ids.filter(id => id !== eventId));

    const after = psqlQuery(`
      SELECT name, event_type_id, location_name, location_address, location_url, target::text, talk_id, start_datetime, end_datetime
      FROM events WHERE id = '${eventId}'
    `);
    const recurrenceId = psqlQuery(`SELECT recurrence_series_id FROM events WHERE id = '${eventId}'`);

    before === after && recurrenceId === result.series_id
      ? pass('5.1 byte-for-byte preservation', `all fields unchanged, recurrence_series_id set to ${recurrenceId}`)
      : fail('5.1 byte-for-byte preservation', `before="${before}"\nafter ="${after}"\nrecurrenceId=${recurrenceId}`);

    psql(`DELETE FROM talks WHERE id = '${talkId}'; DELETE FROM modules WHERE id = '${moduleId}'; DELETE FROM courses WHERE id = '${talkCourseId}';`);
  } catch (e) { fail('5.1 byte-for-byte preservation', (e as Error).message); }

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
  for (const sid of createdSeriesIds) {
    psql(`DELETE FROM events WHERE recurrence_series_id = '${sid}'; DELETE FROM event_series WHERE id = '${sid}';`);
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
