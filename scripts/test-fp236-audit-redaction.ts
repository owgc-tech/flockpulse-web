/**
 * FP-236 (web) — the audit log keeps ids, not identifying details; a removed member's own
 * words are replaced: tests
 *
 * Real service code (founder / invite registration, invitation revoke, member removal) and the
 * real SQL writers (RSVP, self-report, leader confirmation, admin override) against the LOCAL
 * database (supabase start + db reset). The DB is reached through supabase-js (service role)
 * and, for owner-level and privilege checks, through `docker exec ... psql`.
 *
 * Run:  npx tsx scripts/test-fp236-audit-redaction.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { removeMember } from '../src/features/members/service';
import { createTenantAndFoundingAdmin } from '../src/features/founder-registration/founder-registration.service';
import { completeRegistration } from '../src/features/registration/registration.service';
import { insertInvitation } from '../src/features/invitations/invitation.repository';
import { revokeInvitation } from '../src/features/invitations/invitation.service';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anon = createClient(URL_, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const stamp = Date.now();
// order-independent (Postgres jsonb does not keep key order)
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
const eq = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const sorted = <T,>(a: T[]) => [...a].sort();
const MIGRATION = 'supabase/migrations/20261006000083_audit_ids_only_and_removed_member_text.sql';

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
// the error text when the statement(s) fail, '' when they succeed
function psqlError(sql: string): string {
  try { psql(sql); return ''; } catch (e) { return String((e as { stderr?: string }).stderr ?? (e as Error).message); }
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function main() {
  // ============================================================== fixtures: one community
  const T = must(await svc.from('tenants').insert({ name: 'FP236-' + stamp }).select('id').single(), 'tenant').id as string;
  const etId = must(await svc.from('event_types').insert({ tenant_id: T, name: 'ET', code: 'F' + (stamp % 1000) }).select('id').single(), 'et').id as string;
  must(await svc.from('tenants').update({ max_guest_count_default: 10, attendance_window_hours: 720 }).eq('id', T).select('id'), 'tenant settings');

  async function mkMember(first: string, role = 'MEMBER') {
    const email = `${first.toLowerCase()}-${stamp}@example.test`;
    const m = must(await svc.from('members').insert({
      tenant_id: T, user_id: crypto.randomUUID(), email, role, first_name: first, last_name: `Last${first}${stamp}`,
      gender: 'FEMALE', marital_status: 'SINGLE', birthdate: '1987-03-09',
    }).select('id').single(), first) as { id: string };
    return { id: m.id, first, last: `Last${first}${stamp}`, email };
  }
  const admin = await mkMember('Adm' + stamp, 'ADMIN');
  const X = await mkMember('Xavier' + stamp);     // removed as DEACTIVATED
  const Y = await mkMember('Yolanda' + stamp);    // removed as SELF_DELETED
  const Z = await mkMember('Zed' + stamp);        // untouched control
  const everyone = [admin, X, Y, Z];

  const mkEvent = async (name: string, daysFromNow: number) => {
    const day = 864e5;
    const e = must(await svc.from('events').insert({
      tenant_id: T, event_type_id: etId, name: `${name}-${stamp}`,
      start_datetime: new Date(Date.now() + daysFromNow * day).toISOString(), end_datetime: new Date(Date.now() + daysFromNow * day + 72e5).toISOString(),
      location_name: 'Hall', location_address: '1 Main St', target: {}, status: 'SCHEDULED', owner_member_id: admin.id, guests_allowed: true,
    }).select('id').single(), name) as { id: string };
    for (const m of everyone) must(await svc.from('event_attendees').upsert({ tenant_id: T, event_id: e.id, member_id: m.id }, { onConflict: 'event_id,member_id' }).select('event_id'), 'attendee');
    return e.id;
  };
  const Ef = await mkEvent('Future1', 10);     // RSVP "No" with a reason
  const Ef2 = await mkEvent('Future2', 11);    // RSVP with guests above a since-lowered maximum
  const Ep1 = await mkEvent('Past1', -3);      // YES self-report with feedback
  const Ep2 = await mkEvent('Past2', -4);      // NO self-report with a reason
  const Ep3 = await mkEvent('Past3', -5);      // YES self-report confirmed by a leader with a note
  const Ep4 = await mkEvent('Past4', -6);      // admin override with a reason

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const r = await svc.rpc(fn, args);
    if (r.error) throw new Error(`${fn}: ${JSON.stringify(r.error)}`);
    return Array.isArray(r.data) ? r.data[0] : r.data;
  };

  type Planted = { phrases: string[]; rsvpReason: string; guestReason: string; feedback: string; noReason: string; note: string; override: string };
  async function plant(m: { id: string; first: string }): Promise<Planted> {
    const ph = (k: string) => `${m.first}-${k}-${stamp}`;
    const p: Planted = { phrases: [], rsvpReason: ph('rsvpreason'), guestReason: ph('guestreason'), feedback: ph('feedback'), noReason: ph('noreason'), note: ph('leadernote'), override: ph('override') };
    p.phrases = [p.rsvpReason, p.guestReason, p.feedback, p.noReason, p.note, p.override];
    await rpc('upsert_rsvp_with_audit', { p_tenant_id: T, p_event_id: Ef, p_member_id: m.id, p_rsvp_status: 'NO', p_rsvp_reason: p.rsvpReason, p_guest_count: null, p_actor_member_id: m.id });
    // planted directly: an RSVP that carries both a reason and a guest count (the guest-maximum trap)
    must(await svc.from('rsvps').insert({ tenant_id: T, event_id: Ef2, member_id: m.id, rsvp_status: 'YES', rsvp_reason: p.guestReason, guest_count: 7 }).select('id'), 'guest rsvp');
    await rpc('insert_self_report_yes_with_audit', { p_tenant_id: T, p_event_id: Ep1, p_member_id: m.id, p_feedback: p.feedback, p_star_rating: 4 });
    await rpc('submit_self_report_no', { p_tenant_id: T, p_event_id: Ep2, p_member_id: m.id, p_reason: p.noReason });
    const yes3 = await rpc('insert_self_report_yes_with_audit', { p_tenant_id: T, p_event_id: Ep3, p_member_id: m.id, p_feedback: null, p_star_rating: 5 });
    await rpc('resolve_leader_confirmation', { p_tenant_id: T, p_self_report_id: yes3.id, p_leader_member_id: admin.id, p_decision: 'CONFIRM', p_leader_note: p.note });
    await rpc('admin_override_attendance', { p_tenant_id: T, p_event_id: Ep4, p_member_id: m.id, p_attendance_status: 'ATTENDED', p_admin_member_id: admin.id, p_reason: p.override });
    return p;
  }
  const pX = await plant(X), pY = await plant(Y), pZ = await plant(Z);
  must(await svc.from('tenants').update({ max_guest_count_default: 5 }).eq('id', T).select('id'), 'lower max');   // 7 guests now exceed the maximum

  const anyPhrase = (ps: string[]) => `(COALESCE(before_value::text, '') || COALESCE(after_value::text, '')) ILIKE ANY (ARRAY[${ps.map((s) => q('%' + s + '%')).join(',')}])`;
  const auditCountFor = (ps: string[]) => Number(psql(`SELECT count(*) FROM audit_logs WHERE tenant_id = '${T}' AND ${anyPhrase(ps)}`));
  const snapshot = async (id: string) => ({
    rsvps: ((await svc.from('rsvps').select('event_id, rsvp_status, guest_count').eq('member_id', id).order('event_id')).data ?? []),
    reports: ((await svc.from('member_attendance_reports').select('event_id, confirmation_status, star_rating').eq('member_id', id).order('event_id')).data ?? []),
    attendance: ((await svc.from('attendance').select('event_id, attendance_status, confirmation_type, confirmed_by').eq('member_id', id).order('event_id')).data ?? []),
  });
  const texts = async (id: string) => ({
    rsvps: sorted(((await svc.from('rsvps').select('rsvp_reason').eq('member_id', id)).data ?? []).map((r: { rsvp_reason: string | null }) => String(r.rsvp_reason))),
    reasons: sorted(((await svc.from('member_attendance_reports').select('reason, feedback').eq('member_id', id)).data ?? []).map((r: { reason: string | null; feedback: string | null }) => `${r.reason}/${r.feedback}`)),
    notes: sorted(((await svc.from('attendance').select('leader_note').eq('member_id', id)).data ?? []).map((r: { leader_note: string | null }) => String(r.leader_note))),
  });

  // sanity: the planted texts really are in the tables and in the audit log before removal
  const xBefore = await snapshot(X.id), yBefore = await snapshot(Y.id), zBefore = await snapshot(Z.id);
  const zTextsBefore = await texts(Z.id);
  const xAuditBefore = auditCountFor(pX.phrases);
  console.log(`  (planted: ${xAuditBefore} audit entries carry member X's six texts; Z has ${auditCountFor(pZ.phrases)})`);
  check('before removal the six planted texts are present in the audit log (so the later "0" means something)', xAuditBefore >= 4 && auditCountFor(pZ.phrases) >= 4);

  // ============================================================== registration writes ids only
  console.log('\n=== New writes store ids only');
  async function authUser(label: string) {
    const email = `${label}-${stamp}@example.test`;
    const u = await svc.auth.admin.createUser({ email, password: 'Pw-12345-abcde', email_confirm: true });
    if (u.error) throw u.error;
    const { data: sess, error } = await anon.auth.signInWithPassword({ email, password: 'Pw-12345-abcde' });
    if (error || !sess.session) throw error ?? new Error('no session');
    return { id: u.data.user!.id, email, token: sess.session.access_token };
  }
  const auditRows = async (entityType: string, entityId: string, action?: string) => {
    let qy = svc.from('audit_logs').select('id, before_value, after_value, action').eq('entity_type', entityType).eq('entity_id', entityId);
    if (action) qy = qy.eq('action', action);
    return (await qy).data ?? [];
  };
  const founder = await authUser('founder');
  const reg = await createTenantAndFoundingAdmin(founder.token, {
    communityName: 'FP236 Founded ' + stamp, description: null, firstName: 'Founderfirst' + stamp, lastName: 'Founderlast' + stamp,
    gender: 'MALE', maritalStatus: 'MARRIED', birthdate: '1980-02-02',
  }).catch(async () => createTenantAndFoundingAdmin(founder.token, {
    communityName: 'FP236 Founded ' + stamp, description: null, firstName: 'Founderfirst' + stamp, lastName: 'Founderlast' + stamp,
    gender: 'MALE', maritalStatus: 'SINGLE', birthdate: '1980-02-02',
  }));
  const founderEntries = await auditRows('member', reg.memberId, 'register');
  check('founder registration: exactly one member/register entry, holding only id, tenant_id, role, role_catalog_entry_id',
    founderEntries.length === 1 && eq(sorted(Object.keys(founderEntries[0].after_value ?? {})), ['id', 'role', 'role_catalog_entry_id', 'tenant_id']),
    JSON.stringify(founderEntries.map((e: { after_value: unknown }) => Object.keys(e.after_value as object))));
  check('...the entry holds no name, email, birthdate or gender', !/Founderfirst|Founderlast|founder-|1980|MALE/.test(JSON.stringify(founderEntries)));
  check('...the id inside it is the real member id and role is ADMIN', founderEntries[0]?.after_value?.id === reg.memberId && founderEntries[0]?.after_value?.role === 'ADMIN');

  const invitee = await authUser('invitee');
  const inv = await insertInvitation({ tenantId: reg.tenantId, email: invitee.email, role: 'MEMBER', roleCatalogEntryId: null, groupId: null, invitedBy: reg.memberId, authUserId: invitee.id });
  const registered = await completeRegistration(invitee.token, { firstName: 'Inviteefirst' + stamp, lastName: 'Inviteelast' + stamp, gender: 'FEMALE', maritalStatus: 'SINGLE', birthdate: '1991-07-07' });
  const inviteeEntries = await auditRows('member', registered.memberId, 'register');
  check('invite registration: the member/register entry holds only id, tenant_id, role, role_catalog_entry_id',
    inviteeEntries.length === 1 && eq(sorted(Object.keys(inviteeEntries[0].after_value ?? {})), ['id', 'role', 'role_catalog_entry_id', 'tenant_id']));
  check('...no name, email, birthdate or login id in it', !/Inviteefirst|Inviteelast|invitee-|1991/.test(JSON.stringify(inviteeEntries)) && !JSON.stringify(inviteeEntries).includes(invitee.id));
  check('...the invitation row itself still holds the email (the invitations table is unchanged)', (await svc.from('invitations').select('email').eq('id', inv.id).single()).data?.email === invitee.email);

  const revokee = await authUser('revokee');
  const inv2 = await insertInvitation({ tenantId: reg.tenantId, email: revokee.email, role: 'MEMBER', roleCatalogEntryId: null, groupId: null, invitedBy: reg.memberId, authUserId: revokee.id });
  await revokeInvitation(reg.tenantId, reg.memberId, inv2.id);
  const revokeEntries = await auditRows('invitation', inv2.id);
  const invKeys = new Set(['id', 'tenant_id', 'role', 'role_catalog_entry_id', 'group_id', 'invited_by', 'status', 'invited_at', 'responded_at']);
  const keysSeen = revokeEntries.flatMap((e: { before_value: object | null; after_value: object | null }) => [...Object.keys(e.before_value ?? {}), ...Object.keys(e.after_value ?? {})]);
  check('revoking an invitation (the real service): an entry is written with no email and no auth_user_id',
    revokeEntries.length >= 1 && keysSeen.every((k: string) => invKeys.has(k)) && !JSON.stringify(revokeEntries).includes(revokee.email) && !JSON.stringify(revokeEntries).includes(revokee.id), JSON.stringify(keysSeen));
  check('...the entry still says which invitation, its status and who revoked it (ids)', revokeEntries[0]?.before_value?.id === inv2.id && revokeEntries[0]?.before_value?.status === 'PENDING');
  check('database-wide: none of the three registration emails or names appears anywhere in audit_logs',
    Number(psql(`SELECT count(*) FROM audit_logs WHERE (COALESCE(before_value::text, '') || COALESCE(after_value::text, '')) ILIKE ANY (ARRAY['%founder-${stamp}%','%invitee-${stamp}%','%revokee-${stamp}%','%Founderfirst${stamp}%','%Inviteefirst${stamp}%'])`)) === 0);

  // pass-through: other entity types are untouched
  const evId = crypto.randomUUID();
  const evBefore = { name: 'Old name', location_address: '1 Main St', version: 2 }, evAfter = { name: 'New name', location_address: '2 Main St', version: 3 };
  const wr1 = await svc.rpc('write_audit_log', { p_tenant_id: T, p_entity_type: 'event', p_entity_id: evId, p_action: 'update', p_actor_id: admin.id, p_before: evBefore, p_after: evAfter });
  if (wr1.error) console.log('   write_audit_log error:', JSON.stringify(wr1.error));
  const evRow = (await auditRows('event', evId, 'update'))[0];
  check('an event audit entry is stored exactly as written (unchanged behavior; modifiedFields still reads it)', eq(evRow?.before_value, evBefore) && eq(evRow?.after_value, evAfter));
  await svc.rpc('write_audit_log', { p_tenant_id: T, p_entity_type: 'talk_completion', p_entity_id: evId, p_action: 'create', p_actor_id: admin.id, p_before: null, p_after: { member_id: admin.id, talk_id: evId } });
  check('...and so is a talk_completion entry (ids only already)', eq((await auditRows('talk_completion', evId, 'create'))[0]?.after_value, { member_id: admin.id, talk_id: evId }));

  // ============================================================== removal, both reasons
  console.log('\n=== Removing a member replaces their own words');
  for (const [label, person, p, before, reason] of [
    ['DEACTIVATED', X, pX, xBefore, 'DEACTIVATED'], ['SELF_DELETED', Y, pY, yBefore, 'SELF_DELETED'],
  ] as const) {
    const expectedAudit = auditCountFor(p.phrases);
    await removeMember(person.id, T, reason);
    const t = await texts(person.id);
    check(`${label}: the removal succeeded even though an RSVP has 7 guests against a maximum of 5 (the guest-maximum trap)`,
      ((await svc.from('rsvps').select('guest_count').eq('member_id', person.id).eq('event_id', Ef2).single()).data?.guest_count) === 7);
    check(`${label}: every RSVP reason is '[removed]'`, eq(t.rsvps, ['[removed]', '[removed]']), JSON.stringify(t.rsvps));
    check(`${label}: self-report reason and feedback are '[removed]' where they existed (NULLs stay NULL)`,
      t.reasons.includes('[removed]/null') && t.reasons.includes('null/[removed]') && !t.reasons.some((x) => x.includes(person.first)), JSON.stringify(t.reasons));
    check(`${label}: leader notes (the leader's note and the admin-override reason) are '[removed]'; a note that was NULL stays NULL`,
      t.notes.filter((n) => n === '[removed]').length === 2 && t.notes.every((n) => n === '[removed]' || n === 'null'), JSON.stringify(t.notes));
    const after = await snapshot(person.id);
    check(`${label}: statuses, guest counts, ratings and attendance results are unchanged`, eq(after, before), JSON.stringify(after).slice(0, 200));
    check(`${label}: not one planted text is left in audit_logs (database-wide search returns 0 rows)`, auditCountFor(p.phrases) === 0 && Number(psql(`SELECT count(*) FROM audit_logs WHERE ${anyPhrase(p.phrases)}`)) === 0);
    const red = await auditRows('member_redaction', person.id, 'redact_personal_text');
    const c = red[0]?.after_value as { rsvps: number; self_reports: number; attendance: number; audit_entries: number } | undefined;
    check(`${label}: exactly one member_redaction / redact_personal_text entry, with the counts (rsvps 2, self_reports 2, attendance 2, audit_entries ${expectedAudit})`,
      red.length === 1 && c?.rsvps === 2 && c?.self_reports === 2 && c?.attendance === 2 && c?.audit_entries === expectedAudit, JSON.stringify(red.map((r: { after_value: unknown }) => r.after_value)));
    check(`${label}: the redaction record holds counts and the member id only (no text, no name)`, red[0]?.before_value === null && eq(sorted(Object.keys(red[0]?.after_value ?? {})), ['attendance', 'audit_entries', 'rsvps', 'self_reports']));
    const memberRow = (await svc.from('members').select('first_name, last_name, email, deleted_at').eq('id', person.id).single()).data;
    check(`${label}: the member row is the anonymous shell ("${reason === 'DEACTIVATED' ? 'Deactivated' : 'Self-deleted'} User"), original name and email gone`,
      memberRow?.first_name === (reason === 'DEACTIVATED' ? 'Deactivated' : 'Self-deleted') && memberRow?.last_name === 'User' && memberRow?.deleted_at !== null && !String(memberRow?.email).includes(person.first));
    check(`${label}: the original first name, last name and email appear nowhere in audit_logs`,
      Number(psql(`SELECT count(*) FROM audit_logs WHERE (COALESCE(before_value::text, '') || COALESCE(after_value::text, '')) ILIKE ANY (ARRAY[${[person.first, person.last, person.email].map((s) => q('%' + s + '%')).join(',')}])`)) === 0);
  }
  const zTextsAfter = await texts(Z.id);
  check("another member's (Z) texts are unchanged, in the tables and in the audit log", eq(zTextsBefore, zTextsAfter) && eq(await snapshot(Z.id), zBefore) && auditCountFor(pZ.phrases) >= 4);

  console.log(' idempotency:');
  const redBefore = Number(psql(`SELECT count(*) FROM audit_logs WHERE entity_type = 'member_redaction' AND tenant_id = '${T}'`));
  const tBefore = await texts(X.id);
  await removeMember(X.id, T, 'DEACTIVATED');
  check('removing the same member again changes nothing and adds no second redaction entry',
    eq(tBefore, await texts(X.id)) && Number(psql(`SELECT count(*) FROM audit_logs WHERE entity_type = 'member_redaction' AND tenant_id = '${T}'`)) === redBefore && redBefore === 2);

  // ============================================================== append-only still holds
  console.log('\n=== audit_logs is still append-only');
  const someId = psql(`SELECT id FROM audit_logs WHERE tenant_id = '${T}' AND entity_type = 'event' LIMIT 1`);
  const upd = await svc.from('audit_logs').update({ after_value: {} }).eq('id', someId).select('id');
  check('service_role cannot UPDATE audit_logs (no privilege)', !!upd.error && /permission denied/i.test(upd.error.message), JSON.stringify(upd.error));
  const del = await svc.from('audit_logs').delete().eq('id', someId).select('id');
  check('service_role cannot DELETE from audit_logs', !!del.error && /permission denied/i.test(del.error.message), JSON.stringify(del.error));
  check('as the table owner WITHOUT the flag, an UPDATE of after_value is refused (append-only)', /append-only/.test(psqlError(`UPDATE audit_logs SET after_value = '{}' WHERE id = '${someId}'`)));
  check('as the owner with the flag on, an UPDATE of action is still refused', /append-only/.test(psqlError(`BEGIN; SET LOCAL app.audit_redaction = 'on'; UPDATE audit_logs SET action = 'x' WHERE id = '${someId}'; COMMIT;`)));
  check('...an UPDATE of actor_id is still refused', /append-only/.test(psqlError(`BEGIN; SET LOCAL app.audit_redaction = 'on'; UPDATE audit_logs SET actor_id = gen_random_uuid() WHERE id = '${someId}'; COMMIT;`)));
  check('...an UPDATE of entity_type, entity_id, tenant_id or created_at is still refused too',
    ['entity_type = \'x\'', 'entity_id = gen_random_uuid()', 'tenant_id = gen_random_uuid()', 'created_at = now() + interval \'1 day\''].every((set) =>
      /append-only|violates/.test(psqlError(`BEGIN; SET LOCAL app.audit_redaction = 'on'; UPDATE audit_logs SET ${set} WHERE id = '${someId}'; COMMIT;`))));
  check('with the flag on, the ONLY allowed change (before_value / after_value) works (rolled back here)',
    psqlError(`BEGIN; SET LOCAL app.audit_redaction = 'on'; UPDATE audit_logs SET after_value = COALESCE(after_value, '{}'::jsonb) WHERE id = '${someId}'; ROLLBACK;`) === '');
  const flagAfter = psql(`BEGIN; SELECT public.remove_member('${T}', '${(await mkMember('Throwaway' + stamp)).id}', 'DEACTIVATED'); SELECT COALESCE(current_setting('app.audit_redaction', true), 'unset'); ROLLBACK;`).split('\n').pop();
  check("after remove_member inside a larger transaction, the flag is not 'on' again", flagAfter !== 'on', String(flagAfter));

  // ============================================================== privileges
  console.log('\n=== Privileges');
  const priv = (fn: string) => ['anon', 'authenticated', 'service_role'].map((r) => psql(`SELECT has_function_privilege('${r}', '${fn}', 'EXECUTE')`) === 't');
  check('redact_removed_member_personal_text: anon, authenticated and service_role all CANNOT execute it', eq(priv('public.redact_removed_member_personal_text(uuid,uuid)'), [false, false, false]));
  check('audit_redact_identifiers and audit_redact_member_text: not executable by anon or authenticated; service_role can',
    eq(priv('public.audit_redact_identifiers(text,jsonb)'), [false, false, true]) && eq(priv('public.audit_redact_member_text(text,jsonb)'), [false, false, true]));
  check('remove_member is service_role only', eq(priv('public.remove_member(uuid,uuid,text)'), [false, false, true]));
  const redactCall = await svc.rpc('redact_removed_member_personal_text', { p_tenant_id: T, p_member_id: Z.id });
  check('calling the redaction function through the API is refused, and Z\'s texts are unchanged', !!redactCall.error && eq(await texts(Z.id), zTextsBefore));

  // ============================================================== one-time section
  console.log('\n=== The one-time cleanup (section 7), run by applying the migration again');
  const old = await mkMember('Oldtimer' + stamp);
  must(await svc.from('tenants').update({ max_guest_count_default: 10 }).eq('id', T).select('id'), 'raise max');
  const pO = await plant(old);
  must(await svc.from('tenants').update({ max_guest_count_default: 5 }).eq('id', T).select('id'), 'lower max again');                     // texts in tables and in audit entries, member still active
  must(await svc.from('members').update({ deleted_at: new Date().toISOString() }).eq('id', old.id).select('id'), 'remove directly (legacy deactivation)');
  // legacy full-row entries, inserted as the owner, bypassing write_audit_log (as the registration functions used to)
  const legacyMember = { id: old.id, tenant_id: T, email: old.email, role: 'MEMBER', first_name: old.first, last_name: old.last, gender: 'FEMALE', marital_status: 'SINGLE', birthdate: '1987-03-09', user_id: crypto.randomUUID(), role_catalog_entry_id: null };
  const legacyInv = { id: crypto.randomUUID(), tenant_id: T, email: old.email, role: 'MEMBER', auth_user_id: crypto.randomUUID(), status: 'PENDING', invited_by: admin.id, invited_at: new Date().toISOString() };
  psql(`INSERT INTO audit_logs (tenant_id, entity_type, entity_id, action, actor_id, before_value, after_value) VALUES
        ('${T}', 'member', '${old.id}', 'register', '${old.id}', NULL, ${q(JSON.stringify(legacyMember))}::jsonb),
        ('${T}', 'invitation', '${legacyInv.id}', 'revoke', '${admin.id}', ${q(JSON.stringify(legacyInv))}::jsonb, NULL)`);
  const previewSql = (() => {
    const dip = readFileSync('documentation/dips/DIP-FP-236-web.md', 'utf8');
    const block = [...dip.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes('FP-236 preview'))!;
    return block.split('\n').map((l) => l.replace(/^ {3}/, '')).join('\n');
  })();
  const preview = () => Object.fromEntries(psql(previewSql).split('\n').filter(Boolean).map((l) => { const i = l.lastIndexOf('|'); return [l.slice(0, i), Number(l.slice(i + 1))]; })) as Record<string, number>;
  const oldSnap = await snapshot(old.id);
  const p0 = preview();
  console.log('  preview BEFORE:', JSON.stringify(p0));
  check('the preview query sees the planted legacy data: member entry, invitation entry, a removed member\'s RSVP reason, report text and note',
    p0['member audit entries holding more than ids'] >= 1 && p0['invitation audit entries holding an email or auth id'] >= 1 && p0['members already removed'] >= 3
    && p0['their RSVP reasons to replace'] >= 1 && p0['their self-reports with a reason or feedback to replace'] >= 1 && p0['leader notes about them to replace'] >= 1);
  check('...and this member\'s texts are in the audit log right now', auditCountFor(pO.phrases) >= 4);

  const apply = () => execFileSync('docker', [...PSQL, '-v', 'ON_ERROR_STOP=1', '-q'], { input: readFileSync(MIGRATION, 'utf8'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  let applied1 = 'ok';
  try { apply(); } catch (e) { applied1 = String((e as { stderr?: string }).stderr).slice(0, 300); }
  check('the migration applies cleanly again (one script)', applied1 === 'ok', applied1);
  const p1 = preview();
  console.log('  preview AFTER :', JSON.stringify(p1));
  check('after: the first two rows and the three "to replace" rows all read 0',
    p1['member audit entries holding more than ids'] === 0 && p1['invitation audit entries holding an email or auth id'] === 0
    && p1['their RSVP reasons to replace'] === 0 && p1['their self-reports with a reason or feedback to replace'] === 0 && p1['leader notes about them to replace'] === 0);
  check('...members already removed stays the same (they are kept, just redacted)', p1['members already removed'] === p0['members already removed']);
  const tO = await texts(old.id);
  check('the earlier-removed member\'s texts are replaced in the tables', tO.rsvps.every((x) => x === '[removed]') && tO.notes.filter((n) => n !== 'null').every((n) => n === '[removed]') && !tO.reasons.some((x) => x.includes(old.first)), JSON.stringify(tO));
  check('...and not one of their texts is left in audit_logs', auditCountFor(pO.phrases) === 0);
  const legacyRows = (await svc.from('audit_logs').select('entity_type, before_value, after_value').eq('tenant_id', T).in('entity_id', [old.id, legacyInv.id]).in('action', ['register', 'revoke'])).data ?? [];
  const lm = legacyRows.find((r: { entity_type: string }) => r.entity_type === 'member');
  const li = legacyRows.find((r: { entity_type: string }) => r.entity_type === 'invitation');
  check('the legacy member entry is cut to id, tenant_id, role, role_catalog_entry_id', eq(sorted(Object.keys(lm?.after_value ?? {})), ['id', 'role', 'role_catalog_entry_id', 'tenant_id']));
  check('the legacy invitation entry keeps no email and no auth_user_id, and still has its ids and status', li?.before_value && !('email' in li.before_value) && !('auth_user_id' in li.before_value) && li.before_value.id === legacyInv.id && li.before_value.status === 'PENDING' && li.before_value.invited_by === admin.id);
  const ridRows = (await svc.from('audit_logs').select('after_value').eq('tenant_id', T).eq('action', 'redact_audit_identifiers')).data ?? [];
  check('exactly one redact_audit_identifiers entry for this community, with the count of entries changed (2)', ridRows.length === 1 && ridRows[0].after_value?.audit_entries === 2, JSON.stringify(ridRows));
  const oRed = (await svc.from('audit_logs').select('after_value').eq('entity_type', 'member_redaction').eq('entity_id', old.id)).data ?? [];
  check('exactly one redact_personal_text entry for the earlier-removed member', oRed.length === 1 && oRed[0].after_value?.rsvps === 2 && oRed[0].after_value?.self_reports === 2 && oRed[0].after_value?.attendance === 2, JSON.stringify(oRed));
  check("the earlier-removed member's name and email are still found nowhere in the audit log", Number(psql(`SELECT count(*) FROM audit_logs WHERE (COALESCE(before_value::text, '') || COALESCE(after_value::text, '')) ILIKE ANY (ARRAY[${[old.first, old.last, old.email].map((s) => q('%' + s + '%')).join(',')}])`)) === 0);

  const entryCount = () => Number(psql(`SELECT count(*) FROM audit_logs WHERE action IN ('redact_audit_identifiers','redact_personal_text')`));
  const nBefore = entryCount();
  let applied2 = 'ok';
  try { apply(); apply(); } catch (e) { applied2 = String((e as { stderr?: string }).stderr).slice(0, 300); }
  check('applying the migration two more times is clean, changes nothing further and records nothing new', applied2 === 'ok' && entryCount() === nBefore && eq(preview(), p1), applied2);
  check('statuses, ratings and attendance results of the earlier-removed member are unchanged', eq(await snapshot(old.id), oldSnap));
  check("another member's (Z) texts are still unchanged after the one-time cleanup", eq(await texts(Z.id), zTextsBefore) && auditCountFor(pZ.phrases) >= 4);

  console.log(`\n${passed}/${passed + failed} checks passed${failed ? '  (' + failed + ' FAILED)' : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST SCRIPT ERROR', e); process.exit(1); });
