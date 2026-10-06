/**
 * FP-240 (web) — everyone who can open an event sees the full RSVP roster; decline
 * reasons restricted; removed members hidden: tests
 *
 * The real route handlers (called with real Auth JWTs) and real service code against the
 * LOCAL database (supabase start + db reset).
 *
 * Run:  npx tsx scripts/test-fp240-roster-visibility.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getEventRoster, recordEventViewForCaller } from '../src/features/events/service';
import { removeMember } from '../src/features/members/service';
import type { Role } from '../src/lib/auth/middleware';
import { GET as rosterGET } from '../app/api/events/[id]/roster/route';
import { POST as viewPOST } from '../app/api/events/[id]/view/route';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const stamp = Date.now();
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

let passed = 0, failed = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? '  -> ' + detail : ''}`); }
}
function must<T>(r: { data: T | null; error: unknown }, what: string): T {
  if (r.error || r.data === null) throw new Error(`${what}: ${JSON.stringify(r.error)}`);
  return r.data;
}

interface Row { member_id: string; first_name: string; last_name: string; response: string; rsvp_reason: string | null; guest_count: number | null }

async function main() {
  const T1 = must(await svc.from('tenants').insert({ name: 'FP240-A-' + stamp }).select('id').single(), 't1').id as string;
  const T2 = must(await svc.from('tenants').insert({ name: 'FP240-B-' + stamp }).select('id').single(), 't2').id as string;
  const et1 = must(await svc.from('event_types').insert({ tenant_id: T1, name: 'ET', code: 'A' + (stamp % 1000) }).select('id').single(), 'et1').id as string;
  const et2 = must(await svc.from('event_types').insert({ tenant_id: T2, name: 'ET', code: 'B' + (stamp % 1000) }).select('id').single(), 'et2').id as string;
  const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  async function mk(tenant: string, first: string, role: Role, login = false) {
    const email = `${first.toLowerCase()}-${stamp}@example.test`;
    let userId: string = crypto.randomUUID();
    if (login) {
      const u = await svc.auth.admin.createUser({ email, password: 'Pw-12345-abcde', email_confirm: true, app_metadata: { tenant_id: tenant, role } });
      if (u.error) throw u.error;
      userId = u.data.user!.id;
    }
    const m = must(await svc.from('members').insert({ tenant_id: tenant, user_id: userId, email, role, first_name: first, last_name: 'Roster', gender: 'FEMALE', marital_status: 'SINGLE', birthdate: '1990-04-04' }).select('id').single(), first) as { id: string };
    let token = '';
    if (login) {
      await svc.auth.admin.updateUserById(userId, { app_metadata: { tenant_id: tenant, role, member_id: m.id } });
      const { data: sess, error } = await anon.auth.signInWithPassword({ email, password: 'Pw-12345-abcde' });
      if (error || !sess.session) throw error ?? new Error('no session');
      token = sess.session.access_token;
    }
    return { id: m.id, token };
  }

  // people
  const admin = await mk(T1, 'Admin', 'ADMIN', true);
  const coordinator = await mk(T1, 'Coordinator', 'COORDINATOR', true);            // Admin-tier synonym
  const leaderA = await mk(T1, 'LeaderA', 'LEADER', true);                         // owns the events; leads M3
  const leaderB = await mk(T1, 'LeaderB', 'LEADER', true);                         // invited, leads M2
  const pastoral = await mk(T1, 'Pastoral', 'PASTORAL_LEADER', true);              // Leader-tier synonym; leads M5
  const strangerLeader = await mk(T1, 'StrangerLeader', 'LEADER', true);           // neither owner nor invited
  const m1 = await mk(T1, 'M1Own', 'MEMBER', true);                                // declines with a reason
  const m2 = await mk(T1, 'M2', 'MEMBER');                                         // declines, led by leaderB
  const m3 = await mk(T1, 'M3', 'MEMBER');                                         // declines, led by leaderA
  const m4 = await mk(T1, 'M4Removed', 'MEMBER');                                  // accepts with guests; later removed
  const m5 = await mk(T1, 'M5', 'MEMBER');                                         // declines, led by the pastoral leader
  const m6 = await mk(T1, 'M6', 'MEMBER');                                         // never responds
  const stranger = await mk(T1, 'Stranger', 'MEMBER', true);                       // NOT invited
  const t2admin = await mk(T2, 'T2Admin', 'ADMIN', true);

  const lead = async (member: string, leader: string) =>
    must(await svc.from('assignments').insert({ tenant_id: T1, member_id: member, assignment_type: 'LEADER', leader_member_id: leader }).select('id'), 'leader link');
  await lead(m3.id, leaderA.id); await lead(m2.id, leaderB.id); await lead(m5.id, pastoral.id);

  const invited = [m1, m2, m3, m4, m5, m6, leaderB, pastoral].map((x) => x.id);
  async function mkEvent(days: number, name: string, tenant = T1, type = et1, owner = leaderA.id, attendees = invited) {
    const e = must(await svc.from('events').insert({
      tenant_id: tenant, event_type_id: type, name: `${name}-${stamp}`, start_datetime: new Date(Date.now() + days * 864e5).toISOString(),
      end_datetime: new Date(Date.now() + days * 864e5 + 72e5).toISOString(), location_name: 'Hall', location_address: '1 Main St',
      target: {}, status: 'SCHEDULED', owner_member_id: owner, guests_allowed: true,
    }).select('id').single(), name) as { id: string };
    for (const a of attendees) must(await svc.from('event_attendees').upsert({ tenant_id: tenant, event_id: e.id, member_id: a }, { onConflict: 'event_id,member_id' }).select('event_id'), 'attendee');
    const rsvp = async (member: string, status: string, reason: string | null, guests: number | null) =>
      must(await svc.from('rsvps').insert({ tenant_id: tenant, event_id: e.id, member_id: member, rsvp_status: status, rsvp_reason: reason, guest_count: guests }).select('id'), 'rsvp');
    if (tenant === T1) {
      await rsvp(m1.id, 'NO', 'M1 own reason', null);
      await rsvp(m2.id, 'NO', 'M2 private reason', null);
      await rsvp(m3.id, 'NO', 'M3 private reason', null);
      await rsvp(m4.id, 'YES', null, 2);
      await rsvp(m5.id, 'NO', 'M5 private reason', null);
    }
    return e.id;
  }
  const upcoming = await mkEvent(5, 'Upcoming');
  const past = await mkEvent(-10, 'Past');
  const t2event = await mkEvent(5, 'T2', T2, et2, t2admin.id, []);

  const req = (url: string, token?: string, method = 'GET', body?: string) =>
    new NextRequest(new URL(url, 'http://localhost'), { method, headers: token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {}, body });
  const roster = async (eventId: string, token: string, query = '') => {
    const res = await rosterGET(req(`/api/events/${eventId}/roster${query}`, token), { params: Promise.resolve({ id: eventId }) });
    const body = await res.json();
    return { status: res.status, rows: (body.data ?? null) as Row[] | null, code: body.error?.code as string | undefined };
  };
  const reasons = (rows: Row[] | null) => Object.fromEntries((rows ?? []).filter((r) => r.rsvp_reason !== null).map((r) => [r.first_name, r.rsvp_reason]));
  const names = (rows: Row[] | null) => (rows ?? []).map((r) => r.first_name).sort();
  const fullNames = ['LeaderB', 'M1Own', 'M2', 'M3', 'M4Removed', 'M5', 'M6', 'Pastoral'].sort();

  // ============================================================= Member
  console.log('\n=== An invited Member');
  const asM1 = await roster(upcoming, m1.token);
  check('an invited Member gets 200 (it used to be 403) and the FULL invited roster', asM1.status === 200 && eq(names(asM1.rows), fullNames), JSON.stringify({ s: asM1.status, n: names(asM1.rows) }));
  check("...and sees ONLY their own decline reason (no other person's)", eq(reasons(asM1.rows), { M1Own: 'M1 own reason' }), JSON.stringify(reasons(asM1.rows)));
  check('...every row still carries name, response and guest_count', (asM1.rows ?? []).every((r) => typeof r.first_name === 'string' && r.first_name !== '' && ['ACCEPTED', 'DECLINED', 'TENTATIVE', 'NOT_RESPONDED'].includes(r.response) && 'guest_count' in r));
  check('...guest_count and response are not redacted (M4 accepted with 2 guests; M2 declined)', asM1.rows?.find((r) => r.first_name === 'M4Removed')?.guest_count === 2 && asM1.rows?.find((r) => r.first_name === 'M4Removed')?.response === 'ACCEPTED' && asM1.rows?.find((r) => r.first_name === 'M2')?.response === 'DECLINED');
  const stranged = await roster(upcoming, stranger.token);
  check('a Member who is NOT invited: 403 FORBIDDEN_SCOPE and no roster', stranged.status === 403 && stranged.code === 'FORBIDDEN_SCOPE' && stranged.rows === null, JSON.stringify(stranged));
  const noTok = await rosterGET(req(`/api/events/${upcoming}/roster`), { params: Promise.resolve({ id: upcoming }) });
  check('no token: 401', noTok.status === 401);

  // ============================================================= Leader
  console.log('\n=== Leaders');
  const asA = await roster(upcoming, leaderA.token);
  check("the owning Leader gets the FULL roster, and reasons only of their own assigned decliner (M3)", asA.status === 200 && eq(names(asA.rows), fullNames) && eq(reasons(asA.rows), { M3: 'M3 private reason' }), JSON.stringify({ n: names(asA.rows), r: reasons(asA.rows) }));
  const asB = await roster(upcoming, leaderB.token);
  check('an INVITED Leader (not the owner): full roster; only THEIR assigned decliner (M2)', asB.status === 200 && eq(names(asB.rows), fullNames) && eq(reasons(asB.rows), { M2: 'M2 private reason' }), JSON.stringify(reasons(asB.rows)));
  const asP = await roster(upcoming, pastoral.token);
  check('a PASTORAL_LEADER (Leader-tier synonym) is treated as a Leader: only their own decliner (M5)', asP.status === 200 && eq(reasons(asP.rows), { M5: 'M5 private reason' }), JSON.stringify(reasons(asP.rows)));
  const asStrangerLeader = await roster(upcoming, strangerLeader.token);
  check('a Leader who neither owns nor is invited: 403 FORBIDDEN_SCOPE', asStrangerLeader.status === 403 && asStrangerLeader.code === 'FORBIDDEN_SCOPE');
  check('"leader of that person" means that person only: leaderA never sees M2 or M5 reasons', !('M2' in reasons(asA.rows)) && !('M5' in reasons(asA.rows)));

  // ============================================================= Admin
  console.log('\n=== Admin tier');
  const allReasons = { M1Own: 'M1 own reason', M2: 'M2 private reason', M3: 'M3 private reason', M5: 'M5 private reason' };
  const asAdmin = await roster(upcoming, admin.token);
  check('an Admin gets everything including ALL reasons', asAdmin.status === 200 && eq(names(asAdmin.rows), fullNames) && eq(reasons(asAdmin.rows), allReasons), JSON.stringify(reasons(asAdmin.rows)));
  const asCoord = await roster(upcoming, coordinator.token);
  check('an Admin-tier synonym (COORDINATOR) too', asCoord.status === 200 && eq(reasons(asCoord.rows), allReasons));
  const adminOnPast = await roster(past, admin.token);
  check('an Admin can open a past event', adminOnPast.status === 200 && eq(names(adminOnPast.rows), fullNames));

  // ============================================================= errors / tenants
  console.log('\n=== Errors and tenants');
  const unknown = crypto.randomUUID();
  const missing = await roster(unknown, admin.token);
  check('unknown event: 404 NOT_FOUND', missing.status === 404 && missing.code === 'NOT_FOUND');
  const xt = await roster(t2event, admin.token);
  check("a T1 Admin asking for a T2 event: 404 NOT_FOUND (cross-tenant rejected)", xt.status === 404 && xt.code === 'NOT_FOUND');
  const xt2 = await roster(upcoming, t2admin.token);
  check("a T2 Admin asking for a T1 event: 404 NOT_FOUND", xt2.status === 404 && xt2.code === 'NOT_FOUND');

  // ============================================================= removed members
  console.log('\n=== Removed members');
  const beforeUpcomingDefault = await getEventRoster(upcoming, T1);
  const beforePastDefault = await getEventRoster(past, T1);
  const beforeAdminView = await roster(upcoming, admin.token, '?view=admin');
  await removeMember(m4.id, T1, 'DEACTIVATED');
  for (const [label, ev] of [['an UPCOMING event', upcoming], ['a PAST event', past]] as const) {
    const r = await roster(ev, m1.token);
    check(`a removed member is absent from ${label} (the roster the mobile app reads)`, r.status === 200 && !(r.rows ?? []).some((x) => x.member_id === m4.id) && eq(names(r.rows), fullNames.filter((n) => n !== 'M4Removed')), JSON.stringify(names(r.rows)));
  }
  const rAdmin2 = await roster(upcoming, admin.token);
  check('...also absent for an Admin, and no blank-name rows', !(rAdmin2.rows ?? []).some((x) => x.member_id === m4.id || x.first_name === ''));
  check('the attendee row itself is untouched (history kept)', ((await svc.from('event_attendees').select('member_id', { count: 'exact', head: true }).eq('member_id', m4.id)).count ?? 0) === 2);

  // ============================================================= web admin caller unchanged
  console.log('\n=== The web admin caller is unchanged');
  const afterUpcomingDefault = await getEventRoster(upcoming, T1);
  check('getEventRoster(id, tenant) with no options still returns the removed member (as before the change, anonymized now) and does not redact', afterUpcomingDefault.some((r) => r.member_id === m4.id) && afterUpcomingDefault.find((r) => r.member_id === m2.id)?.rsvp_reason === 'M2 private reason' && afterUpcomingDefault.length === beforeUpcomingDefault.length);
  const removedRow = afterUpcomingDefault.find((r) => r.member_id === m4.id);
  check("...the removed member's row is the anonymous 'Deactivated User' one FP-235 left, with the guest count intact", removedRow?.first_name === 'Deactivated' && removedRow?.last_name === 'User' && removedRow?.guest_count === 2);
  check('...same for a past event', (await getEventRoster(past, T1)).length === beforePastDefault.length && (await getEventRoster(past, T1)).some((r) => r.member_id === m4.id));
  const scoped = await getEventRoster(upcoming, T1, leaderA.id);
  check('the FP-95 leader scoping argument still works (only that leader\'s assigned members)', eq(scoped.map((r) => r.member_id), [m3.id]));
  check('...and a cross-tenant id still throws NOT_FOUND', await getEventRoster(t2event, T1).then(() => false, (e) => (e as { code?: string }).code === 'NOT_FOUND'));
  const adminView = await roster(upcoming, admin.token, '?view=admin');
  check('the web admin page\'s read (?view=admin) as an Admin: full roster INCLUDING the removed member, every reason', adminView.status === 200 && adminView.rows?.some((r) => r.member_id === m4.id) === true && eq(reasons(adminView.rows), allReasons) && adminView.rows?.length === beforeAdminView.rows?.length);
  const leaderView = await roster(upcoming, leaderA.token, '?view=admin');
  check("...as a Leader: scoped to their own assigned members, as before (FP-95)", leaderView.status === 200 && eq((leaderView.rows ?? []).map((r) => r.member_id), [m3.id]));
  const memberView = await roster(upcoming, m1.token, '?view=admin');
  check("...as a Member: 403 FORBIDDEN_ROLE, exactly as before", memberView.status === 403 && memberView.code === 'FORBIDDEN_ROLE');
  const strangerLeaderView = await roster(upcoming, strangerLeader.token, '?view=admin');
  check('...a Leader who is neither owner nor invited still gets their (empty) scoped roster, as before — no new access check on that view', strangerLeaderView.status === 200 && (strangerLeaderView.rows ?? []).length === 0);

  // ============================================================= order / guest_count
  console.log('\n=== Order and guest_count unchanged');
  const newOrder = (await roster(upcoming, admin.token)).rows!.map((r) => r.member_id);
  const oldOrder = (await getEventRoster(upcoming, T1)).filter((r) => r.member_id !== m4.id).map((r) => r.member_id);
  check('the roster order is the same as before (removed member filtered out, nothing reordered)', eq(newOrder, oldOrder));
  const oldRows = await getEventRoster(upcoming, T1);
  const newRows = (await roster(upcoming, admin.token)).rows!;
  check('response and guest_count are identical row for row', newRows.every((r) => { const o = oldRows.find((x) => x.member_id === r.member_id)!; return o.response === r.response && o.guest_count === r.guest_count && o.first_name === r.first_name; }));

  // ============================================================= view endpoint unchanged
  console.log('\n=== The view endpoint still behaves identically');
  const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
  const v1 = await viewPOST(req(`/api/events/${upcoming}/view`, m1.token, 'POST'), ctxFor(upcoming));
  const v1b = await v1.json();
  check('an invited Member: 200 { data: { version } }', v1.status === 200 && typeof v1b?.data?.version === 'number');
  const v2 = await viewPOST(req(`/api/events/${upcoming}/view`, stranger.token, 'POST'), ctxFor(upcoming));
  check('a Member who is not invited: 403 FORBIDDEN_SCOPE', v2.status === 403 && (await v2.json()).error?.code === 'FORBIDDEN_SCOPE');
  const v3 = await viewPOST(req(`/api/events/${upcoming}/view`, strangerLeader.token, 'POST'), ctxFor(upcoming));
  check('a Leader who neither owns nor is invited: 403 FORBIDDEN_SCOPE', v3.status === 403);
  const v4 = await viewPOST(req(`/api/events/${upcoming}/view`, admin.token, 'POST'), ctxFor(upcoming));
  check('an Admin: 200', v4.status === 200);
  const v5 = await viewPOST(req(`/api/events/${unknown}/view`, admin.token, 'POST'), ctxFor(unknown));
  check('unknown event: 404 NOT_FOUND', v5.status === 404 && (await v5.json()).error?.code === 'NOT_FOUND');
  const v6 = await viewPOST(req(`/api/events/${t2event}/view`, admin.token, 'POST'), ctxFor(t2event));
  check('cross-tenant event: 404', v6.status === 404);
  const codeOf = async (fn: () => Promise<unknown>) => { try { await fn(); return 'OK'; } catch (e) { return (e as { code?: string }).code ?? 'ERR'; } };
  check('recordEventViewForCaller keeps its error codes (service level)', (await codeOf(() => recordEventViewForCaller(T1, stranger.id, 'MEMBER', upcoming))) === 'FORBIDDEN_SCOPE' && (await codeOf(() => recordEventViewForCaller(T1, m1.id, 'MEMBER', upcoming))) === 'OK');

  console.log(`\n${passed}/${passed + failed} checks passed${failed ? '  (' + failed + ' FAILED)' : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST SCRIPT ERROR', e); process.exit(1); });
