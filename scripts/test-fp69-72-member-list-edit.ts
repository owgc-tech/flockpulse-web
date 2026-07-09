/**
 * DIP-FP-69-FP-72 verification: Member List/Edit + assignments cross-tenant trigger +
 * atomic Pastoral Leader replace + NOT_FOUND_IN_TENANT fixes.
 *
 * GROUP 1 — cross-tenant validation trigger on assignments (new gap, closed by this DIP)
 *   1.1  group_id from a different tenant -> rejected (row never created)
 *   1.2  leader_member_id from a different tenant -> rejected (row never created)
 *   1.3  Same-tenant valid insert succeeds (sanity check the trigger doesn't over-block)
 *
 * GROUP 2 — atomic Pastoral Leader replace (set_member_pastoral_leader)
 *   2.1  Set -> exactly 1 active LEADER assignment
 *   2.2  Replace -> still exactly 1 active LEADER assignment (old one retired, not duplicated)
 *   2.3  Clear (null) -> 0 active LEADER assignments
 *   2.4  Cross-tenant leader_member_id -> CROSS_TENANT_ACCESS
 *   2.5  Audit log entries: SET_PASTORAL_LEADER / CLEAR_PASTORAL_LEADER, actor_id = member id
 *        (not auth.uid()), matching the established write_audit_log() convention
 *
 * GROUP 3 — NOT_FOUND_IN_TENANT fixes (real pre-existing defects closed by this DIP)
 *   3.1  updateMember() on a nonexistent id -> NOT_FOUND_IN_TENANT, not a raw 500
 *   3.2  updateMember() on a cross-tenant id -> NOT_FOUND_IN_TENANT
 *   3.3  softDeleteMember() on a nonexistent id -> NOT_FOUND_IN_TENANT, not a silent no-op success
 *   3.4  softDeleteMember() on a cross-tenant id -> NOT_FOUND_IN_TENANT
 *
 * GROUP 4 — getMemberById / listMembers(includeDeleted)
 *   4.1  getMemberById() returns the correct row
 *   4.2  getMemberById() on a nonexistent id -> NOT_FOUND_IN_TENANT
 *   4.3  listMembers(tenantId) excludes deactivated members by default (unchanged behavior)
 *   4.4  listMembers(tenantId, true) includes deactivated members
 *
 * Run: npx tsx scripts/test-fp69-72-member-list-edit.ts
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
const createdGroupIds: string[] = [];

function makeMember(name: string, tenantId: string): string {
  const id = newUuid();
  const userId = newUuid();
  psql(`
    INSERT INTO members (id, tenant_id, user_id, email, role, first_name, last_name, gender, marital_status, birthdate)
    VALUES ('${id}', '${tenantId}', '${userId}', '${name.toLowerCase()}@fp6972.t', 'MEMBER', '${name}', 'Test', 'MALE', 'SINGLE', '1990-01-01');
  `);
  createdMemberIds.push(id);
  return id;
}

function makeGroup(name: string, tenantId: string): string {
  const id = newUuid();
  psql(`INSERT INTO groups (id, tenant_id, name) VALUES ('${id}', '${tenantId}', '${name}');`);
  createdGroupIds.push(id);
  return id;
}

async function main() {
  const {
    listMembers, getMemberById, updateMember, softDeleteMember,
  } = await import('../src/features/members/service');
  const { getActiveLeaderAssignment, setPastoralLeader } = await import('../src/features/assignments/service');

  const m1 = makeMember('FP6972M1', TENANT_1);
  const m2 = makeMember('FP6972M2', TENANT_1);
  const m3 = makeMember('FP6972M3', TENANT_1);
  const mT2 = makeMember('FP6972MT2', TENANT_2);
  const gT1 = makeGroup('FP6972 Group T1', TENANT_1);
  const gT2 = makeGroup('FP6972 Group T2', TENANT_2);

  // ── GROUP 1: cross-tenant validation trigger on assignments ────────────────

  console.log('\n── GROUP 1: cross-tenant validation trigger on assignments ──');

  console.log('\n1.1: group_id from a different tenant -> rejected');
  {
    const badId = newUuid();
    psql(`INSERT INTO assignments (id, tenant_id, member_id, assignment_type, group_id) VALUES ('${badId}', '${TENANT_1}', '${m1}', 'GROUP', '${gT2}');`);
    const exists = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE id = '${badId}'`);
    exists === '0'
      ? pass('1.1 cross-tenant group_id rejected', 'row was not created — trigger fired')
      : fail('1.1 cross-tenant group_id rejected', `row was created despite tenant mismatch`);
  }

  console.log('\n1.2: leader_member_id from a different tenant -> rejected');
  {
    const badId = newUuid();
    psql(`INSERT INTO assignments (id, tenant_id, member_id, assignment_type, leader_member_id) VALUES ('${badId}', '${TENANT_1}', '${m1}', 'LEADER', '${mT2}');`);
    const exists = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE id = '${badId}'`);
    exists === '0'
      ? pass('1.2 cross-tenant leader_member_id rejected', 'row was not created — trigger fired')
      : fail('1.2 cross-tenant leader_member_id rejected', `row was created despite tenant mismatch`);
  }

  console.log('\n1.3: same-tenant valid insert succeeds (sanity check)');
  {
    const goodId = newUuid();
    psql(`INSERT INTO assignments (id, tenant_id, member_id, assignment_type, group_id) VALUES ('${goodId}', '${TENANT_1}', '${m1}', 'GROUP', '${gT1}');`);
    const exists = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE id = '${goodId}'`);
    exists === '1'
      ? pass('1.3 same-tenant insert succeeds', 'row created normally')
      : fail('1.3 same-tenant insert succeeds', `row was NOT created — trigger over-blocked a valid insert`);
    psql(`DELETE FROM assignments WHERE id = '${goodId}';`);
  }

  // ── GROUP 2: atomic Pastoral Leader replace ─────────────────────────────────

  console.log('\n── GROUP 2: atomic Pastoral Leader replace ──');

  console.log('\n2.1: set -> exactly 1 active LEADER assignment');
  try {
    await setPastoralLeader(m1, m2, TENANT_1, m1);
    const count = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE member_id = '${m1}' AND assignment_type = 'LEADER' AND deleted_at IS NULL`);
    count === '1'
      ? pass('2.1 set pastoral leader', `active LEADER assignments=${count}`)
      : fail('2.1 set pastoral leader', `expected 1, got ${count}`);
  } catch (e) { fail('2.1 set pastoral leader', (e as Error).message); }

  console.log('\n2.2: replace -> still exactly 1 active LEADER assignment');
  try {
    await setPastoralLeader(m1, m3, TENANT_1, m1);
    const count = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE member_id = '${m1}' AND assignment_type = 'LEADER' AND deleted_at IS NULL`);
    const current = await getActiveLeaderAssignment(m1, TENANT_1);
    count === '1' && current?.leader_member_id === m3
      ? pass('2.2 replace pastoral leader', `active LEADER assignments=${count}, current leader=${current?.leader_member_id}`)
      : fail('2.2 replace pastoral leader', `count=${count}, current=${JSON.stringify(current)}`);
  } catch (e) { fail('2.2 replace pastoral leader', (e as Error).message); }

  console.log('\n2.3: clear (null) -> 0 active LEADER assignments');
  try {
    await setPastoralLeader(m1, null, TENANT_1, m1);
    const count = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE member_id = '${m1}' AND assignment_type = 'LEADER' AND deleted_at IS NULL`);
    const current = await getActiveLeaderAssignment(m1, TENANT_1);
    count === '0' && current === null
      ? pass('2.3 clear pastoral leader', `active LEADER assignments=${count}, current=${current}`)
      : fail('2.3 clear pastoral leader', `count=${count}, current=${JSON.stringify(current)}`);
  } catch (e) { fail('2.3 clear pastoral leader', (e as Error).message); }

  console.log('\n2.4: cross-tenant leader_member_id -> CROSS_TENANT_ACCESS');
  try {
    await setPastoralLeader(m1, mT2, TENANT_1, m1);
    fail('2.4 cross-tenant leader rejected', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'CROSS_TENANT_ACCESS'
      ? pass('2.4 cross-tenant leader rejected', `threw CROSS_TENANT_ACCESS: ${(e as Error).message}`)
      : fail('2.4 cross-tenant leader rejected', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
  }

  console.log('\n2.5: audit log entries — SET/CLEAR_PASTORAL_LEADER, actor_id = member id');
  try {
    // Identify rows by actor_id = m1 (the actor used throughout 2.1-2.3) rather than by
    // leader_member_id — the 3-step set->replace->clear sequence means "before" and "after"
    // values shift each step, so filtering on a specific leader id misses the clear step.
    const auditRows = psqlQuery(`
      SELECT string_agg(action || ':' || actor_id, ',' ORDER BY created_at)
      FROM audit_logs WHERE entity_type = 'assignment' AND actor_id = '${m1}'
    `);
    const hasSet = auditRows.includes(`SET_PASTORAL_LEADER:${m1}`);
    const hasClear = auditRows.includes(`CLEAR_PASTORAL_LEADER:${m1}`);
    hasSet && hasClear
      ? pass('2.5 audit log entries', `rows: ${auditRows}`)
      : fail('2.5 audit log entries', `rows: ${auditRows}`);
  } catch (e) { fail('2.5 audit log entries', (e as Error).message); }

  // ── GROUP 3: NOT_FOUND_IN_TENANT fixes ──────────────────────────────────────

  console.log('\n── GROUP 3: NOT_FOUND_IN_TENANT fixes ──');

  const nonexistentId = newUuid();

  console.log('\n3.1: updateMember() on a nonexistent id -> NOT_FOUND_IN_TENANT');
  try {
    await updateMember(nonexistentId, TENANT_1, { firstName: 'X' });
    fail('3.1 updateMember nonexistent -> NOT_FOUND_IN_TENANT', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'NOT_FOUND_IN_TENANT'
      ? pass('3.1 updateMember nonexistent -> NOT_FOUND_IN_TENANT', `threw NOT_FOUND_IN_TENANT`)
      : fail('3.1 updateMember nonexistent -> NOT_FOUND_IN_TENANT', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
  }

  console.log('\n3.2: updateMember() on a cross-tenant id -> NOT_FOUND_IN_TENANT');
  try {
    await updateMember(mT2, TENANT_1, { firstName: 'X' });
    fail('3.2 updateMember cross-tenant -> NOT_FOUND_IN_TENANT', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'NOT_FOUND_IN_TENANT'
      ? pass('3.2 updateMember cross-tenant -> NOT_FOUND_IN_TENANT', `threw NOT_FOUND_IN_TENANT`)
      : fail('3.2 updateMember cross-tenant -> NOT_FOUND_IN_TENANT', `wrong code: ${(e as { code?: string }).code}`);
  }

  console.log('\n3.3: softDeleteMember() on a nonexistent id -> NOT_FOUND_IN_TENANT (not a silent no-op)');
  try {
    await softDeleteMember(newUuid(), TENANT_1);
    fail('3.3 softDeleteMember nonexistent -> NOT_FOUND_IN_TENANT', 'no error thrown — silent no-op regression');
  } catch (e) {
    (e as { code?: string }).code === 'NOT_FOUND_IN_TENANT'
      ? pass('3.3 softDeleteMember nonexistent -> NOT_FOUND_IN_TENANT', `threw NOT_FOUND_IN_TENANT`)
      : fail('3.3 softDeleteMember nonexistent -> NOT_FOUND_IN_TENANT', `wrong code: ${(e as { code?: string }).code}`);
  }

  console.log('\n3.4: softDeleteMember() on a cross-tenant id -> NOT_FOUND_IN_TENANT');
  try {
    await softDeleteMember(mT2, TENANT_1);
    fail('3.4 softDeleteMember cross-tenant -> NOT_FOUND_IN_TENANT', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'NOT_FOUND_IN_TENANT'
      ? pass('3.4 softDeleteMember cross-tenant -> NOT_FOUND_IN_TENANT', `threw NOT_FOUND_IN_TENANT`)
      : fail('3.4 softDeleteMember cross-tenant -> NOT_FOUND_IN_TENANT', `wrong code: ${(e as { code?: string }).code}`);
  }

  // ── GROUP 4: getMemberById / listMembers(includeDeleted) ───────────────────

  console.log('\n── GROUP 4: getMemberById / listMembers(includeDeleted) ──');

  console.log('\n4.1: getMemberById() returns the correct row');
  try {
    const fetched = await getMemberById(m2, TENANT_1);
    fetched.id === m2 && fetched.first_name === 'FP6972M2'
      ? pass('4.1 getMemberById correct row', `id=${fetched.id}, first_name=${fetched.first_name}`)
      : fail('4.1 getMemberById correct row', `got ${JSON.stringify(fetched)}`);
  } catch (e) { fail('4.1 getMemberById correct row', (e as Error).message); }

  console.log('\n4.2: getMemberById() on a nonexistent id -> NOT_FOUND_IN_TENANT');
  try {
    await getMemberById(nonexistentId, TENANT_1);
    fail('4.2 getMemberById nonexistent -> NOT_FOUND_IN_TENANT', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'NOT_FOUND_IN_TENANT'
      ? pass('4.2 getMemberById nonexistent -> NOT_FOUND_IN_TENANT', `threw NOT_FOUND_IN_TENANT`)
      : fail('4.2 getMemberById nonexistent -> NOT_FOUND_IN_TENANT', `wrong code: ${(e as { code?: string }).code}`);
  }

  console.log('\n4.3: listMembers(tenantId) excludes deactivated members by default');
  try {
    await softDeleteMember(m3, TENANT_1);
    const activeOnly = await listMembers(TENANT_1);
    const found = (activeOnly ?? []).some((m: { id: string }) => m.id === m3);
    !found
      ? pass('4.3 listMembers excludes deactivated by default', `m3 not present in default list`)
      : fail('4.3 listMembers excludes deactivated by default', `m3 unexpectedly present`);
  } catch (e) { fail('4.3 listMembers excludes deactivated by default', (e as Error).message); }

  console.log('\n4.4: listMembers(tenantId, true) includes deactivated members');
  try {
    const withDeleted = await listMembers(TENANT_1, true);
    const found = (withDeleted ?? []).some((m: { id: string; deleted_at: string | null }) => m.id === m3 && m.deleted_at !== null);
    found
      ? pass('4.4 listMembers includeDeleted=true includes deactivated', `m3 present with deleted_at set`)
      : fail('4.4 listMembers includeDeleted=true includes deactivated', `m3 not found or deleted_at not set`);
  } catch (e) { fail('4.4 listMembers includeDeleted=true includes deactivated', (e as Error).message); }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  console.log('\nCleaning up fixtures...');
  psql(`DELETE FROM audit_logs WHERE entity_type = 'assignment' AND actor_id IN ('${m1}', '${m2}', '${m3}');`);
  for (const gid of createdGroupIds) {
    psql(`DELETE FROM assignments WHERE group_id = '${gid}'; DELETE FROM groups WHERE id = '${gid}';`);
  }
  for (const mid of createdMemberIds) {
    psql(`DELETE FROM assignments WHERE member_id = '${mid}' OR leader_member_id = '${mid}'; DELETE FROM members WHERE id = '${mid}';`);
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
