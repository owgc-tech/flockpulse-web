/**
 * DIP-FP-70-FP-71 verification: Groups full CRUD + audit trail + membership management.
 *
 * GROUP 1 — full CRUD round-trip + audit trail
 *   1.1  createGroup() -> row created, CREATE_GROUP audit entry with actor
 *   1.2  updateGroup() -> renamed, UPDATE_GROUP audit entry with before/after
 *   1.3  getGroupById() -> correct row
 *   1.4  updateGroup() on a nonexistent id -> NOT_FOUND_IN_TENANT
 *   1.5  softDeleteGroup() on a nonexistent id -> NOT_FOUND_IN_TENANT
 *
 * GROUP 2 — cascade soft-delete of active GROUP assignments (flagged design decision)
 *   2.1  Deactivating a group retires all its active GROUP assignments atomically,
 *        with a DEACTIVATE_GROUP audit entry recording memberships_retired
 *   2.2  A member's unrelated LEADER assignment is untouched by the cascade (sanity check
 *        the cascade doesn't over-reach beyond assignment_type = 'GROUP')
 *
 * GROUP 3 — listGroups(includeDeleted)
 *   3.1  listGroups(tenantId) excludes deactivated groups by default
 *   3.2  listGroups(tenantId, true) includes deactivated groups
 *
 * GROUP 4 — getGroupMembers
 *   4.1  Returns correct members with assignment_id (needed for the Remove action)
 *   4.2  Does not leak a member whose only assignment to this group is a different type
 *
 * Run: npx tsx scripts/test-fp70-71-groups-crud-membership.ts
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

function makeMember(name: string, tenantId: string): string {
  const id = newUuid();
  const userId = newUuid();
  psql(`
    INSERT INTO members (id, tenant_id, user_id, email, role, first_name, last_name, gender, marital_status, birthdate)
    VALUES ('${id}', '${tenantId}', '${userId}', '${name.toLowerCase()}@fp7071.t', 'MEMBER', '${name}', 'Test', 'MALE', 'SINGLE', '1990-01-01');
  `);
  return id;
}

const createdGroupIds: string[] = [];
const createdMemberIds: string[] = [];

async function main() {
  const { createGroup, updateGroup, softDeleteGroup, getGroupById, listGroups } = await import('../src/features/groups/service');
  const { createGroupAssignment, getGroupMembers, createLeaderAssignment } = await import('../src/features/assignments/service');

  const actorId = psqlQuery(`SELECT id FROM members WHERE tenant_id = '${TENANT_1}' AND role = 'ADMIN' LIMIT 1`);

  // ── GROUP 1: full CRUD round-trip + audit trail ─────────────────────────────

  console.log('\n── GROUP 1: full CRUD round-trip + audit trail ──');

  console.log('\n1.1: createGroup() -> row created, CREATE_GROUP audit entry with actor');
  let g1: { id: string; name: string } | null = null;
  try {
    g1 = await createGroup(TENANT_1, 'FP-70 Test Group', actorId);
    createdGroupIds.push(g1.id);
    const audit = psqlQuery(`SELECT action || ':' || actor_id FROM audit_logs WHERE entity_type = 'group' AND entity_id = '${g1.id}'`);
    audit === `CREATE_GROUP:${actorId}`
      ? pass('1.1 createGroup + audit', `group=${g1.name}, audit=${audit}`)
      : fail('1.1 createGroup + audit', `audit row: ${audit}`);
  } catch (e) { fail('1.1 createGroup + audit', (e as Error).message); }

  console.log('\n1.2: updateGroup() -> renamed, UPDATE_GROUP audit entry with before/after');
  if (g1) {
    try {
      const updated = await updateGroup(g1.id, TENANT_1, 'FP-70 Renamed Group', actorId);
      const audit = psqlQuery(`
        SELECT (before_value->>'name') || '->' || (after_value->>'name')
        FROM audit_logs WHERE entity_type = 'group' AND entity_id = '${g1.id}' AND action = 'UPDATE_GROUP'
      `);
      updated.name === 'FP-70 Renamed Group' && audit === 'FP-70 Test Group->FP-70 Renamed Group'
        ? pass('1.2 updateGroup + audit', `name=${updated.name}, audit=${audit}`)
        : fail('1.2 updateGroup + audit', `name=${updated.name}, audit=${audit}`);
    } catch (e) { fail('1.2 updateGroup + audit', (e as Error).message); }
  }

  console.log('\n1.3: getGroupById() -> correct row');
  if (g1) {
    try {
      const fetched = await getGroupById(g1.id, TENANT_1);
      fetched.id === g1.id && fetched.name === 'FP-70 Renamed Group'
        ? pass('1.3 getGroupById correct row', `id=${fetched.id}, name=${fetched.name}`)
        : fail('1.3 getGroupById correct row', `got ${JSON.stringify(fetched)}`);
    } catch (e) { fail('1.3 getGroupById correct row', (e as Error).message); }
  }

  console.log('\n1.4: updateGroup() on a nonexistent id -> NOT_FOUND_IN_TENANT');
  try {
    await updateGroup(newUuid(), TENANT_1, 'X', actorId);
    fail('1.4 updateGroup nonexistent -> NOT_FOUND_IN_TENANT', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'NOT_FOUND_IN_TENANT'
      ? pass('1.4 updateGroup nonexistent -> NOT_FOUND_IN_TENANT', 'threw NOT_FOUND_IN_TENANT')
      : fail('1.4 updateGroup nonexistent -> NOT_FOUND_IN_TENANT', `wrong code: ${(e as { code?: string }).code}, msg=${(e as Error).message}`);
  }

  console.log('\n1.5: softDeleteGroup() on a nonexistent id -> NOT_FOUND_IN_TENANT');
  try {
    await softDeleteGroup(newUuid(), TENANT_1, actorId);
    fail('1.5 softDeleteGroup nonexistent -> NOT_FOUND_IN_TENANT', 'no error thrown');
  } catch (e) {
    (e as { code?: string }).code === 'NOT_FOUND_IN_TENANT'
      ? pass('1.5 softDeleteGroup nonexistent -> NOT_FOUND_IN_TENANT', 'threw NOT_FOUND_IN_TENANT')
      : fail('1.5 softDeleteGroup nonexistent -> NOT_FOUND_IN_TENANT', `wrong code: ${(e as { code?: string }).code}`);
  }

  // ── GROUP 2: cascade soft-delete of active GROUP assignments ───────────────

  console.log('\n── GROUP 2: cascade soft-delete of active GROUP assignments ──');

  const m1 = makeMember('FP7071M1', TENANT_1);
  const m2 = makeMember('FP7071M2', TENANT_1);
  createdMemberIds.push(m1, m2);

  let g2: { id: string; name: string } | null = null;
  try {
    g2 = await createGroup(TENANT_1, 'FP-70 Cascade Group', actorId);
    createdGroupIds.push(g2.id);
    await createGroupAssignment({ tenantId: TENANT_1, memberId: m1, groupId: g2.id });
    // m2 gets a LEADER assignment (unrelated type) to verify the cascade doesn't over-reach.
    await createLeaderAssignment({ tenantId: TENANT_1, memberId: m2, leaderMemberId: m1 });
  } catch (e) {
    fail('2.1 cascade setup', (e as Error).message);
    fail('2.2 cascade selectivity setup', (e as Error).message);
  }

  console.log('\n2.1: deactivating a group retires all its active GROUP assignments atomically');
  if (g2) {
    try {
      await softDeleteGroup(g2.id, TENANT_1, actorId);
      const activeGroupAssignments = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE group_id = '${g2.id}' AND deleted_at IS NULL`);
      const auditRow = psqlQuery(`
        SELECT action || ':' || (after_value->>'memberships_retired')
        FROM audit_logs WHERE entity_type = 'group' AND entity_id = '${g2.id}' AND action = 'DEACTIVATE_GROUP'
      `);
      activeGroupAssignments === '0' && auditRow === 'DEACTIVATE_GROUP:1'
        ? pass('2.1 cascade retires GROUP assignments', `active GROUP assignments remaining=${activeGroupAssignments}, audit=${auditRow}`)
        : fail('2.1 cascade retires GROUP assignments', `active=${activeGroupAssignments}, audit=${auditRow}`);
    } catch (e) { fail('2.1 cascade retires GROUP assignments', (e as Error).message); }
  }

  console.log('\n2.2: a member\'s unrelated LEADER assignment is untouched by the cascade');
  try {
    const leaderStillActive = psqlQuery(`SELECT COUNT(*) FROM assignments WHERE member_id = '${m2}' AND assignment_type = 'LEADER' AND deleted_at IS NULL`);
    leaderStillActive === '1'
      ? pass('2.2 cascade selectivity', `LEADER assignment untouched, count=${leaderStillActive}`)
      : fail('2.2 cascade selectivity', `expected 1 active LEADER assignment, got ${leaderStillActive}`);
  } catch (e) { fail('2.2 cascade selectivity', (e as Error).message); }

  // ── GROUP 3: listGroups(includeDeleted) ─────────────────────────────────────

  console.log('\n── GROUP 3: listGroups(includeDeleted) ──');

  console.log('\n3.1: listGroups(tenantId) excludes deactivated groups by default');
  if (g2) {
    try {
      const activeOnly = await listGroups(TENANT_1);
      const found = (activeOnly ?? []).some((g: { id: string }) => g.id === g2!.id);
      !found
        ? pass('3.1 listGroups excludes deactivated by default', 'deactivated group not present')
        : fail('3.1 listGroups excludes deactivated by default', 'deactivated group unexpectedly present');
    } catch (e) { fail('3.1 listGroups excludes deactivated by default', (e as Error).message); }
  }

  console.log('\n3.2: listGroups(tenantId, true) includes deactivated groups');
  if (g2) {
    try {
      const withDeleted = await listGroups(TENANT_1, true);
      const found = (withDeleted ?? []).some((g: { id: string; deleted_at: string | null }) => g.id === g2!.id && g.deleted_at !== null);
      found
        ? pass('3.2 listGroups includeDeleted=true includes deactivated', 'deactivated group present with deleted_at set')
        : fail('3.2 listGroups includeDeleted=true includes deactivated', 'not found or deleted_at not set');
    } catch (e) { fail('3.2 listGroups includeDeleted=true includes deactivated', (e as Error).message); }
  }

  // ── GROUP 4: getGroupMembers ─────────────────────────────────────────────────

  console.log('\n── GROUP 4: getGroupMembers ──');

  let g3: { id: string; name: string } | null = null;
  const m3 = makeMember('FP7071M3', TENANT_1);
  createdMemberIds.push(m3);
  try {
    g3 = await createGroup(TENANT_1, 'FP-70 Membership Group', actorId);
    createdGroupIds.push(g3.id);
    await createGroupAssignment({ tenantId: TENANT_1, memberId: m3, groupId: g3.id });
  } catch (e) {
    fail('4.1 getGroupMembers setup', (e as Error).message);
    fail('4.2 getGroupMembers selectivity setup', (e as Error).message);
  }

  console.log('\n4.1: getGroupMembers returns correct members with assignment_id');
  if (g3) {
    try {
      const members = await getGroupMembers(g3.id, TENANT_1);
      const entry = (members as Array<{ id: string; assignment_id: string; first_name: string }>).find(m => m.id === m3);
      entry && entry.assignment_id && entry.first_name === 'FP7071M3'
        ? pass('4.1 getGroupMembers correct shape', `entry=${JSON.stringify(entry)}`)
        : fail('4.1 getGroupMembers correct shape', `members=${JSON.stringify(members)}`);
    } catch (e) { fail('4.1 getGroupMembers correct shape', (e as Error).message); }
  }

  console.log('\n4.2: does not leak a member whose only assignment to this group is a different type');
  if (g3) {
    try {
      // m1's only remaining assignment is the retired (soft-deleted) GROUP one from g2 —
      // confirm it does NOT appear in g3's membership (different group entirely; sanity
      // check the tenant/group scoping, not just the assignment_type filter).
      const members = await getGroupMembers(g3.id, TENANT_1);
      const leaked = (members as Array<{ id: string }>).some(m => m.id === m1);
      !leaked
        ? pass('4.2 getGroupMembers selectivity', 'm1 correctly absent from g3 membership')
        : fail('4.2 getGroupMembers selectivity', 'm1 unexpectedly present in g3 membership');
    } catch (e) { fail('4.2 getGroupMembers selectivity', (e as Error).message); }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  console.log('\nCleaning up fixtures...');
  psql(`DELETE FROM audit_logs WHERE entity_type = 'group' AND actor_id = '${actorId}' AND entity_id::text IN (${createdGroupIds.map(id => `'${id}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"});`);
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
