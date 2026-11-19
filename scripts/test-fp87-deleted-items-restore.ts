/**
 * FP-87 deleted-items restore verification.
 *
 * GROUP 1 — List queries: tenant isolation
 *   1.1  listDeletedCourses: returns only deleted courses for the tenant
 *   1.2  listDeletedCourses: does not return active courses
 *   1.3  listDeletedCourses: does not return deleted courses from other tenant
 *   1.4  listDeletedModules: returns deleted modules for the tenant (tenant-wide)
 *   1.5  listDeletedModules: does not return modules from other tenant
 *   1.6  listDeletedTalks: returns deleted talks for the tenant (tenant-wide)
 *   1.7  listDeletedTalks: does not return talks from other tenant
 *
 * GROUP 2 — sequence_order reassignment on restore
 *   2.1  restoreCourse: restored course gets sequence_order = max_active + 1
 *   2.2  restoreCourse: no collision even when old position is occupied
 *   2.3  restoreModule: restored module gets sequence_order = max_active + 1
 *   2.4  restoreTalk: restored talk gets sequence_order = max_active + 1
 *
 * GROUP 3 — Parent-deleted blocking
 *   3.1  restoreModule blocked when parent Course is deleted (INVALID_STATE_TRANSITION)
 *   3.2  restoreModule error message names the parent course
 *   3.3  restoreTalk blocked when parent Module is deleted (INVALID_STATE_TRANSITION)
 *   3.4  restoreTalk error message names the parent module
 *   3.5  restoreModule succeeds once parent Course is restored
 *
 * GROUP 4 — Deletion-guard triggers do NOT fire on restore
 *   4.1  restoring a course does not trigger the course deletion guard
 *   4.2  restoring a module does not trigger the module deletion guard
 *
 * Run: npx tsx scripts/test-fp87-deleted-items-restore.ts
 * Requires local Supabase running + migration 20260707000024 applied.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { createClient } from '@supabase/supabase-js';
import { listDeletedCourses, restoreCourse } from '../src/features/formation/course.service';
import { listDeletedModules, restoreModule } from '../src/features/formation/module.service';
import { listDeletedTalks, restoreTalk } from '../src/features/formation/talk.service';
import { createCourse, updateCourse } from '../src/features/formation/course.service';
import { createModule, updateModule } from '../src/features/formation/module.service';
import { createTalk } from '../src/features/formation/talk.service';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Test runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗  ${label}\n     ${msg}`);
    failed++;
    failures.push(`${label}: ${msg}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// ── Setup ────────────────────────────────────────────────────────────────────
async function setupTenant(name: string): Promise<string> {
  const { data, error } = await supa.from('tenants').insert({ name }).select('id').single();
  if (error || !data) throw new Error(`Failed to create tenant ${name}: ${error?.message}`);
  return data.id;
}

async function cleanup(tenantIds: string[]) {
  for (const tid of tenantIds) {
    await supa.from('talks').delete().eq('tenant_id', tid);
    await supa.from('modules').delete().eq('tenant_id', tid);
    await supa.from('courses').delete().eq('tenant_id', tid);
    await supa.from('tenants').delete().eq('id', tid);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  let tenantA = '';
  let tenantB = '';

  try {
    tenantA = await setupTenant('FP-87 Tenant A');
    tenantB = await setupTenant('FP-87 Tenant B');
  } catch (e) {
    console.error('Setup failed:', e);
    process.exit(1);
  }

  // Shared fixtures for tenant A
  const activeCourse = await createCourse(tenantA, { name: 'Active Course', sequenceOrder: 1 });
  const deletedCourse = await createCourse(tenantA, { name: 'Deleted Course', sequenceOrder: 2 });
  await updateCourse(deletedCourse.id, tenantA, { deletedAt: new Date().toISOString() });

  // Tenant B course (should not appear in tenant A queries)
  const tenantBCourse = await createCourse(tenantB, { name: 'Tenant B Course', sequenceOrder: 1 });
  const tenantBDeleted = await createCourse(tenantB, { name: 'Tenant B Deleted', sequenceOrder: 2 });
  await updateCourse(tenantBDeleted.id, tenantB, { deletedAt: new Date().toISOString() });

  // Modules
  const activeModule = await createModule(tenantA, { courseId: activeCourse.id, name: 'Active Module', sequenceOrder: 1 });
  const deletedModule = await createModule(tenantA, { courseId: activeCourse.id, name: 'Deleted Module', sequenceOrder: 2 });
  // Soft-delete the module via raw update (bypass deletion guard — no talks exist yet)
  await supa.from('modules').update({ deleted_at: new Date().toISOString() }).eq('id', deletedModule.id);

  // Tenant B module
  const tenantBModule = await createModule(tenantB, { courseId: tenantBCourse.id, name: 'B Module', sequenceOrder: 1 });
  const tenantBDeletedModule = await createModule(tenantB, { courseId: tenantBCourse.id, name: 'B Deleted Module', sequenceOrder: 2 });
  await supa.from('modules').update({ deleted_at: new Date().toISOString() }).eq('id', tenantBDeletedModule.id);

  // Talks
  const activeTalk = await createTalk(tenantA, {
    moduleId: activeModule.id, name: 'Active Talk', sequenceOrder: 1,
    forSingleMen: true, forSingleWomen: false, forMarriedMen: false, forMarriedWomen: false,
  });
  const deletedTalk = await createTalk(tenantA, {
    moduleId: activeModule.id, name: 'Deleted Talk', sequenceOrder: 2,
    forSingleMen: true, forSingleWomen: false, forMarriedMen: false, forMarriedWomen: false,
  });
  await supa.from('talks').update({ deleted_at: new Date().toISOString() }).eq('id', deletedTalk.id);

  // Tenant B talk
  const tenantBTalk = await createTalk(tenantB, {
    moduleId: tenantBModule.id, name: 'B Talk', sequenceOrder: 1,
    forSingleMen: true, forSingleWomen: false, forMarriedMen: false, forMarriedWomen: false,
  });
  const tenantBDeletedTalk = await createTalk(tenantB, {
    moduleId: tenantBModule.id, name: 'B Deleted Talk', sequenceOrder: 2,
    forSingleMen: true, forSingleWomen: false, forMarriedMen: false, forMarriedWomen: false,
  });
  await supa.from('talks').update({ deleted_at: new Date().toISOString() }).eq('id', tenantBDeletedTalk.id);

  // ── GROUP 1 — Tenant isolation ───────────────────────────────────────────
  console.log('\nGROUP 1 — List queries: tenant isolation');

  await test('1.1  listDeletedCourses: returns deleted courses for tenant', async () => {
    const rows = await listDeletedCourses(tenantA);
    assert(rows.some(c => c.id === deletedCourse.id), 'deleted course not in list');
  });

  await test('1.2  listDeletedCourses: does not return active courses', async () => {
    const rows = await listDeletedCourses(tenantA);
    assert(!rows.some(c => c.id === activeCourse.id), 'active course should not be in deleted list');
  });

  await test('1.3  listDeletedCourses: does not return other tenant deleted courses', async () => {
    const rows = await listDeletedCourses(tenantA);
    assert(!rows.some(c => c.id === tenantBDeleted.id), 'tenant B course leaked into tenant A list');
  });

  await test('1.4  listDeletedModules: returns deleted modules for tenant (tenant-wide)', async () => {
    const rows = await listDeletedModules(tenantA);
    assert(rows.some(m => m.id === deletedModule.id), 'deleted module not in tenant-wide list');
    assert(rows.find(m => m.id === deletedModule.id)?.course_name === activeCourse.name,
      'course_name not populated correctly');
  });

  await test('1.5  listDeletedModules: does not return modules from other tenant', async () => {
    const rows = await listDeletedModules(tenantA);
    assert(!rows.some(m => m.id === tenantBDeletedModule.id), 'tenant B module leaked into tenant A list');
  });

  await test('1.6  listDeletedTalks: returns deleted talks for tenant (tenant-wide)', async () => {
    const rows = await listDeletedTalks(tenantA);
    assert(rows.some(t => t.id === deletedTalk.id), 'deleted talk not in tenant-wide list');
    assert(rows.find(t => t.id === deletedTalk.id)?.module_name === activeModule.name,
      'module_name not populated correctly');
  });

  await test('1.7  listDeletedTalks: does not return talks from other tenant', async () => {
    const rows = await listDeletedTalks(tenantA);
    assert(!rows.some(t => t.id === tenantBDeletedTalk.id), 'tenant B talk leaked into tenant A list');
  });

  // ── GROUP 2 — sequence_order reassignment ────────────────────────────────
  console.log('\nGROUP 2 — sequence_order reassignment on restore');

  await test('2.1  restoreCourse: gets sequence_order = max_active + 1', async () => {
    // activeCourse is at position 1; deletedCourse had position 2 before deletion
    // After restore, should get position 2 (max active = 1, so max + 1 = 2)
    const restored = await restoreCourse(deletedCourse.id, tenantA);
    assert(restored.deleted_at === null, 'deleted_at should be null after restore');
    assert(restored.sequence_order === 2, `expected sequence_order 2, got ${restored.sequence_order}`);
    // Re-delete for subsequent tests
    await updateCourse(restored.id, tenantA, { deletedAt: new Date().toISOString() });
  });

  await test('2.2  restoreCourse: no collision when old position is now occupied', async () => {
    // Create a course that takes position 2 (the old position of deletedCourse)
    const occupier = await createCourse(tenantA, { name: 'Occupier Course', sequenceOrder: 2 });
    // Now max active = 2, so restore should land at 3
    const restored = await restoreCourse(deletedCourse.id, tenantA);
    assert(restored.sequence_order === 3, `expected 3, got ${restored.sequence_order}`);
    // Clean up
    await updateCourse(restored.id, tenantA, { deletedAt: new Date().toISOString() });
    await supa.from('courses').delete().eq('id', occupier.id);
  });

  await test('2.3  restoreModule: gets sequence_order = max_active + 1', async () => {
    // activeModule is at 1; deletedModule had 2
    const restored = await restoreModule(deletedModule.id, tenantA);
    assert(restored.deleted_at === null, 'deleted_at should be null');
    assert(restored.sequence_order === 2, `expected 2, got ${restored.sequence_order}`);
    // Re-delete for next group
    await supa.from('modules').update({ deleted_at: new Date().toISOString() }).eq('id', restored.id);
  });

  await test('2.4  restoreTalk: gets sequence_order = max_active + 1', async () => {
    // activeTalk is at 1; deletedTalk had 2
    const restored = await restoreTalk(deletedTalk.id, tenantA);
    assert(restored.deleted_at === null, 'deleted_at should be null');
    assert(restored.sequence_order === 2, `expected 2, got ${restored.sequence_order}`);
    // Re-delete for later tests
    await supa.from('talks').update({ deleted_at: new Date().toISOString() }).eq('id', restored.id);
  });

  // ── GROUP 3 — Parent-deleted blocking ────────────────────────────────────
  console.log('\nGROUP 3 — Parent-deleted blocking');

  // Create a module under the deleted course to test blocking
  // We do this via raw insert since the service rejects creating under deleted parent
  const { data: orphanModule } = await supa.from('modules').insert({
    tenant_id: tenantA,
    course_id: deletedCourse.id,
    name: 'Orphan Module',
    sequence_order: 1,
    deleted_at: new Date().toISOString(),
  }).select('id, name').single();

  const { data: orphanTalk } = await supa.from('talks').insert({
    tenant_id: tenantA,
    module_id: deletedModule.id,
    name: 'Orphan Talk',
    sequence_order: 3,
    for_single_men: true,
    for_single_women: false,
    for_married_men: false,
    for_married_women: false,
    deleted_at: new Date().toISOString(),
  }).select('id, name').single();

  await test('3.1  restoreModule blocked when parent Course is deleted', async () => {
    try {
      await restoreModule(orphanModule!.id, tenantA);
      assert(false, 'Expected INVALID_STATE_TRANSITION but succeeded');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      assert(code === 'INVALID_STATE_TRANSITION', `Expected INVALID_STATE_TRANSITION, got: ${code}`);
    }
  });

  await test('3.2  restoreModule error message names the parent course', async () => {
    try {
      await restoreModule(orphanModule!.id, tenantA);
    } catch (e: unknown) {
      const msg = (e as Error).message ?? '';
      assert(msg.includes(deletedCourse.name), `Error message should name "${deletedCourse.name}", got: "${msg}"`);
    }
  });

  await test('3.3  restoreTalk blocked when parent Module is deleted', async () => {
    try {
      await restoreTalk(orphanTalk!.id, tenantA);
      assert(false, 'Expected INVALID_STATE_TRANSITION but succeeded');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      assert(code === 'INVALID_STATE_TRANSITION', `Expected INVALID_STATE_TRANSITION, got: ${code}`);
    }
  });

  await test('3.4  restoreTalk error message names the parent module', async () => {
    try {
      await restoreTalk(orphanTalk!.id, tenantA);
    } catch (e: unknown) {
      const msg = (e as Error).message ?? '';
      assert(msg.includes(deletedModule.name), `Error message should name "${deletedModule.name}", got: "${msg}"`);
    }
  });

  await test('3.5  restoreModule succeeds once parent Course is restored', async () => {
    // Restore the parent course first
    const restoredCourse = await restoreCourse(deletedCourse.id, tenantA);
    assert(restoredCourse.deleted_at === null, 'course should be restored');

    // Now the module should restore successfully
    const restoredModule = await restoreModule(orphanModule!.id, tenantA);
    assert(restoredModule.deleted_at === null, 'module should be restored once parent is restored');
  });

  // ── GROUP 4 — Deletion-guard triggers do NOT fire on restore ─────────────
  console.log('\nGROUP 4 — Deletion-guard triggers do not fire on restore');

  await test('4.1  restoring a course with active children does not trigger deletion guard', async () => {
    // Create a new course+module, delete only the course (raw insert to bypass service guard)
    const { data: guardCourse } = await supa.from('courses').insert({
      tenant_id: tenantA, name: 'Guard Test Course', sequence_order: 99,
      deleted_at: new Date().toISOString(),
    }).select('id').single();
    await supa.from('modules').insert({
      tenant_id: tenantA, course_id: guardCourse!.id, name: 'Guard Test Module', sequence_order: 1,
    });

    // Restoring should succeed — guard only fires on soft-delete, not restore
    const restored = await restoreCourse(guardCourse!.id, tenantA);
    assert(restored.deleted_at === null, 'Course should restore without hitting deletion guard');

    // Cleanup
    await supa.from('modules').delete().eq('course_id', guardCourse!.id);
    await supa.from('courses').delete().eq('id', guardCourse!.id);
  });

  await test('4.2  restoring a module with active talks does not trigger deletion guard', async () => {
    // Create a module+talk under an active course, delete only the module
    const { data: guardModule } = await supa.from('modules').insert({
      tenant_id: tenantA, course_id: activeCourse.id, name: 'Guard Test Module', sequence_order: 99,
      deleted_at: new Date().toISOString(),
    }).select('id').single();
    await supa.from('talks').insert({
      tenant_id: tenantA, module_id: guardModule!.id, name: 'Guard Test Talk', sequence_order: 1,
      for_single_men: true, for_single_women: false, for_married_men: false, for_married_women: false,
    });

    const restored = await restoreModule(guardModule!.id, tenantA);
    assert(restored.deleted_at === null, 'Module should restore without hitting deletion guard');

    // Cleanup
    await supa.from('talks').delete().eq('module_id', guardModule!.id);
    await supa.from('modules').delete().eq('id', guardModule!.id);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await cleanup([tenantA, tenantB]);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error('\nFailures:');
    failures.forEach(f => console.error(`  • ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
