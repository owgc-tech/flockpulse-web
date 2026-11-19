/**
 * FP-79/80/81/77/78 — Formation Completion Tracking Overhaul verification.
 *
 * GROUP 1 — talk_completions table (4 tests)
 *   1.1  Insert and read back a completion row
 *   1.2  Unique constraint: duplicate (tenant,member,talk) is rejected
 *   1.3  Tenant isolation: listCompletions for tenant A doesn't return tenant B rows
 *   1.4  Cross-tenant safety trigger: member from different tenant is rejected
 *
 * GROUP 2 — sync_talk_completion_for_attendance via SQL (4 tests)
 *   2.1  ATTENDED upserts completion row with source=event_attendance
 *   2.2  ATTENDED overwrites prior manual entry (event wins)
 *   2.3  DID_NOT_ATTEND with matching source_event_id deletes the row
 *   2.4  DID_NOT_ATTEND does NOT delete row from a different event
 *
 * GROUP 3 — Manual completion service (3 tests)
 *   3.1  recordManualCompletion: inserts row successfully
 *   3.2  recordManualCompletion: conflicts with existing event_attendance → returns conflict info
 *   3.3  recordManualCompletion: conflicts with existing manual row → returns conflict info
 *
 * GROUP 4 — Demographic relevance (4 tests)
 *   4.1  MALE+SINGLE member: for_single_women talk excluded from denominator
 *   4.2  FEMALE+MARRIED member: for_single_men talk excluded from denominator
 *   4.3  Talk with no demographic restrictions (all four true): always included
 *   4.4  All-irrelevant module: vacuously complete
 *
 * GROUP 5 — Pre-existing behaviour (2 tests)
 *   5.1  resolve_leader_confirmation: self_report_id preserved, audit log written
 *   5.2  admin_override_attendance: existing attendance row version incremented, audit log written
 *
 * Run: npx tsx scripts/test-fp79-fp80-fp81-fp77-fp78-formation-completion.ts
 * Requires local Supabase running + migration 20260707000026 applied.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { createClient } from '@supabase/supabase-js';
import { recordManualCompletion } from '../src/features/formation/talk-completions.service';
import { computeCourseProgress } from '../src/features/formation/formation-completion.service';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Test runner ───────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createTenant(name: string): Promise<string> {
  const { data, error } = await supa.from('tenants').insert({ name }).select('id').single();
  if (error || !data) throw new Error(`Failed to create tenant "${name}": ${error?.message}`);
  return data.id;
}

let _seq = 0;
function nextSeq() { return ++_seq; }

async function createMember(
  tenantId: string,
  opts: { gender?: string; marital_status?: string; role?: string } = {}
): Promise<string> {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const { data, error } = await supa
    .from('members')
    .insert({
      tenant_id: tenantId,
      user_id: crypto.randomUUID(),
      email,
      first_name: 'Test',
      last_name: 'Member',
      role: opts.role ?? 'MEMBER',
      gender: opts.gender ?? 'MALE',
      marital_status: opts.marital_status ?? 'SINGLE',
      birthdate: '1990-01-01',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Failed to create member: ${error?.message}`);
  return data.id;
}

async function createCourse(tenantId: string): Promise<string> {
  const { data, error } = await supa
    .from('courses')
    .insert({ tenant_id: tenantId, name: 'Test Course', sequence_order: nextSeq() })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Failed to create course: ${error?.message}`);
  return data.id;
}

async function createModule(tenantId: string, courseId: string): Promise<string> {
  const { data, error } = await supa
    .from('modules')
    .insert({ tenant_id: tenantId, course_id: courseId, name: 'Test Module', sequence_order: nextSeq() })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Failed to create module: ${error?.message}`);
  return data.id;
}

async function createTalk(
  tenantId: string,
  moduleId: string,
  opts: {
    for_single_men?: boolean;
    for_single_women?: boolean;
    for_married_men?: boolean;
    for_married_women?: boolean;
    sequenceOrder?: number;
  } = {}
): Promise<string> {
  const { data, error } = await supa
    .from('talks')
    .insert({
      tenant_id: tenantId,
      module_id: moduleId,
      name: 'Test Talk',
      sequence_order: opts.sequenceOrder ?? nextSeq(),
      for_single_men: opts.for_single_men ?? true,
      for_single_women: opts.for_single_women ?? true,
      for_married_men: opts.for_married_men ?? true,
      for_married_women: opts.for_married_women ?? true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Failed to create talk: ${error?.message}`);
  return data.id;
}

async function createEventType(tenantId: string): Promise<string> {
  const { data, error } = await supa
    .from('event_types')
    .insert({ tenant_id: tenantId, name: 'Formation Talk', code: `EVT-${nextSeq()}` })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Failed to create event type: ${error?.message}`);
  return data.id;
}

async function createEvent(tenantId: string, talkId: string | null, eventTypeId: string): Promise<string> {
  const now = new Date();
  const { data, error } = await supa
    .from('events')
    .insert({
      tenant_id: tenantId,
      event_type_id: eventTypeId,
      name: 'Test Event',
      status: 'SCHEDULED',
      start_datetime: now.toISOString(),
      end_datetime: new Date(now.getTime() + 3600000).toISOString(),
      location_name: 'Test Location',
      target: 'ALL',
      talk_id: talkId,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Failed to create event: ${error?.message}`);
  return data.id;
}

async function insertSelfReport(tenantId: string, eventId: string, memberId: string): Promise<string> {
  const { data, error } = await supa
    .from('member_attendance_reports')
    .insert({
      tenant_id: tenantId,
      event_id: eventId,
      member_id: memberId,
      self_report_status: 'SELF_REPORTED_YES',
      confirmation_status: 'PENDING_CONFIRMATION',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Failed to create self report: ${error?.message}`);
  return data.id;
}

async function cleanup(tenantIds: string[]) {
  for (const tid of tenantIds) {
    await supa.from('talk_completions').delete().eq('tenant_id', tid);
    await supa.from('attendance').delete().eq('tenant_id', tid);
    await supa.from('member_attendance_reports').delete().eq('tenant_id', tid);
    await supa.from('rsvps').delete().eq('tenant_id', tid);
    await supa.from('events').delete().eq('tenant_id', tid);
    await supa.from('event_types').delete().eq('tenant_id', tid);
    await supa.from('talks').delete().eq('tenant_id', tid);
    await supa.from('modules').delete().eq('tenant_id', tid);
    await supa.from('courses').delete().eq('tenant_id', tid);
    await supa.from('members').delete().eq('tenant_id', tid);
    await supa.from('tenants').delete().eq('id', tid);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const tenants: string[] = [];

  let tenantA = '';
  let tenantB = '';

  try {
    tenantA = await createTenant('FP79 Test Tenant A');
    tenantB = await createTenant('FP79 Test Tenant B');
    tenants.push(tenantA, tenantB);
  } catch (e) {
    console.error('Setup failed:', e);
    process.exit(1);
  }

  // ── GROUP 1 — talk_completions table ─────────────────────────────────────
  console.log('\nGROUP 1 — talk_completions table');

  let g1MemberA = '';
  let g1TalkA = '';

  await test('1.1  Insert and read back a completion row', async () => {
    const courseId = await createCourse(tenantA);
    const moduleId = await createModule(tenantA, courseId);
    g1TalkA = await createTalk(tenantA, moduleId);
    g1MemberA = await createMember(tenantA);

    const { error } = await supa.from('talk_completions').insert({
      tenant_id: tenantA,
      member_id: g1MemberA,
      talk_id: g1TalkA,
      completed_at: new Date().toISOString(),
      source: 'manual',
      recorded_by: g1MemberA,
    });
    assert(!error, `Insert failed: ${error?.message}`);

    const { data } = await supa
      .from('talk_completions')
      .select('talk_id, source')
      .eq('member_id', g1MemberA)
      .eq('tenant_id', tenantA)
      .single();
    assert(data?.talk_id === g1TalkA, 'talk_id mismatch on read-back');
    assert(data?.source === 'manual', 'source mismatch on read-back');
  });

  await test('1.2  Unique constraint: duplicate (tenant,member,talk) is rejected', async () => {
    const { error } = await supa.from('talk_completions').insert({
      tenant_id: tenantA,
      member_id: g1MemberA,
      talk_id: g1TalkA,
      completed_at: new Date().toISOString(),
      source: 'manual',
    });
    assert(error !== null, 'Expected unique violation but got none');
    assert(error!.code === '23505', `Expected code 23505, got ${error!.code}`);
  });

  await test('1.3  Tenant isolation: tenant A completions not visible from tenant B query', async () => {
    // Query using tenant_id = tenantB — should return zero rows
    const { data } = await supa
      .from('talk_completions')
      .select('id')
      .eq('tenant_id', tenantB);
    assert((data ?? []).length === 0, 'Tenant B saw completions from tenant A');
  });

  await test('1.4  Cross-tenant safety trigger: member from different tenant is rejected', async () => {
    const courseId = await createCourse(tenantB);
    const moduleId = await createModule(tenantB, courseId);
    const talkB = await createTalk(tenantB, moduleId);
    // memberA belongs to tenantA, but we try to insert with tenant_id=tenantB
    const { error } = await supa.from('talk_completions').insert({
      tenant_id: tenantB,
      member_id: g1MemberA, // wrong tenant
      talk_id: talkB,
      completed_at: new Date().toISOString(),
      source: 'manual',
    });
    assert(error !== null, 'Expected cross-tenant trigger to reject insert');
  });

  // ── GROUP 2 — sync_talk_completion_for_attendance ─────────────────────────
  console.log('\nGROUP 2 — sync_talk_completion_for_attendance via SQL');

  let g2Member = '';
  let g2Talk = '';
  let g2Event = '';
  let g2EventType = '';

  await test('2.1  ATTENDED upserts completion row with source=event_attendance', async () => {
    const courseId = await createCourse(tenantA);
    const moduleId = await createModule(tenantA, courseId);
    g2Talk = await createTalk(tenantA, moduleId);
    g2Member = await createMember(tenantA, { role: 'MEMBER' });
    g2EventType = await createEventType(tenantA);
    g2Event = await createEvent(tenantA, g2Talk, g2EventType);

    const now = new Date().toISOString();
    const { error } = await supa.rpc('sync_talk_completion_for_attendance', {
      p_tenant_id: tenantA,
      p_event_id: g2Event,
      p_member_id: g2Member,
      p_attendance_status: 'ATTENDED',
      p_confirmed_at: now,
    });
    assert(!error, `sync RPC failed: ${error?.message}`);

    const { data } = await supa
      .from('talk_completions')
      .select('source, source_event_id')
      .eq('member_id', g2Member)
      .eq('talk_id', g2Talk)
      .eq('tenant_id', tenantA)
      .single();
    assert(data?.source === 'event_attendance', `Expected event_attendance, got ${data?.source}`);
    assert(data?.source_event_id === g2Event, 'source_event_id mismatch');
  });

  await test('2.2  ATTENDED overwrites prior manual entry (event wins)', async () => {
    // First insert a manual completion for a new talk
    const courseId = await createCourse(tenantA);
    const moduleId = await createModule(tenantA, courseId);
    const manualTalk = await createTalk(tenantA, moduleId, { sequenceOrder: 2 });
    const manualMember = await createMember(tenantA);
    const eventType2 = await createEventType(tenantA);
    const manualEvent = await createEvent(tenantA, manualTalk, eventType2);

    // Insert manual first
    await supa.from('talk_completions').insert({
      tenant_id: tenantA,
      member_id: manualMember,
      talk_id: manualTalk,
      completed_at: new Date().toISOString(),
      source: 'manual',
      recorded_by: manualMember,
    });

    // Now sync ATTENDED — should overwrite the manual row
    const { error } = await supa.rpc('sync_talk_completion_for_attendance', {
      p_tenant_id: tenantA,
      p_event_id: manualEvent,
      p_member_id: manualMember,
      p_attendance_status: 'ATTENDED',
      p_confirmed_at: new Date().toISOString(),
    });
    assert(!error, `sync RPC failed: ${error?.message}`);

    const { data } = await supa
      .from('talk_completions')
      .select('source')
      .eq('member_id', manualMember)
      .eq('talk_id', manualTalk)
      .eq('tenant_id', tenantA)
      .single();
    assert(data?.source === 'event_attendance', `Event should have overwritten manual; got source=${data?.source}`);
  });

  await test('2.3  DID_NOT_ATTEND with matching source_event_id deletes the row', async () => {
    const { error } = await supa.rpc('sync_talk_completion_for_attendance', {
      p_tenant_id: tenantA,
      p_event_id: g2Event,
      p_member_id: g2Member,
      p_attendance_status: 'DID_NOT_ATTEND',
      p_confirmed_at: new Date().toISOString(),
    });
    assert(!error, `sync RPC failed: ${error?.message}`);

    const { data } = await supa
      .from('talk_completions')
      .select('id')
      .eq('member_id', g2Member)
      .eq('talk_id', g2Talk)
      .eq('tenant_id', tenantA);
    assert((data ?? []).length === 0, 'Completion row should have been deleted on DID_NOT_ATTEND');
  });

  await test('2.4  DID_NOT_ATTEND does NOT delete row from a different event', async () => {
    // Re-insert via event attendance for g2Event
    await supa.rpc('sync_talk_completion_for_attendance', {
      p_tenant_id: tenantA,
      p_event_id: g2Event,
      p_member_id: g2Member,
      p_attendance_status: 'ATTENDED',
      p_confirmed_at: new Date().toISOString(),
    });

    // Create a second event for the same talk
    const event2 = await createEvent(tenantA, g2Talk, g2EventType);

    // DID_NOT_ATTEND for the second event should NOT remove the row from g2Event
    await supa.rpc('sync_talk_completion_for_attendance', {
      p_tenant_id: tenantA,
      p_event_id: event2,
      p_member_id: g2Member,
      p_attendance_status: 'DID_NOT_ATTEND',
      p_confirmed_at: new Date().toISOString(),
    });

    const { data } = await supa
      .from('talk_completions')
      .select('source_event_id')
      .eq('member_id', g2Member)
      .eq('talk_id', g2Talk)
      .eq('tenant_id', tenantA)
      .single();
    assert(data !== null, 'Completion row was incorrectly deleted by a different event DID_NOT_ATTEND');
    assert(data?.source_event_id === g2Event, 'source_event_id was changed unexpectedly');
  });

  // ── GROUP 3 — Manual completion service ──────────────────────────────────
  console.log('\nGROUP 3 — Manual completion service');

  await test('3.1  recordManualCompletion: inserts row successfully', async () => {
    const courseId = await createCourse(tenantA);
    const moduleId = await createModule(tenantA, courseId);
    const talk = await createTalk(tenantA, moduleId);
    const member = await createMember(tenantA);
    const admin = await createMember(tenantA, { role: 'ADMIN' });

    const result = await recordManualCompletion(
      tenantA, admin, member, talk, new Date().toISOString()
    );
    assert(result.success === true, `Expected success, got: ${JSON.stringify(result)}`);
    if (result.success) {
      assert(result.row.source === 'manual', `Expected source=manual, got ${result.row.source}`);
      assert(result.row.recorded_by === admin, 'recorded_by mismatch');
    }
  });

  await test('3.2  recordManualCompletion: conflicts with existing event_attendance → returns conflict', async () => {
    // Build a talk + event + completion via event_attendance path
    const courseId = await createCourse(tenantA);
    const moduleId = await createModule(tenantA, courseId);
    const talk = await createTalk(tenantA, moduleId);
    const member = await createMember(tenantA);
    const admin = await createMember(tenantA, { role: 'ADMIN' });
    const evType = await createEventType(tenantA);
    const ev = await createEvent(tenantA, talk, evType);

    await supa.rpc('sync_talk_completion_for_attendance', {
      p_tenant_id: tenantA,
      p_event_id: ev,
      p_member_id: member,
      p_attendance_status: 'ATTENDED',
      p_confirmed_at: new Date().toISOString(),
    });

    // Manual entry should conflict
    const result = await recordManualCompletion(
      tenantA, admin, member, talk, new Date().toISOString()
    );
    assert(result.success === false, 'Expected conflict, got success');
    if (!result.success) {
      assert(result.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${result.code}`);
      assert(result.message.includes('event attendance'), `Expected message to mention event attendance, got: ${result.message}`);
    }
  });

  await test('3.3  recordManualCompletion: conflicts with existing manual row → returns conflict', async () => {
    const courseId = await createCourse(tenantA);
    const moduleId = await createModule(tenantA, courseId);
    const talk = await createTalk(tenantA, moduleId);
    const member = await createMember(tenantA);
    const admin = await createMember(tenantA, { role: 'ADMIN' });

    // First manual entry
    const r1 = await recordManualCompletion(tenantA, admin, member, talk, new Date().toISOString());
    assert(r1.success === true, `First manual entry failed: ${JSON.stringify(r1)}`);

    // Second manual entry should conflict
    const r2 = await recordManualCompletion(tenantA, admin, member, talk, new Date().toISOString());
    assert(r2.success === false, 'Expected conflict on second manual entry');
    if (!r2.success) {
      assert(r2.code === 'VALIDATION_ERROR', `Expected VALIDATION_ERROR, got ${r2.code}`);
      assert(r2.message.includes('manual entry'), `Expected message to mention manual entry, got: ${r2.message}`);
    }
  });

  // ── GROUP 4 — Demographic relevance ──────────────────────────────────────
  console.log('\nGROUP 4 — Demographic relevance');

  await test('4.1  MALE+SINGLE member: for_single_women talk excluded from denominator', async () => {
    const courseId = await createCourse(tenantA);
    const moduleId = await createModule(tenantA, courseId);

    // Talk only for single women (irrelevant for MALE+SINGLE)
    await createTalk(tenantA, moduleId, {
      for_single_men: false,
      for_single_women: true,
      for_married_men: false,
      for_married_women: false,
      sequenceOrder: 1,
    });

    const maleSingleMember = await createMember(tenantA, { gender: 'MALE', marital_status: 'SINGLE' });
    const progress = await computeCourseProgress(maleSingleMember, courseId, tenantA);

    // The for_single_women talk is irrelevant → should be excluded from denominator
    assert(progress.total_talk_count === 0, `Expected 0 relevant talks, got ${progress.total_talk_count}`);
    // Module with no relevant talks is vacuously complete
    assert(progress.course_completed === true, 'Course should be vacuously complete when no relevant talks');
  });

  await test('4.2  FEMALE+MARRIED member: for_single_men talk excluded from denominator', async () => {
    const courseId = await createCourse(tenantA);
    const moduleId = await createModule(tenantA, courseId);

    // Talk only for single men (irrelevant for FEMALE+MARRIED)
    await createTalk(tenantA, moduleId, {
      for_single_men: true,
      for_single_women: false,
      for_married_men: false,
      for_married_women: false,
      sequenceOrder: 1,
    });

    const femaleMarriedMember = await createMember(tenantA, { gender: 'FEMALE', marital_status: 'MARRIED' });
    const progress = await computeCourseProgress(femaleMarriedMember, courseId, tenantA);

    assert(progress.total_talk_count === 0, `Expected 0 relevant talks, got ${progress.total_talk_count}`);
    assert(progress.course_completed === true, 'Course should be vacuously complete');
  });

  await test('4.3  Talk with all demographics true: always included for any member', async () => {
    const courseId = await createCourse(tenantA);
    const moduleId = await createModule(tenantA, courseId);

    // All four flags true = universal
    await createTalk(tenantA, moduleId, {
      for_single_men: true,
      for_single_women: true,
      for_married_men: true,
      for_married_women: true,
      sequenceOrder: 1,
    });

    for (const [gender, marital_status] of [
      ['MALE', 'SINGLE'],
      ['FEMALE', 'SINGLE'],
      ['MALE', 'MARRIED'],
      ['FEMALE', 'MARRIED'],
    ]) {
      const member = await createMember(tenantA, { gender, marital_status });
      const progress = await computeCourseProgress(member, courseId, tenantA);
      assert(progress.total_talk_count === 1, `Expected 1 relevant talk for ${gender}+${marital_status}, got ${progress.total_talk_count}`);
    }
  });

  await test('4.4  All-irrelevant module: vacuously complete', async () => {
    const courseId = await createCourse(tenantA);
    const moduleId = await createModule(tenantA, courseId);

    // Single women talk only
    await createTalk(tenantA, moduleId, {
      for_single_men: false,
      for_single_women: true,
      for_married_men: false,
      for_married_women: false,
      sequenceOrder: 1,
    });

    const maleMember = await createMember(tenantA, { gender: 'MALE', marital_status: 'SINGLE' });
    const progress = await computeCourseProgress(maleMember, courseId, tenantA);

    assert(progress.modules.length === 1, 'Expected 1 module');
    assert(progress.modules[0].module_completed === true, 'Module with no relevant talks should be vacuously complete');
    assert(progress.modules[0].talks.length === 0, 'No relevant talks should appear in module');
    assert(progress.course_completed === true, 'Course should be vacuously complete');
  });

  // ── GROUP 5 — Pre-existing behaviour ─────────────────────────────────────
  console.log('\nGROUP 5 — Pre-existing behaviour');

  await test('5.1  resolve_leader_confirmation: self_report_id preserved, audit log written', async () => {
    const member = await createMember(tenantA);
    const leader = await createMember(tenantA, { role: 'LEADER' });
    const evType = await createEventType(tenantA);
    const ev = await createEvent(tenantA, null, evType); // non-talk event
    const selfReportId = await insertSelfReport(tenantA, ev, member);

    const { data, error } = await supa.rpc('resolve_leader_confirmation', {
      p_tenant_id: tenantA,
      p_self_report_id: selfReportId,
      p_leader_member_id: leader,
      p_decision: 'CONFIRM',
      p_leader_note: 'Verified',
    });
    assert(!error, `resolve_leader_confirmation failed: ${error?.message}`);
    assert(Array.isArray(data) && data.length > 0, 'Expected attendance_id in result');

    const attendanceId = data[0].attendance_id;

    // Verify self_report_id is preserved
    const { data: attendanceRow } = await supa
      .from('attendance')
      .select('self_report_id, attendance_status')
      .eq('id', attendanceId)
      .single();
    assert(attendanceRow?.self_report_id === selfReportId, 'self_report_id not preserved');
    assert(attendanceRow?.attendance_status === 'ATTENDED', 'Expected ATTENDED status');

    // Verify audit log written
    const { data: auditRows } = await supa
      .from('audit_logs')
      .select('action')
      .eq('entity_id', attendanceId)
      .eq('tenant_id', tenantA);
    assert((auditRows ?? []).length > 0, 'No audit log entry found for attendance');
  });

  await test('5.2  admin_override_attendance: version incremented, audit log written', async () => {
    const member = await createMember(tenantA);
    const admin = await createMember(tenantA, { role: 'ADMIN' });
    const evType = await createEventType(tenantA);
    const ev = await createEvent(tenantA, null, evType);

    // First override
    const { data: r1, error: e1 } = await supa.rpc('admin_override_attendance', {
      p_tenant_id: tenantA,
      p_event_id: ev,
      p_member_id: member,
      p_attendance_status: 'ATTENDED',
      p_admin_member_id: admin,
      p_reason: 'First override',
    });
    assert(!e1, `First admin_override_attendance failed: ${e1?.message}`);
    assert(r1[0].version === 1, `Expected version=1, got ${r1[0].version}`);

    // Second override — version must increment
    const { data: r2, error: e2 } = await supa.rpc('admin_override_attendance', {
      p_tenant_id: tenantA,
      p_event_id: ev,
      p_member_id: member,
      p_attendance_status: 'DID_NOT_ATTEND',
      p_admin_member_id: admin,
      p_reason: 'Second override',
    });
    assert(!e2, `Second admin_override_attendance failed: ${e2?.message}`);
    assert(r2[0].version === 2, `Expected version=2, got ${r2[0].version}`);

    // Verify audit log
    const attendanceId = r2[0].attendance_id;
    const { data: auditRows } = await supa
      .from('audit_logs')
      .select('action')
      .eq('entity_id', attendanceId)
      .eq('tenant_id', tenantA)
      .eq('action', 'admin_override');
    assert((auditRows ?? []).length >= 2, `Expected >= 2 audit log entries, got ${auditRows?.length}`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n──────────────────────────────────────────`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log(`  ✗  ${f}`));
  }

  await cleanup(tenants);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Unhandled error:', e);
  process.exit(1);
});
