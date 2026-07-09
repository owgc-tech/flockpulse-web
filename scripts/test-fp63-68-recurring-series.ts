/**
 * DIP-FP-63-FP-68 verification: Recurring Event Series.
 *
 * GROUP 1 — cap enforcement, both input methods, at the boundary
 *   1.1  COUNT mode, exactly at cap (MONTHLY, count=12) -> succeeds
 *   1.2  COUNT mode, one over cap (MONTHLY, count=13) -> VALIDATION_ERROR
 *   1.3  UNTIL mode, implied count exactly at cap -> succeeds
 *   1.4  UNTIL mode, implied count one over cap -> VALIDATION_ERROR
 *
 * GROUP 2 — "ends on date" implied count matches actual generated count exactly
 *   2.1  computeOccurrenceDates() count == actual events rows created for the same inputs
 *
 * GROUP 3 — occurrence independence
 *   3.1  Cancelling one occurrence in a series leaves the others untouched
 *   3.2  Editing one occurrence's fields leaves the others untouched
 *
 * GROUP 4 — cross-tenant safety on recurrence_series_id
 *   4.1  An event's recurrence_series_id must belong to the same tenant — trigger blocks otherwise
 *
 * GROUP 5 — FP-68 selectivity
 *   5.1  A COMPLETED occurrence and an already-CANCELLED occurrence are left untouched;
 *        only the eligible occurrence is cancelled — cancelled=1, skipped=2
 *
 * Run: npx tsx scripts/test-fp63-68-recurring-series.ts
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

const createdSeriesIds: string[] = [];
const createdEventIds: string[] = [];

async function main() {
  const { createEventSeries, cancelRemainingInSeries } = await import('../src/features/events/event-series.service');
  const { updateEvent, cancelEvent } = await import('../src/features/events/service');
  const { computeOccurrenceDates } = await import('../src/features/events/event.types');

  const genEventTypeId = psqlQuery(`SELECT id FROM event_types WHERE tenant_id = '${TENANT_1}' AND code = 'GENERAL' LIMIT 1`);
  const actorId = psqlQuery(`SELECT id FROM members WHERE tenant_id = '${TENANT_1}' AND role = 'ADMIN' LIMIT 1`);

  const baseStart = new Date(Date.now() + 86400000); // tomorrow
  const baseEnd = new Date(baseStart.getTime() + 3600000); // +1h

  async function makeSeries(frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY', mode: 'COUNT' | 'UNTIL', countOrUntil: number | Date) {
    const occurrenceDates = computeOccurrenceDates(baseStart, baseEnd, frequency, mode, countOrUntil);
    const result = await createEventSeries({
      tenantId: TENANT_1, frequency, occurrenceDates,
      name: 'FP-63 series test', eventTypeId: genEventTypeId,
      locationName: 'Venue', locationAddress: '1 Series St', target: {},
      actorMemberId: actorId,
    });
    createdSeriesIds.push(result.series_id);
    createdEventIds.push(...result.event_ids);
    return { result, occurrenceDates };
  }

  // ── GROUP 1: cap enforcement at the boundary ───────────────────────────────

  console.log('\n── GROUP 1: cap enforcement, both input methods, at the boundary ──');

  console.log('\n1.1: COUNT mode, exactly at cap (MONTHLY, count=12) -> succeeds');
  try {
    const { result } = await makeSeries('MONTHLY', 'COUNT', 12);
    result.event_ids.length === 12
      ? pass('1.1 exactly-at-cap succeeds', `created ${result.event_ids.length} events, series_id=${result.series_id}`)
      : fail('1.1 exactly-at-cap succeeds', `expected 12, got ${result.event_ids.length}`);
  } catch (e) { fail('1.1 exactly-at-cap succeeds', (e as Error).message); }

  console.log('\n1.2: COUNT mode, one over cap (MONTHLY, count=13) -> VALIDATION_ERROR');
  try {
    await makeSeries('MONTHLY', 'COUNT', 13);
    fail('1.2 one-over-cap rejected', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'VALIDATION_ERROR'
      ? pass('1.2 one-over-cap rejected', `threw VALIDATION_ERROR: ${(e as Error).message}`)
      : fail('1.2 one-over-cap rejected', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
  }

  console.log('\n1.3: UNTIL mode, implied count exactly at cap -> succeeds');
  try {
    // 12 monthly occurrences starting at baseStart -> the 12th occurrence is 11 months later.
    const untilDate = new Date(baseStart);
    untilDate.setMonth(untilDate.getMonth() + 11);
    untilDate.setDate(untilDate.getDate() + 1); // ensure the 12th occurrence's date itself is included
    const { result, occurrenceDates } = await makeSeries('MONTHLY', 'UNTIL', untilDate);
    occurrenceDates.length === 12 && result.event_ids.length === 12
      ? pass('1.3 UNTIL exactly-at-cap succeeds', `implied count=${occurrenceDates.length}, created=${result.event_ids.length}`)
      : fail('1.3 UNTIL exactly-at-cap succeeds', `implied=${occurrenceDates.length}, created=${result.event_ids.length}`);
  } catch (e) { fail('1.3 UNTIL exactly-at-cap succeeds', (e as Error).message); }

  console.log('\n1.4: UNTIL mode, implied count one over cap -> VALIDATION_ERROR');
  try {
    const untilDate = new Date(baseStart);
    untilDate.setMonth(untilDate.getMonth() + 12);
    untilDate.setDate(untilDate.getDate() + 1);
    await makeSeries('MONTHLY', 'UNTIL', untilDate);
    fail('1.4 UNTIL one-over-cap rejected', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'VALIDATION_ERROR'
      ? pass('1.4 UNTIL one-over-cap rejected', `threw VALIDATION_ERROR: ${(e as Error).message}`)
      : fail('1.4 UNTIL one-over-cap rejected', `wrong code: ${(e as { code?: string }).code}`);
  }

  // ── GROUP 2: implied count matches actual generated count exactly ─────────

  console.log('\n── GROUP 2: "ends on date" implied count matches actual generated count ──');

  console.log('\n2.1: computeOccurrenceDates() count == actual events rows created');
  try {
    const untilDate = new Date(baseStart.getTime() + 30 * 86400000); // ~4 weekly occurrences
    const { result, occurrenceDates } = await makeSeries('WEEKLY', 'UNTIL', untilDate);
    const actualCount = parseInt(psqlQuery(`SELECT COUNT(*) FROM events WHERE recurrence_series_id = '${result.series_id}'`));
    occurrenceDates.length === actualCount && occurrenceDates.length === result.event_ids.length
      ? pass('2.1 implied count matches actual', `implied=${occurrenceDates.length}, actual rows=${actualCount}`)
      : fail('2.1 implied count matches actual', `implied=${occurrenceDates.length}, actual rows=${actualCount}`);
  } catch (e) { fail('2.1 implied count matches actual', (e as Error).message); }

  // ── GROUP 3: occurrence independence ───────────────────────────────────────

  console.log('\n── GROUP 3: occurrence independence ──');

  let independenceSeriesId: string | null = null;
  let independenceEventIds: string[] = [];
  try {
    const { result } = await makeSeries('WEEKLY', 'COUNT', 3);
    independenceSeriesId = result.series_id;
    independenceEventIds = result.event_ids;
  } catch (e) {
    fail('3.1 cancel independence setup', (e as Error).message);
    fail('3.2 edit independence setup', (e as Error).message);
  }

  console.log('\n3.1: Cancelling one occurrence leaves the others untouched');
  if (independenceEventIds.length === 3) {
    try {
      await cancelEvent(independenceEventIds[0], TENANT_1, actorId);
      const statuses = independenceEventIds.map(id => psqlQuery(`SELECT status FROM events WHERE id = '${id}'`));
      statuses[0] === 'CANCELLED' && statuses[1] === 'DRAFT' && statuses[2] === 'DRAFT'
        ? pass('3.1 cancel independence', `statuses=${JSON.stringify(statuses)}`)
        : fail('3.1 cancel independence', `statuses=${JSON.stringify(statuses)}`);
    } catch (e) { fail('3.1 cancel independence', (e as Error).message); }
  }

  console.log('\n3.2: Editing one occurrence leaves the others untouched');
  if (independenceEventIds.length === 3) {
    try {
      await updateEvent(independenceEventIds[1], TENANT_1, { name: 'FP-63 renamed occurrence' });
      const names = independenceEventIds.map(id => psqlQuery(`SELECT name FROM events WHERE id = '${id}'`));
      names[1] === 'FP-63 renamed occurrence' && names[0] === 'FP-63 series test' && names[2] === 'FP-63 series test'
        ? pass('3.2 edit independence', `names=${JSON.stringify(names)}`)
        : fail('3.2 edit independence', `names=${JSON.stringify(names)}`);
    } catch (e) { fail('3.2 edit independence', (e as Error).message); }
  }

  // ── GROUP 4: cross-tenant safety on recurrence_series_id ───────────────────

  console.log('\n── GROUP 4: cross-tenant safety on recurrence_series_id ──');

  console.log('\n4.1: An event\'s recurrence_series_id must belong to the same tenant');
  if (independenceSeriesId) {
    // psql exits 0 even when a statement inside it errors (confirmed empirically) — so
    // correctness here is verified by checking whether the row actually exists afterward,
    // not by relying on a thrown exception from the shell command.
    const badId = newUuid();
    psql(`
      INSERT INTO events (id, tenant_id, event_type_id, name, status, start_datetime, end_datetime, location_name, location_address, target, recurrence_series_id)
      VALUES ('${badId}', '${TENANT_2}', (SELECT id FROM event_types WHERE tenant_id='${TENANT_2}' AND code='GENERAL' LIMIT 1), 'Cross-tenant test', 'DRAFT',
              now() + interval '1 day', now() + interval '1 day 1 hour', 'Venue', '1 Bad St', '{}', '${independenceSeriesId}');
    `);
    const rowExists = psqlQuery(`SELECT COUNT(*) FROM events WHERE id = '${badId}'`);
    rowExists === '0'
      ? pass('4.1 cross-tenant recurrence_series_id blocked', 'row was not created — trigger_validate_event_series_tenant_scope fired')
      : fail('4.1 cross-tenant recurrence_series_id blocked', `row was created despite tenant mismatch — trigger did not fire`);
    if (rowExists !== '0') psql(`DELETE FROM events WHERE id = '${badId}'`);
  }

  // ── GROUP 5: FP-68 selectivity ──────────────────────────────────────────────

  console.log('\n── GROUP 5: FP-68 selectivity ──');

  let selectivitySeriesId: string | null = null;
  try {
    const eligibleId = newUuid();
    const completedId = newUuid();
    const cancelledId = newUuid();
    selectivitySeriesId = newUuid();

    psql(`
      INSERT INTO event_series (id, tenant_id, frequency, occurrence_count, name, event_type_id, location_name, location_address, target)
      VALUES ('${selectivitySeriesId}', '${TENANT_1}', 'WEEKLY', 3, 'FP-68 selectivity test', '${genEventTypeId}', 'Venue', '1 Selectivity St', '{}');

      INSERT INTO events (id, tenant_id, event_type_id, name, status, start_datetime, end_datetime, location_name, location_address, target, recurrence_series_id)
      VALUES
      ('${eligibleId}', '${TENANT_1}', '${genEventTypeId}', 'Eligible occurrence', 'SCHEDULED',
       now() + interval '1 day', now() + interval '1 day 1 hour', 'Venue', '1 Selectivity St', '{}', '${selectivitySeriesId}'),
      ('${completedId}', '${TENANT_1}', '${genEventTypeId}', 'Completed occurrence', 'SCHEDULED',
       now() - interval '3 hours', now() - interval '1 hour', 'Venue', '1 Selectivity St', '{}', '${selectivitySeriesId}'),
      ('${cancelledId}', '${TENANT_1}', '${genEventTypeId}', 'Cancelled occurrence', 'CANCELLED',
       now() + interval '2 days', now() + interval '2 days 1 hour', 'Venue', '1 Selectivity St', '{}', '${selectivitySeriesId}');
    `);
    createdEventIds.push(eligibleId, completedId, cancelledId);

    console.log('\n5.1: Only the eligible occurrence is cancelled; COMPLETED and already-CANCELLED are left untouched');
    const result = await cancelRemainingInSeries(selectivitySeriesId, TENANT_1, actorId);
    const eligibleStatus = psqlQuery(`SELECT status FROM events WHERE id = '${eligibleId}'`);
    const completedStatus = psqlQuery(`SELECT status FROM events WHERE id = '${completedId}'`);

    result.cancelled === 1 && result.skipped === 2 && eligibleStatus === 'CANCELLED' && completedStatus === 'SCHEDULED'
      ? pass('5.1 FP-68 selectivity', `cancelled=${result.cancelled}, skipped=${result.skipped}, eligible->${eligibleStatus}, completed stayed ${completedStatus}`)
      : fail('5.1 FP-68 selectivity', `result=${JSON.stringify(result)}, eligibleStatus=${eligibleStatus}, completedStatus=${completedStatus}`);
  } catch (e) { fail('5.1 FP-68 selectivity', (e as Error).message); }

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
  if (selectivitySeriesId) {
    psql(`DELETE FROM events WHERE recurrence_series_id = '${selectivitySeriesId}'; DELETE FROM event_series WHERE id = '${selectivitySeriesId}';`);
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
