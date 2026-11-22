/**
 * FP-257: post-event feedback and star ratings are anonymous.
 * Run: npx tsx scripts/test-fp257-anonymous-feedback.ts   (local Supabase, after supabase db reset)
 *
 * The move script (documentation/sql/FP-257-move.sql) needs the old columns, which migration
 * ...089 drops, so it is exercised separately against a database that stops at ...088.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// FP-263: refuse to run unless the database is on this computer.
import { assertLocalDb } from './lib/assert-local-db';
assertLocalDb();

import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { submitSelfReport } from '../src/features/self-reports/self-report.service';
import { listPendingConfirmations } from '../src/features/confirmations/confirmation.service';
import { getDashboardStats } from '../src/features/reports/report.repository';
import { orderAnonymousFeedback } from '../src/features/reports/anonymous-feedback';
import { removeMember } from '../src/features/members/service';

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stamp = Date.now();

let passed = 0, failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? '  -> ' + detail : ''}`); }
}
function must<T>(r: { data: T | null; error: unknown }, what: string): T {
  if (r.error || r.data === null) throw new Error(`${what}: ${JSON.stringify(r.error)}`);
  return r.data;
}
const PSQL = ['exec', '-i', 'supabase_db_flockpulse-web', 'psql', '-U', 'postgres', '-d', 'postgres'];
function psql(sql: string): string {
  return execFileSync('docker', [...PSQL, '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'NO_ERROR'; } catch (e) { return (e as { code?: string }).code ?? 'NO_CODE'; }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const tenants: string[] = [];

async function community(label: string) {
  const T = must(await svc.from('tenants').insert({ name: `FP257-${label}-${stamp}` }).select('id').single(), 'tenant').id as string;
  tenants.push(T);
  const etId = must(await svc.from('event_types').insert({ tenant_id: T, name: 'ET', code: 'F' + (stamp % 1000) }).select('id').single(), 'et').id as string;
  must(await svc.from('tenants').update({ attendance_window_hours: 720 }).eq('id', T).select('id'), 'tenant settings');
  const mk = async (first: string, role = 'MEMBER') => {
    const m = must(await svc.from('members').insert({
      tenant_id: T, user_id: crypto.randomUUID(), email: `${first.toLowerCase()}-${stamp}@example.test`, role,
      first_name: first, last_name: `Last${first}${stamp}`, gender: 'FEMALE', marital_status: 'SINGLE',
    }).select('id').single(), first) as { id: string };
    return { id: m.id, first, last: `Last${first}${stamp}` };
  };
  const members: Record<string, { id: string; first: string; last: string }> = {};
  members.admin = await mk('Adm' + label, 'ADMIN');
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F']) members[n] = await mk(n + label);
  const mkEvent = async (name: string, daysFromNow: number) => {
    const day = 864e5;
    const e = must(await svc.from('events').insert({
      tenant_id: T, event_type_id: etId, name: `${name}-${stamp}`,
      start_datetime: new Date(Date.now() + daysFromNow * day).toISOString(), end_datetime: new Date(Date.now() + daysFromNow * day + 72e5).toISOString(),
      location_name: 'Hall', location_address: '1 Main St', target: {}, status: 'SCHEDULED', owner_member_id: members.admin.id, guests_allowed: true,
    }).select('id').single(), name) as { id: string };
    for (const m of Object.values(members)) must(await svc.from('event_attendees').upsert({ tenant_id: T, event_id: e.id, member_id: m.id }, { onConflict: 'event_id,member_id' }).select('event_id'), 'attendee');
    return e.id;
  };
  return { T, members, mkEvent };
}

const feedbackRows = async (T: string, eventId: string) =>
  (await svc.from('event_feedback').select('star_rating, feedback').eq('tenant_id', T).eq('event_id', eventId)).data ?? [];

async function main() {
  const one = await community('One');
  const two = await community('Two');
  const E1 = await one.mkEvent('Past1', -3);
  const E2 = await one.mkEvent('Past2', -4);
  const E3 = await one.mkEvent('Past3', -5);
  const F1 = await two.mkEvent('PastTwo', -3);
  const m = one.members, m2 = two.members;
  const phrase = `unique-phrase-${stamp}`;
  const phrase2 = `other-community-phrase-${stamp}`;

  console.log('=== Schema');
  const cols = psql(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_schema='public' AND table_name='event_feedback'`);
  check('event_feedback has exactly id, tenant_id, event_id, star_rating, feedback', cols === 'event_id,feedback,id,star_rating,tenant_id', cols);
  check('member_attendance_reports has no feedback or star_rating column',
    psql(`SELECT count(*) FROM information_schema.columns WHERE table_name='member_attendance_reports' AND column_name IN ('feedback','star_rating')`) === '0');
  check('event_feedback: RLS on, no access for anon or authenticated, service_role has it',
    psql(`SELECT relrowsecurity FROM pg_class WHERE relname='event_feedback'`) === 't'
    && psql(`SELECT has_table_privilege('anon','public.event_feedback','SELECT') OR has_table_privilege('authenticated','public.event_feedback','SELECT')`) === 'f'
    && psql(`SELECT has_table_privilege('service_role','public.event_feedback','INSERT')`) === 't');

  console.log('\n=== Write path');
  const r1 = await submitSelfReport(one.T, m.A.id, { eventId: E1, selfReportStatus: 'SELF_REPORTED_YES', feedback: phrase, starRating: 4 });
  check('Yes with feedback and rating returns the echoed values', r1.feedback === phrase && r1.star_rating === 4 && r1.self_report_status === 'SELF_REPORTED_YES');
  check('...and creates exactly one event_feedback row for that event', eq(await feedbackRows(one.T, E1), [{ star_rating: 4, feedback: phrase }]));
  const r2 = await submitSelfReport(one.T, m.B.id, { eventId: E2, selfReportStatus: 'SELF_REPORTED_YES', feedback: '   ' });
  check('Yes with blank feedback and no rating echoes it and creates no feedback row', r2.star_rating === null && (await feedbackRows(one.T, E2)).length === 0);
  const r3 = await submitSelfReport(one.T, m.C.id, { eventId: E2, selfReportStatus: 'SELF_REPORTED_YES', starRating: 5 });
  check('Yes with only a rating stores rating 5 and NULL feedback', r3.feedback === null && eq(await feedbackRows(one.T, E2), [{ star_rating: 5, feedback: null }]));
  const before = Number(psql(`SELECT count(*) FROM event_feedback WHERE tenant_id='${one.T}'`));
  for (const [label, input] of [
    ['rating 0', { starRating: 0 }], ['rating 6', { starRating: 6 }], ['rating 2.5', { starRating: 2.5 }], ['1001 characters', { feedback: 'x'.repeat(1001) }],
  ] as const) {
    check(`${label} -> VALIDATION_ERROR`, (await codeOf(submitSelfReport(one.T, m.D.id, { eventId: E3, selfReportStatus: 'SELF_REPORTED_YES', ...input }))) === 'VALIDATION_ERROR');
  }
  check('No with feedback -> VALIDATION_ERROR', (await codeOf(submitSelfReport(one.T, m.D.id, { eventId: E3, selfReportStatus: 'SELF_REPORTED_NO', reason: 'sick', feedback: 'x' }))) === 'VALIDATION_ERROR');
  check('...none of the refused submissions left a feedback row or a self-report',
    Number(psql(`SELECT count(*) FROM event_feedback WHERE tenant_id='${one.T}'`)) === before
    && Number(psql(`SELECT count(*) FROM member_attendance_reports WHERE member_id='${m.D.id}'`)) === 0);
  const rNo = await submitSelfReport(one.T, m.D.id, { eventId: E3, selfReportStatus: 'SELF_REPORTED_NO', reason: 'travelling' });
  check('a No report returns feedback null and star_rating null', rNo.feedback === null && rNo.star_rating === null);
  await submitSelfReport(two.T, m2.A.id, { eventId: F1, selfReportStatus: 'SELF_REPORTED_YES', feedback: phrase2, starRating: 2 });
  const crossErr = await svc.from('event_feedback').insert({ tenant_id: one.T, event_id: F1, star_rating: 3 });
  check('a feedback row for another community\'s event is refused (same-tenant trigger)', !!crossErr.error);

  console.log('\n=== Planted phrase never appears with the author');
  const auditText = (T: string, p: string) => Number(psql(`SELECT count(*) FROM audit_logs WHERE tenant_id='${T}' AND (COALESCE(before_value::text,'') || COALESCE(after_value::text,'')) ILIKE '%${p}%'`));
  check('not in any audit_logs row (whole JSON text searched), after the Yes was submitted', auditText(one.T, phrase) === 0 && Number(psql(`SELECT count(*) FROM audit_logs WHERE (COALESCE(before_value::text,'') || COALESCE(after_value::text,'')) ILIKE '%${phrase}%'`)) === 0);
  check('the audit entries of the self-reports carry no feedback, star_rating or has_feedback key',
    Number(psql(`SELECT count(*) FROM audit_logs WHERE tenant_id='${one.T}' AND entity_type='self_report' AND (COALESCE(after_value::text,'') ~ '(feedback|star_rating)')`)) === 0);
  const pending = await listPendingConfirmations(one.T, m.admin.id, 'ADMIN');
  const pendingText = JSON.stringify(pending);
  check('listPendingConfirmations returns the Yes reports (so the check below is meaningful)', pending.length >= 3 && pending.some((p) => p.member_id === m.A.id));
  check('...with no feedback or star_rating key at all, and not the phrase', !/feedback|star_rating/.test(pendingText) && !pendingText.includes(phrase));
  const stats = await getDashboardStats(one.T, m.admin.id, 'ADMIN', E1);
  const entry = stats.rating?.feedback.find((f) => f.feedback === phrase);
  check('the Board shows the phrase with its rating', !!entry && entry!.star_rating === 4);
  check('...and that entry carries only star_rating and feedback', eq(Object.keys(entry ?? {}).sort(), ['feedback', 'star_rating']));
  check('Board numbers for E1: average 4, rounded 4, count 1, breakdown', stats.rating?.average === 4 && stats.rating?.rounded === 4 && stats.rating?.rating_count === 1
    && eq(stats.rating?.breakdown, [{ star: 5, count: 0 }, { star: 4, count: 1 }, { star: 3, count: 0 }, { star: 2, count: 0 }, { star: 1, count: 0 }]));
  const stats2 = await getDashboardStats(one.T, m.admin.id, 'ADMIN', E2);
  check('Board for E2: only the rating (no feedback list entry), count 1', stats2.rating?.rating_count === 1 && stats2.rating?.feedback.length === 0 && stats2.rating?.rounded === 5);
  // a Leader (admin here) confirms: the audit entry must still not carry the phrase
  const ra = await svc.rpc('resolve_leader_confirmation', { p_tenant_id: one.T, p_self_report_id: r1.id, p_leader_member_id: m.admin.id, p_decision: 'CONFIRM', p_leader_note: null });
  check('a Leader confirm works', !ra.error, JSON.stringify(ra.error));
  check('...and the confirm\'s audit entry still holds no feedback or rating', auditText(one.T, phrase) === 0
    && Number(psql(`SELECT count(*) FROM audit_logs WHERE tenant_id='${one.T}' AND entity_type='self_report' AND entity_id='${r1.id}' AND (COALESCE(before_value::text,'') || COALESCE(after_value::text,'')) ~ '(feedback|star_rating)'`)) === 0);

  console.log('\n=== Order never reflects submission order');
  const rows = [
    { star_rating: 3, feedback: 'a' }, { star_rating: null, feedback: 'b' }, { star_rating: 5, feedback: 'c' },
    { star_rating: 3, feedback: 'd' }, { star_rating: 1, feedback: 'e' }, { star_rating: null, feedback: 'f' }, { star_rating: 5, feedback: 'g' },
  ];
  const ordered = orderAnonymousFeedback(rows, () => 0.5);
  const stars = ordered.map((r) => r.star_rating);
  check('fixed random: rating high to low, unrated last', eq(stars, [5, 5, 3, 3, 1, null, null]), JSON.stringify(stars));
  check('input array is not modified', rows[0].feedback === 'a' && rows.length === 7);
  let seed = 1;
  const lcg = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const outputs = new Set<string>();
  for (let i = 0; i < 40; i++) outputs.add(orderAnonymousFeedback(rows, lcg).map((r) => r.feedback).join(''));
  check('different random sources reorder equal ratings (more than one distinct order)', outputs.size > 1, `${outputs.size} distinct orders`);
  check('...yet every order is rating-descending', [...outputs].every((o) => {
    const s = o.split('').map((k) => rows.find((r) => r.feedback === k)!.star_rating);
    const rank = (v: number | null) => (v === null ? 0 : v);   // unrated sorts below every rating
    return s.every((v, i) => i === 0 || rank(s[i - 1]) >= rank(v));
  }));
  check('empty input and no ratings work', eq(orderAnonymousFeedback([], () => 0.1), []) && orderAnonymousFeedback([{ star_rating: null, feedback: 'x' }]).length === 1);

  console.log('\n=== Removal');
  const twoBefore = await feedbackRows(two.T, F1);
  await removeMember(m.A.id, one.T, 'DEACTIVATED');
  check('remove_member succeeded for a member who left feedback', !!(await svc.from('members').select('deleted_at').eq('id', m.A.id).single()).data?.deleted_at);
  check('the anonymous feedback is still there, not linked to anyone', eq(await feedbackRows(one.T, E1), [{ star_rating: 4, feedback: phrase }]));
  const statsAfter = await getDashboardStats(one.T, m.admin.id, 'ADMIN', E1);
  check('the Board still shows it after the removal', statsAfter.rating?.feedback.some((f) => f.feedback === phrase) === true);
  check('the phrase is still nowhere in audit_logs', auditText(one.T, phrase) === 0);

  console.log('\n=== Other community untouched');
  check('community Two\'s feedback is unchanged', eq(await feedbackRows(two.T, F1), twoBefore) && twoBefore.length === 1);
  const stats3 = await getDashboardStats(two.T, m2.admin.id, 'ADMIN', F1);
  check('community Two\'s Board shows only its own phrase', stats3.rating?.feedback.length === 1 && stats3.rating.feedback[0].feedback === phrase2);
  check('community One\'s Board has none of Two\'s feedback', !JSON.stringify(stats).includes(phrase2) && !JSON.stringify(statsAfter).includes(phrase2));
}

main()
  .catch((e) => { console.error('TEST SCRIPT ERROR', e); failed++; })
  .finally(async () => {
    for (const t of tenants) {
      const { error } = await svc.from('tenants').delete().eq('id', t);
      if (error) console.error('cleanup (tenant):', error.message);
    }
    console.log(`\n${passed}/${passed + failed} checks passed${failed ? `  (${failed} FAILED)` : ''}`);
    process.exit(failed === 0 ? 0 : 1);
  });
