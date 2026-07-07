/**
 * FP-76/82/83/84/85/86 formation admin verification.
 *
 * GROUP 1 — Schema / migration
 *   1.1  courses, modules, talks tables have alias + description columns
 *   1.2  talks table has demographic columns (for_single_men/women, for_married_men/women)
 *   1.3  talks demographic CHECK constraint rejects all-false row
 *   1.4  reorder_courses() RPC exists in public schema
 *   1.5  reorder_modules() RPC exists in public schema
 *   1.6  reorder_talks() RPC exists in public schema
 *
 * GROUP 2 — Course service
 *   2.1  createCourse() inserts with alias + description
 *   2.2  updateCourse() updates alias + description
 *   2.3  reorderCourses() reorders via two-phase: sequence_order values correct after
 *   2.4  Course deletion guard: soft-delete blocked when active modules exist
 *   2.5  Course deletion succeeds once modules are also soft-deleted
 *
 * GROUP 3 — Module service
 *   3.1  createModule() inserts with alias + description
 *   3.2  reorderModules() reorders correctly
 *   3.3  Module deletion guard: soft-delete blocked when active talks exist
 *   3.4  Module deletion succeeds once talks are soft-deleted
 *
 * GROUP 4 — Talk service
 *   4.1  createTalk() inserts with demographics
 *   4.2  createTalk() throws VALIDATION_ERROR when all demographics false
 *   4.3  reorderTalks() reorders correctly
 *   4.4  Cross-tenant access: reorderCourses rejects IDs from different tenant
 *
 * Run: npx tsx scripts/test-fp76-82-83-84-85-86-formation-admin.ts
 * Requires local Supabase running + migration 20260707000024 applied.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { createClient } from '@supabase/supabase-js';
import {
  createCourse, updateCourse, reorderCourses,
} from '../src/features/formation/course.service';
import {
  createModule, updateModule, reorderModules,
} from '../src/features/formation/module.service';
import {
  createTalk, reorderTalks,
} from '../src/features/formation/talk.service';

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

// ── Setup: create two tenants for cross-tenant test ──────────────────────────
async function setupTenants(): Promise<{ tenantA: string; tenantB: string }> {
  const { data: tenantA, error: eA } = await supa
    .from('tenants')
    .insert({ name: 'Formation Test Tenant A' })
    .select('id')
    .single();
  if (eA || !tenantA) throw new Error(`Failed to create tenant A: ${eA?.message}`);

  const { data: tenantB, error: eB } = await supa
    .from('tenants')
    .insert({ name: 'Formation Test Tenant B' })
    .select('id')
    .single();
  if (eB || !tenantB) throw new Error(`Failed to create tenant B: ${eB?.message}`);

  return { tenantA: tenantA.id, tenantB: tenantB.id };
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
    ({ tenantA, tenantB } = await setupTenants());
  } catch (e) {
    console.error('Setup failed:', e);
    process.exit(1);
  }

  // ── GROUP 1 — Schema / migration ─────────────────────────────────────────
  console.log('\nGROUP 1 — Schema / migration');

  await test('1.1  courses/modules/talks have alias + description', async () => {
    const { error: ce } = await supa.from('courses')
      .insert({ tenant_id: tenantA, name: 'Schema check', alias: 'sc', description: 'desc', sequence_order: 99 })
      .select('alias, description').single();
    assert(!ce, `courses insert failed: ${ce?.message}`);

    const { error: me } = await supa.from('modules')
      .select('alias, description').limit(0);
    assert(!me, `modules has no alias/description: ${me?.message}`);

    const { error: te } = await supa.from('talks')
      .select('alias, description').limit(0);
    assert(!te, `talks has no alias/description: ${te?.message}`);

    // cleanup the schema-check row
    await supa.from('courses').delete().eq('tenant_id', tenantA).eq('name', 'Schema check');
  });

  await test('1.2  talks has demographic columns', async () => {
    const { error } = await supa.from('talks')
      .select('for_single_men, for_single_women, for_married_men, for_married_women')
      .limit(0);
    assert(!error, `talks missing demographic columns: ${error?.message}`);
  });

  await test('1.3  talks demographic CHECK rejects all-false', async () => {
    // Need a course + module first
    const { data: c } = await supa.from('courses')
      .insert({ tenant_id: tenantA, name: 'C-check', sequence_order: 1 })
      .select('id').single();
    const { data: m } = await supa.from('modules')
      .insert({ tenant_id: tenantA, course_id: c!.id, name: 'M-check', sequence_order: 1 })
      .select('id').single();

    const { error } = await supa.from('talks').insert({
      tenant_id: tenantA,
      module_id: m!.id,
      name: 'Bad talk',
      sequence_order: 1,
      for_single_men: false,
      for_single_women: false,
      for_married_men: false,
      for_married_women: false,
    });
    assert(!!error, 'Expected CHECK constraint violation but insert succeeded');
    assert(
      error.message.includes('talks_at_least_one_demographic') || error.code === '23514',
      `Expected 23514 (check_violation), got: ${error.message}`
    );

    // cleanup
    await supa.from('modules').delete().eq('id', m!.id);
    await supa.from('courses').delete().eq('id', c!.id);
  });

  await test('1.4  reorder_courses() RPC exists', async () => {
    const { error } = await supa.rpc('reorder_courses', {
      p_tenant_id: tenantA,
      p_ids: [],
    });
    // Empty array may return an error from the function itself, but the RPC must exist (not 404)
    const notFound = error?.message?.includes('Could not find') || error?.message?.includes('does not exist');
    assert(!notFound, `RPC reorder_courses not found: ${error?.message}`);
  });

  await test('1.5  reorder_modules() RPC exists', async () => {
    const { error } = await supa.rpc('reorder_modules', {
      p_course_id: '00000000-0000-0000-0000-000000000000',
      p_tenant_id: tenantA,
      p_ids: [],
    });
    const notFound = error?.message?.includes('Could not find') || error?.message?.includes('does not exist');
    assert(!notFound, `RPC reorder_modules not found: ${error?.message}`);
  });

  await test('1.6  reorder_talks() RPC exists', async () => {
    const { error } = await supa.rpc('reorder_talks', {
      p_module_id: '00000000-0000-0000-0000-000000000000',
      p_tenant_id: tenantA,
      p_ids: [],
    });
    const notFound = error?.message?.includes('Could not find') || error?.message?.includes('does not exist');
    assert(!notFound, `RPC reorder_talks not found: ${error?.message}`);
  });

  // ── GROUP 2 — Course service ──────────────────────────────────────────────
  console.log('\nGROUP 2 — Course service');

  let courseA1Id = '';
  let courseA2Id = '';
  let courseA3Id = '';

  await test('2.1  createCourse() inserts with alias + description', async () => {
    const c = await createCourse(tenantA, {
      name: 'Course Alpha', alias: 'alpha', description: 'Alpha desc', sequenceOrder: 1,
    });
    courseA1Id = c.id;
    assert(c.alias === 'alpha', `alias mismatch: ${c.alias}`);
    assert(c.description === 'Alpha desc', `description mismatch: ${c.description}`);
    assert(c.sequence_order === 1, `sequence_order mismatch: ${c.sequence_order}`);
  });

  await test('2.2  updateCourse() updates alias + description', async () => {
    const updated = await updateCourse(courseA1Id, tenantA, {
      alias: 'alpha-v2', description: 'Updated desc',
    });
    assert(updated.alias === 'alpha-v2', `alias not updated: ${updated.alias}`);
    assert(updated.description === 'Updated desc', `description not updated: ${updated.description}`);
  });

  await test('2.3  reorderCourses() two-phase reorder', async () => {
    const c2 = await createCourse(tenantA, { name: 'Course Beta', sequenceOrder: 2 });
    const c3 = await createCourse(tenantA, { name: 'Course Gamma', sequenceOrder: 3 });
    courseA2Id = c2.id;
    courseA3Id = c3.id;

    // Reverse order: Gamma=1, Beta=2, Alpha=3
    await reorderCourses(tenantA, [courseA3Id, courseA2Id, courseA1Id]);

    const { data: rows } = await supa
      .from('courses')
      .select('id, sequence_order')
      .in('id', [courseA1Id, courseA2Id, courseA3Id])
      .order('sequence_order');

    assert(rows![0].id === courseA3Id, `Expected Gamma first, got: ${rows![0].id}`);
    assert(rows![1].id === courseA2Id, `Expected Beta second, got: ${rows![1].id}`);
    assert(rows![2].id === courseA1Id, `Expected Alpha third, got: ${rows![2].id}`);
    assert(rows![0].sequence_order === 1, `sequence_order should be 1, got: ${rows![0].sequence_order}`);
  });

  let moduleA1Id = '';
  let moduleA2Id = '';

  await test('2.4  Course deletion guard: blocked with active modules', async () => {
    const mod = await createModule(tenantA, { courseId: courseA1Id, name: 'Mod X', sequenceOrder: 1 });
    moduleA1Id = mod.id;
    try {
      await updateCourse(courseA1Id, tenantA, { deletedAt: new Date().toISOString() });
      assert(false, 'Expected INVALID_STATE_TRANSITION error but succeeded');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      assert(code === 'INVALID_STATE_TRANSITION', `Expected INVALID_STATE_TRANSITION, got: ${code}`);
    }
  });

  await test('2.5  Course deletion succeeds after modules soft-deleted', async () => {
    await updateModule(moduleA1Id, tenantA, { deletedAt: new Date().toISOString() });
    const deleted = await updateCourse(courseA1Id, tenantA, { deletedAt: new Date().toISOString() });
    assert(deleted.deleted_at !== null, 'deleted_at should be set');
  });

  // ── GROUP 3 — Module service ──────────────────────────────────────────────
  console.log('\nGROUP 3 — Module service');

  // Use courseA2Id (not deleted) for module tests
  await test('3.1  createModule() inserts with alias + description', async () => {
    const m = await createModule(tenantA, {
      courseId: courseA2Id, name: 'Module One',
      alias: 'mod-1', description: 'Mod desc', sequenceOrder: 1,
    });
    moduleA1Id = m.id;
    assert(m.alias === 'mod-1', `alias mismatch: ${m.alias}`);
    assert(m.description === 'Mod desc', `description mismatch: ${m.description}`);
  });

  await test('3.2  reorderModules() reorders correctly', async () => {
    const m2 = await createModule(tenantA, {
      courseId: courseA2Id, name: 'Module Two', sequenceOrder: 2,
    });
    moduleA2Id = m2.id;

    await reorderModules(courseA2Id, tenantA, [moduleA2Id, moduleA1Id]);

    const { data: rows } = await supa
      .from('modules')
      .select('id, sequence_order')
      .in('id', [moduleA1Id, moduleA2Id])
      .order('sequence_order');

    assert(rows![0].id === moduleA2Id, `Expected Module Two first, got: ${rows![0].id}`);
    assert(rows![0].sequence_order === 1, `sequence_order should be 1, got: ${rows![0].sequence_order}`);
  });

  let talkA1Id = '';
  let talkA2Id = '';

  await test('3.3  Module deletion guard: blocked with active talks', async () => {
    const talk = await createTalk(tenantA, {
      moduleId: moduleA1Id, name: 'Talk X', sequenceOrder: 1,
      forSingleMen: true, forSingleWomen: false, forMarriedMen: false, forMarriedWomen: false,
    });
    talkA1Id = talk.id;
    try {
      await updateModule(moduleA1Id, tenantA, { deletedAt: new Date().toISOString() });
      assert(false, 'Expected INVALID_STATE_TRANSITION but succeeded');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      assert(code === 'INVALID_STATE_TRANSITION', `Expected INVALID_STATE_TRANSITION, got: ${code}`);
    }
  });

  await test('3.4  Module deletion succeeds after talks soft-deleted', async () => {
    // soft-delete via updateTalk not imported — use supa directly
    await supa.from('talks').update({ deleted_at: new Date().toISOString() }).eq('id', talkA1Id);
    const deleted = await updateModule(moduleA1Id, tenantA, { deletedAt: new Date().toISOString() });
    assert(deleted.deleted_at !== null, 'deleted_at should be set');
  });

  // ── GROUP 4 — Talk service ────────────────────────────────────────────────
  console.log('\nGROUP 4 — Talk service');

  // moduleA2Id still active
  await test('4.1  createTalk() inserts with demographics', async () => {
    const t = await createTalk(tenantA, {
      moduleId: moduleA2Id, name: 'Talk Alpha', alias: 't-alpha', description: 'T desc',
      sequenceOrder: 1,
      forSingleMen: true, forSingleWomen: false, forMarriedMen: true, forMarriedWomen: false,
    });
    talkA1Id = t.id;
    assert(t.alias === 't-alpha', `alias mismatch: ${t.alias}`);
    assert(t.for_single_men === true, 'forSingleMen should be true');
    assert(t.for_married_men === true, 'forMarriedMen should be true');
    assert(t.for_single_women === false, 'forSingleWomen should be false');
  });

  await test('4.2  createTalk() VALIDATION_ERROR when all demographics false', async () => {
    try {
      await createTalk(tenantA, {
        moduleId: moduleA2Id, name: 'Bad Talk', sequenceOrder: 2,
        forSingleMen: false, forSingleWomen: false, forMarriedMen: false, forMarriedWomen: false,
      });
      assert(false, 'Expected VALIDATION_ERROR but succeeded');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      assert(code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got: ${code}`);
    }
  });

  await test('4.3  reorderTalks() reorders correctly', async () => {
    const t2 = await createTalk(tenantA, {
      moduleId: moduleA2Id, name: 'Talk Beta', sequenceOrder: 2,
      forMarriedWomen: true, forSingleMen: false, forSingleWomen: false, forMarriedMen: false,
    });
    talkA2Id = t2.id;

    await reorderTalks(moduleA2Id, tenantA, [talkA2Id, talkA1Id]);

    const { data: rows } = await supa
      .from('talks')
      .select('id, sequence_order')
      .in('id', [talkA1Id, talkA2Id])
      .order('sequence_order');

    assert(rows![0].id === talkA2Id, `Expected Talk Beta first, got: ${rows![0].id}`);
    assert(rows![0].sequence_order === 1, `sequence_order should be 1, got: ${rows![0].sequence_order}`);
  });

  await test('4.4  Cross-tenant reorder: tenant B cannot reorder tenant A courses', async () => {
    try {
      await reorderCourses(tenantB, [courseA2Id]);
      assert(false, 'Expected cross-tenant rejection but succeeded');
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      assert(
        code === 'CROSS_TENANT_ACCESS' || code === 'VALIDATION_ERROR',
        `Expected CROSS_TENANT_ACCESS or VALIDATION_ERROR, got: ${code}`
      );
    }
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
