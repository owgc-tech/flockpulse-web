/**
 * DIP-FP-73-FP-74 verification: bulk Leader reassignment + deactivation guard.
 *
 * GROUP 1 — bulk_reassign_leader_members_with_audit() / bulkReassignLeaderMembers()
 *   1.1  Bulk reassign moves every member off the outgoing Leader, onto the incoming Leader
 *   1.2  reassigned_count matches the number of members actually moved
 *   1.3  Reassigning a Leader with nobody assigned -> reassigned_count = 0, no error
 *   1.4  Each reassigned member gets its own SET_PASTORAL_LEADER audit row (no batch rollup)
 *   1.5  Self-reassign (outgoing === incoming) -> VALIDATION_ERROR
 *   1.6  Cross-tenant incoming leader -> CROSS_TENANT_ACCESS, batch rolled back (nobody moved)
 *
 * GROUP 2 — deactivation guard (block_member_deactivation_if_assigned_leader trigger)
 *   2.1  softDeleteMember() on a member still an active Pastoral Leader -> INVALID_STATE_TRANSITION,
 *        with assignedMemberCount matching the live count
 *   2.2  softDeleteMember() succeeds once nobody is assigned to them (after bulk reassign)
 *   2.3  getMembersAssignedToLeader() reflects the post-reassign state (0 for outgoing, N for incoming)
 *
 * Run: npx tsx scripts/test-fp73-74-bulk-reassign-deactivation-guard.ts
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

const createdMemberIds: string[] = [];

function makeMember(name: string, tenantId: string): string {
  const id = newUuid();
  const userId = newUuid();
  psql(`
    INSERT INTO members (id, tenant_id, user_id, email, role, first_name, last_name, gender, marital_status, birthdate)
    VALUES ('${id}', '${tenantId}', '${userId}', '${name.toLowerCase()}@fp7374.t', 'MEMBER', '${name}', 'Test', 'MALE', 'SINGLE', '1990-01-01');
  `);
  createdMemberIds.push(id);
  return id;
}

async function main() {
  const { softDeleteMember } = await import('../src/features/members/service');
  const { bulkReassignLeaderMembers, getMembersAssignedToLeader, setPastoralLeader } =
    await import('../src/features/assignments/service');

  const leaderA = makeMember('FP7374LeaderA', TENANT_1);
  const leaderB = makeMember('FP7374LeaderB', TENANT_1);
  const leaderC = makeMember('FP7374LeaderC', TENANT_1); // stays empty, for the count=0 case
  const leaderT2 = makeMember('FP7374LeaderT2', TENANT_2);
  const m1 = makeMember('FP7374M1', TENANT_1);
  const m2 = makeMember('FP7374M2', TENANT_1);
  const actor = makeMember('FP7374Actor', TENANT_1);

  await setPastoralLeader(m1, leaderA, TENANT_1, actor);
  await setPastoralLeader(m2, leaderA, TENANT_1, actor);

  // ── GROUP 1: bulk reassign ──────────────────────────────────────────────────

  console.log('\n── GROUP 1: bulk_reassign_leader_members_with_audit ──');

  const auditCountBeforeBulk = psqlQuery(`
    SELECT COUNT(*) FROM audit_logs
    WHERE entity_type = 'assignment' AND actor_id = '${actor}' AND action = 'SET_PASTORAL_LEADER'
  `);

  console.log('\n1.1/1.2: bulk reassign moves both members, count = 2');
  try {
    const result = await bulkReassignLeaderMembers(leaderA, leaderB, TENANT_1, actor);
    const stillOnA = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE leader_member_id = '${leaderA}' AND assignment_type = 'LEADER' AND deleted_at IS NULL`);
    const nowOnB = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE leader_member_id = '${leaderB}' AND assignment_type = 'LEADER' AND deleted_at IS NULL`);
    result.reassigned_count === 2 && stillOnA === '0' && nowOnB === '2'
      ? pass('1.1/1.2 bulk reassign moves + counts', `reassigned_count=${result.reassigned_count}, stillOnA=${stillOnA}, nowOnB=${nowOnB}`)
      : fail('1.1/1.2 bulk reassign moves + counts', `reassigned_count=${result.reassigned_count}, stillOnA=${stillOnA}, nowOnB=${nowOnB}`);
  } catch (e) { fail('1.1/1.2 bulk reassign moves + counts', (e as Error).message); }

  console.log('\n1.3: reassigning a Leader with nobody assigned -> reassigned_count = 0, no error');
  try {
    const result = await bulkReassignLeaderMembers(leaderC, leaderB, TENANT_1, actor);
    result.reassigned_count === 0
      ? pass('1.3 empty leader -> count 0', `reassigned_count=${result.reassigned_count}`)
      : fail('1.3 empty leader -> count 0', `expected 0, got ${result.reassigned_count}`);
  } catch (e) { fail('1.3 empty leader -> count 0', (e as Error).message); }

  console.log('\n1.4: each reassigned member gets its own SET_PASTORAL_LEADER audit row');
  try {
    // entity_id on this action is the assignment's own id (not the member id — see
    // set_member_pastoral_leader()'s write_audit_log call), so identify rows by actor_id +
    // action, same convention as the FP-69/72 test. Compare against the count captured before
    // the bulk reassign (which excludes the 2 setup calls' own SET rows) — the bulk reassign
    // of 2 members should add exactly 2 more distinct SET_PASTORAL_LEADER rows, not one
    // rolled-up "batch" entry.
    const countAfter = psqlQuery(`
      SELECT COUNT(*) FROM audit_logs
      WHERE entity_type = 'assignment' AND actor_id = '${actor}' AND action = 'SET_PASTORAL_LEADER'
    `);
    const delta = parseInt(countAfter, 10) - parseInt(auditCountBeforeBulk, 10);
    delta === 2
      ? pass('1.4 per-member audit rows', `new SET_PASTORAL_LEADER rows from bulk reassign=${delta}`)
      : fail('1.4 per-member audit rows', `expected delta 2, got ${delta} (before=${auditCountBeforeBulk}, after=${countAfter})`);
  } catch (e) { fail('1.4 per-member audit rows', (e as Error).message); }

  console.log('\n1.5: self-reassign (outgoing === incoming) -> VALIDATION_ERROR');
  try {
    await bulkReassignLeaderMembers(leaderB, leaderB, TENANT_1, actor);
    fail('1.5 self-reassign rejected', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'VALIDATION_ERROR'
      ? pass('1.5 self-reassign rejected', `threw VALIDATION_ERROR: ${(e as Error).message}`)
      : fail('1.5 self-reassign rejected', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
  }

  console.log('\n1.6: cross-tenant incoming leader -> CROSS_TENANT_ACCESS, batch rolled back');
  try {
    await bulkReassignLeaderMembers(leaderB, leaderT2, TENANT_1, actor);
    fail('1.6 cross-tenant incoming leader rejected', 'no error thrown');
  } catch (e) {
    const code = (e as { code?: string }).code;
    const stillOnB = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE leader_member_id = '${leaderB}' AND assignment_type = 'LEADER' AND deleted_at IS NULL`);
    code === 'CROSS_TENANT_ACCESS' && stillOnB === '2'
      ? pass('1.6 cross-tenant incoming leader rejected', `threw CROSS_TENANT_ACCESS, batch rolled back (stillOnB=${stillOnB})`)
      : fail('1.6 cross-tenant incoming leader rejected', `code=${code}, stillOnB=${stillOnB}, msg=${(e as Error).message}`);
  }

  // ── GROUP 2: deactivation guard ──────────────────────────────────────────────

  console.log('\n── GROUP 2: deactivation guard ──');

  console.log('\n2.1: softDeleteMember() on a member still an active Pastoral Leader -> INVALID_STATE_TRANSITION');
  try {
    await softDeleteMember(leaderB, TENANT_1);
    fail('2.1 deactivation blocked while assigned', 'no error thrown');
  } catch (e) {
    const code = (e as { code?: string }).code;
    const count = (e as { assignedMemberCount?: number }).assignedMemberCount;
    code === 'INVALID_STATE_TRANSITION' && count === 2
      ? pass('2.1 deactivation blocked while assigned', `threw INVALID_STATE_TRANSITION, assignedMemberCount=${count}`)
      : fail('2.1 deactivation blocked while assigned', `code=${code}, assignedMemberCount=${count}, msg=${(e as Error).message}`);
  }

  console.log('\n2.3: getMembersAssignedToLeader() reflects post-reassign state');
  try {
    const onA = await getMembersAssignedToLeader(leaderA, TENANT_1);
    const onB = await getMembersAssignedToLeader(leaderB, TENANT_1);
    onA.length === 0 && onB.length === 2
      ? pass('2.3 getMembersAssignedToLeader reflects state', `onA=${onA.length}, onB=${onB.length}`)
      : fail('2.3 getMembersAssignedToLeader reflects state', `onA=${onA.length}, onB=${onB.length}`);
  } catch (e) { fail('2.3 getMembersAssignedToLeader reflects state', (e as Error).message); }

  console.log('\n2.2: softDeleteMember() succeeds once nobody is assigned to them (after bulk reassign)');
  try {
    await bulkReassignLeaderMembers(leaderB, leaderA, TENANT_1, actor);
    await softDeleteMember(leaderB, TENANT_1);
    const deletedAt = psqlQuery(`SELECT deleted_at FROM members WHERE id = '${leaderB}'`);
    deletedAt !== ''
      ? pass('2.2 deactivation allowed once unassigned', `deleted_at=${deletedAt}`)
      : fail('2.2 deactivation allowed once unassigned', 'deleted_at still null');
  } catch (e) { fail('2.2 deactivation allowed once unassigned', (e as Error).message); }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  console.log('\nCleaning up fixtures...');
  psql(`DELETE FROM audit_logs WHERE entity_type = 'assignment' AND actor_id = '${actor}';`);
  for (const mid of createdMemberIds) {
    psql(`DELETE FROM assignments WHERE member_id = '${mid}' OR leader_member_id = '${mid}'; DELETE FROM members WHERE id = '${mid}';`);
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
