/**
 * Confirms that validateEventTypeId() in createEvent() fires correctly:
 *   TEST 1: valid event_type_id is accepted (service_role can read event_types)
 *   TEST 2: invalid event_type_id throws INVALID_TARGET
 *
 * Run: npx tsx scripts/test-fp45-validate-event-type.ts
 * Requires local Supabase running (supabase start).
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { execSync } from 'child_process';

const TENANT = '00000000-0000-0000-0000-000000000001';

function psqlQuery(sql: string): string {
  return execSync(
    `docker exec -i supabase_db_flockpulse-web psql -U postgres -d postgres -t`,
    { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }
  ).toString().trim();
}

function psql(sql: string) {
  execSync(
    `docker exec -i supabase_db_flockpulse-web psql -U postgres -d postgres`,
    { input: sql, stdio: ['pipe', 'inherit', 'inherit'] }
  );
}

type TestResult = { name: string; passed: boolean; detail: string };
const results: TestResult[] = [];

function pass(name: string, detail: string) {
  results.push({ name, passed: true, detail });
  console.log(`  ✅ PASSED: ${name}`);
  console.log(`     ${detail}`);
}
function fail(name: string, detail: string) {
  results.push({ name, passed: false, detail });
  console.error(`  ❌ FAILED: ${name}`);
  console.error(`     ${detail}`);
}

async function main() {
  const { createEvent } = await import('../src/features/events/service');

  const eventTypeId = psqlQuery(
    `SELECT id FROM event_types WHERE tenant_id = '${TENANT}' AND code = 'GENERAL' LIMIT 1`
  );

  if (!eventTypeId) {
    console.error('ABORT: no GENERAL event type found for seed tenant — run supabase db reset first');
    process.exit(1);
  }

  const future = new Date(Date.now() + 86400000).toISOString();
  const futureEnd = new Date(Date.now() + 90000000).toISOString();

  // TEST 1: valid event_type_id — service_role reads event_types, validateEventTypeId passes
  console.log('\nTEST 1: valid event_type_id — validateEventTypeId should pass');
  let createdEventId: string | null = null;
  try {
    const ev = await createEvent({
      tenantId: TENANT,
      eventTypeId,
      name: 'FP-45 validation smoke test',
      startDatetime: future,
      endDatetime: futureEnd,
      locationName: 'Test Venue',
      locationAddress: '123 Test St',
      target: {},
    });
    createdEventId = ev.id;
    pass('valid event_type_id accepted', `service_role read event_types successfully — event ${ev.id}`);
  } catch (e) {
    fail('valid event_type_id accepted', `threw ${(e as { code?: string }).code ?? 'unknown'}: ${(e as Error).message}`);
  }

  if (createdEventId) {
    psql(`DELETE FROM events WHERE id = '${createdEventId}'`);
  }

  // TEST 2: invalid event_type_id — validateEventTypeId must throw INVALID_TARGET
  console.log('\nTEST 2: invalid event_type_id — validateEventTypeId should throw INVALID_TARGET');
  try {
    await createEvent({
      tenantId: TENANT,
      eventTypeId: '00000000-dead-dead-dead-000000000000',
      name: 'bad event',
      startDatetime: future,
      endDatetime: futureEnd,
      locationName: 'Nowhere',
      locationAddress: '456 Nowhere Ave',
      target: {},
    });
    fail('invalid event_type_id rejected', 'createEvent did not throw — validateEventTypeId did not fire');
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'INVALID_TARGET') {
      pass('invalid event_type_id rejected with INVALID_TARGET', `threw INVALID_TARGET: "${(e as Error).message}"`);
    } else {
      fail('invalid event_type_id rejected with INVALID_TARGET', `wrong error — code=${code} message="${(e as Error).message}"`);
    }
  }

  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`\n${passed}/${total} tests passed`);
  if (passed < total) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
