/**
 * FP-254 acceptance of Terms/Privacy + 18+ confirmation (web, database + services).
 *
 * Needs the LOCAL Supabase with migration 20261121000090 applied (works with or without ...091).
 * Run: npx tsx scripts/test-fp254-acceptance.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// FP-263: refuse to run unless the database is on this computer.
import { assertLocalDb } from './lib/assert-local-db';
assertLocalDb();

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { completeRegistration } from '../src/features/registration/registration.service';
import { createTenantAndFoundingAdmin } from '../src/features/founder-registration/founder-registration.service';
import { getAcceptanceRequired, recordAcceptance } from '../src/features/legal/acceptance.service';
import { validateAcceptanceBody } from '../src/features/legal/acceptance.validation';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const svc = createClient(URL, SVC);
const run = Date.now().toString(36);

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`PASS ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
}

async function mkUser(label: string): Promise<{ id: string; token: string; email: string; client: SupabaseClient }> {
  const email = `fp254-${label}-${run}@test.local`;
  const password = 'Test-password-254!';
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${label}: ${error?.message}`);
  const anon = createClient(URL, ANON);
  const { data: s, error: se } = await anon.auth.signInWithPassword({ email, password });
  if (se || !s.session) throw new Error(`signIn ${label}: ${se?.message}`);
  const client = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } });
  return { id: data.user.id, token: s.session.access_token, email, client };
}

async function mkTenant(name: string): Promise<string> {
  const { data, error } = await svc.from('tenants').insert({ name: `${name} ${run}` }).select('id').single();
  if (error) throw new Error(`tenant: ${error.message}`);
  return data.id;
}

async function mkMember(tenantId: string, label: string, role = 'ADMIN') {
  const u = await mkUser(label);
  const { data, error } = await svc.from('members').insert({
    tenant_id: tenantId, user_id: u.id, email: u.email, role,
    first_name: label, last_name: 'T', gender: 'FEMALE', marital_status: 'SINGLE',
  }).select('id').single();
  if (error) throw new Error(`member ${label}: ${error.message}`);
  return { ...u, memberId: data.id as string };
}

async function acceptanceRows(memberId: string) {
  const { data, error } = await svc.from('member_acceptances').select('*').eq('member_id', memberId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function versions() {
  const { data, error } = await svc.from('legal_document_versions').select('*').single();
  if (error) throw new Error(error.message);
  return data as { terms_effective_date: string; privacy_effective_date: string };
}

async function mkInvitee(tenantId: string, invitedBy: string, label: string) {
  const u = await mkUser(label);
  const { error } = await svc.from('invitations').insert({
    tenant_id: tenantId, email: u.email, role: 'MEMBER', invited_by: invitedBy, auth_user_id: u.id, status: 'PENDING',
  });
  if (error) throw new Error(`invitation ${label}: ${error.message}`);
  return u;
}

async function main() {
  // ---------------------------------------------------------------- A. pure validation helper
  console.log('--- A. validateAcceptanceBody');
  check('A1 both true is ok', validateAcceptanceBody({ confirmAdult: true, acceptTerms: true }).ok === true);
  check('A2 confirmAdult false refused', validateAcceptanceBody({ confirmAdult: false, acceptTerms: true }).ok === false);
  check('A3 acceptTerms false refused', validateAcceptanceBody({ confirmAdult: true, acceptTerms: false }).ok === false);
  check('A4 missing flag refused', validateAcceptanceBody({ confirmAdult: true }).ok === false);
  check('A5 string "true" refused', validateAcceptanceBody({ confirmAdult: 'true', acceptTerms: 'true' }).ok === false);
  check('A6 1 refused', validateAcceptanceBody({ confirmAdult: 1, acceptTerms: 1 }).ok === false);
  check('A7 null body refused', validateAcceptanceBody(null).ok === false);
  check('A8 array body refused', validateAcceptanceBody([true, true]).ok === false);
  check('A9 extra fields (id) are not needed and do not matter',
    validateAcceptanceBody({ confirmAdult: true, acceptTerms: true, memberId: 'x' }).ok === true);

  // ---------------------------------------------------------------- setup
  const tenantA = await mkTenant('FP254 A');
  const tenantB = await mkTenant('FP254 B');
  const adminA = await mkMember(tenantA, 'adminA');
  const memberB = await mkMember(tenantB, 'adminB');
  const v = await versions();

  // ---------------------------------------------------------------- B. complete_registration
  console.log('--- B. complete_registration (invitee)');
  const inv1 = await mkInvitee(tenantA, adminA.memberId, 'inv1');
  const reg1 = await completeRegistration(inv1.token, {
    firstName: 'Ina', lastName: 'One', gender: 'FEMALE', maritalStatus: 'SINGLE', confirmAdult: true, acceptTerms: true,
  });
  const rows1 = await acceptanceRows(reg1.memberId);
  check('B1 registration with both boxes succeeds', !!reg1.memberId);
  check('B2 one acceptance row written', rows1.length === 1);
  check('B3 row has tenant, 18+ yes, current effective dates',
    rows1[0]?.tenant_id === tenantA && rows1[0]?.confirmed_18_plus === true &&
    rows1[0]?.terms_effective_date === v.terms_effective_date && rows1[0]?.privacy_effective_date === v.privacy_effective_date);
  check('B4 row has a timestamp', !!rows1[0]?.accepted_at);
  const { data: invRow1 } = await svc.from('invitations').select('status').eq('auth_user_id', inv1.id).single();
  check('B5 invitation consumed', invRow1?.status === 'ACCEPTED');

  // each box missing -> refused, nothing written
  for (const [label, confirmAdult, acceptTerms, code] of [
    ['missing 18+', false, true, 'ADULT_NOT_CONFIRMED'],
    ['missing terms', true, false, 'TERMS_NOT_ACCEPTED'],
  ] as const) {
    const inv = await mkInvitee(tenantA, adminA.memberId, `inv-${label.replace(/\W/g, '')}`);
    let got = '';
    try {
      await completeRegistration(inv.token, {
        firstName: 'X', lastName: 'Y', gender: 'MALE', maritalStatus: 'SINGLE', confirmAdult, acceptTerms,
      });
    } catch (e) { got = (e as { code?: string }).code ?? ''; }
    check(`B6 ${label}: refused with ${code}`, got === code, `got ${got}`);
    const { data: m } = await svc.from('members').select('id').eq('user_id', inv.id);
    const { data: i } = await svc.from('invitations').select('status').eq('auth_user_id', inv.id).single();
    check(`B7 ${label}: no member row written`, (m ?? []).length === 0);
    check(`B8 ${label}: invitation still PENDING`, i?.status === 'PENDING');
  }

  // NULL flags (a client that omits them) are refused too
  {
    const inv = await mkInvitee(tenantA, adminA.memberId, 'invnull');
    const { error } = await inv.client.rpc('complete_registration', {
      p_first_name: 'N', p_last_name: 'N', p_gender: 'MALE', p_marital_status: 'SINGLE', p_confirm_18: null, p_accept_terms: true,
    });
    const { data: m } = await svc.from('members').select('id').eq('user_id', inv.id);
    check('B9 NULL p_confirm_18 refused, nothing written', !!error && (m ?? []).length === 0);
  }

  // atomic: if the acceptance row cannot be written, the member row is not kept either
  {
    const inv = await mkInvitee(tenantA, adminA.memberId, 'invatomic');
    const saved = await versions();
    await svc.from('legal_document_versions').delete().eq('id', true);
    let failedAsExpected = false;
    try {
      await completeRegistration(inv.token, {
        firstName: 'A', lastName: 'A', gender: 'MALE', maritalStatus: 'SINGLE', confirmAdult: true, acceptTerms: true,
      });
    } catch { failedAsExpected = true; }
    await svc.from('legal_document_versions').insert({
      id: true, terms_effective_date: saved.terms_effective_date, privacy_effective_date: saved.privacy_effective_date,
    });
    const { data: m } = await svc.from('members').select('id').eq('user_id', inv.id);
    const { data: i } = await svc.from('invitations').select('status').eq('auth_user_id', inv.id).single();
    check('B10 acceptance write fails -> registration fails', failedAsExpected);
    check('B11 ...and the member row was rolled back (atomic)', (m ?? []).length === 0);
    check('B12 ...and the invitation is still PENDING', i?.status === 'PENDING');
  }

  // ---------------------------------------------------------------- C. create_tenant_and_founding_admin
  console.log('--- C. create_tenant_and_founding_admin (founder)');
  const f1 = await mkUser('founder1');
  const fr = await createTenantAndFoundingAdmin(f1.token, {
    communityName: `Founded ${run}`, description: null, firstName: 'Fay', lastName: 'One',
    gender: 'FEMALE', maritalStatus: 'SINGLE', confirmAdult: true, acceptTerms: true,
  });
  const fRows = await acceptanceRows(fr.memberId);
  check('C1 founder registration with both boxes succeeds', !!fr.tenantId && !!fr.memberId);
  check('C2 founder acceptance row written with tenant, 18+, current dates',
    fRows.length === 1 && fRows[0].tenant_id === fr.tenantId && fRows[0].confirmed_18_plus === true &&
    fRows[0].terms_effective_date === v.terms_effective_date && fRows[0].privacy_effective_date === v.privacy_effective_date);

  for (const [label, confirmAdult, acceptTerms, code] of [
    ['missing 18+', false, true, 'ADULT_NOT_CONFIRMED'],
    ['missing terms', true, false, 'TERMS_NOT_ACCEPTED'],
  ] as const) {
    const f = await mkUser(`founder-${label.replace(/\W/g, '')}`);
    const name = `Refused ${label} ${run}`;
    let got = '';
    try {
      await createTenantAndFoundingAdmin(f.token, {
        communityName: name, description: null, firstName: 'F', lastName: 'F',
        gender: 'MALE', maritalStatus: 'SINGLE', confirmAdult, acceptTerms,
      });
    } catch (e) { got = (e as { code?: string }).code ?? ''; }
    const { data: t } = await svc.from('tenants').select('id').eq('name', name);
    const { data: m } = await svc.from('members').select('id').eq('user_id', f.id);
    check(`C3 founder ${label}: refused with ${code}`, got === code, `got ${got}`);
    check(`C4 founder ${label}: no tenant and no member written`, (t ?? []).length === 0 && (m ?? []).length === 0);
  }

  // ---------------------------------------------------------------- D. table rules
  console.log('--- D. same-tenant trigger, immutability');
  const insCross = await svc.from('member_acceptances').insert({
    tenant_id: tenantA, member_id: memberB.memberId, terms_effective_date: v.terms_effective_date,
    privacy_effective_date: v.privacy_effective_date, confirmed_18_plus: true,
  });
  check('D1 acceptance for a member of ANOTHER tenant is refused (same-tenant trigger)', !!insCross.error);

  const noConfirm = await svc.from('member_acceptances').insert({
    tenant_id: tenantB, member_id: memberB.memberId, terms_effective_date: v.terms_effective_date,
    privacy_effective_date: v.privacy_effective_date, confirmed_18_plus: false,
  });
  check('D2 confirmed_18_plus = false is refused by the table', !!noConfirm.error);

  const upd = await svc.from('member_acceptances').update({ accepted_at: new Date().toISOString() }).eq('member_id', reg1.memberId);
  check('D3 UPDATE of an acceptance row is refused (immutable)', !!upd.error);
  const stillOne = await acceptanceRows(reg1.memberId);
  check('D4 row unchanged after the refused UPDATE', stillOne.length === 1 && stillOne[0].accepted_at === rows1[0].accepted_at);

  const dupe = await svc.from('member_acceptances').insert({
    tenant_id: tenantA, member_id: reg1.memberId, terms_effective_date: v.terms_effective_date,
    privacy_effective_date: v.privacy_effective_date, confirmed_18_plus: true,
  });
  check('D5 second row for the same member and dates is refused (UNIQUE)', !!dupe.error);

  const delTarget = await mkMember(tenantA, 'delme', 'MEMBER');
  await recordAcceptance(delTarget.memberId, tenantA, true);
  const del = await svc.from('member_acceptances').delete().eq('member_id', delTarget.memberId);
  check('D6 DELETE stays allowed (closing a Community)', !del.error && (await acceptanceRows(delTarget.memberId)).length === 0);

  // ---------------------------------------------------------------- E. grants
  console.log('--- E. grants');
  const anon = createClient(URL, ANON);
  const args = { p_tenant_id: tenantA, p_member_id: adminA.memberId };
  const a1 = await anon.rpc('member_acceptance_required', args);
  const a2 = await anon.rpc('record_member_acceptance', { ...args, p_confirm_18: true });
  const u1 = await adminA.client.rpc('member_acceptance_required', args);
  const u2 = await adminA.client.rpc('record_member_acceptance', { ...args, p_confirm_18: true });
  check('E1 anon cannot call member_acceptance_required', !!a1.error);
  check('E2 anon cannot call record_member_acceptance', !!a2.error);
  check('E3 authenticated cannot call member_acceptance_required', !!u1.error);
  check('E4 authenticated cannot call record_member_acceptance', !!u2.error);
  check('E5 no acceptance row was created by the refused calls', (await acceptanceRows(adminA.memberId)).length === 0);
  const t1 = await anon.from('member_acceptances').select('*');
  const t2 = await adminA.client.from('member_acceptances').select('*');
  const t3 = await adminA.client.from('legal_document_versions').select('*');
  check('E6 anon cannot read member_acceptances', !!t1.error || (t1.data ?? []).length === 0);
  check('E7 authenticated cannot read member_acceptances', !!t2.error || (t2.data ?? []).length === 0);
  check('E8 authenticated cannot read legal_document_versions', !!t3.error || (t3.data ?? []).length === 0);
  const t4 = await adminA.client.from('member_acceptances').insert({
    tenant_id: tenantA, member_id: adminA.memberId, terms_effective_date: v.terms_effective_date,
    privacy_effective_date: v.privacy_effective_date, confirmed_18_plus: true,
  });
  check('E9 authenticated cannot write member_acceptances', !!t4.error);

  // the two registration functions keep their grants: callable with the registrant's own token
  // (proved by B and C above); anon is still refused
  const anonReg = await anon.rpc('complete_registration', {
    p_first_name: 'a', p_last_name: 'b', p_gender: 'MALE', p_marital_status: 'SINGLE', p_confirm_18: true, p_accept_terms: true,
  });
  check('E10 anon cannot call complete_registration', !!anonReg.error);

  // ---------------------------------------------------------------- F. required / record
  console.log('--- F. member_acceptance_required / record_member_acceptance');
  check('F1 required is true before any acceptance', (await getAcceptanceRequired(adminA.memberId, tenantA)) === true);
  const at1 = await recordAcceptance(adminA.memberId, tenantA, true);
  check('F2 record returns a timestamp', !!at1);
  check('F3 required is false after record', (await getAcceptanceRequired(adminA.memberId, tenantA)) === false);
  const at2 = await recordAcceptance(adminA.memberId, tenantA, true);
  check('F4 recording again is idempotent (same stored time, one row)',
    at1 === at2 && (await acceptanceRows(adminA.memberId)).length === 1);
  check('F5 acceptance of another member does not satisfy this one',
    (await getAcceptanceRequired(memberB.memberId, tenantB)) === true);

  // refusals
  let c18 = ''; try { await recordAcceptance(memberB.memberId, tenantB, false); } catch (e) { c18 = (e as { code?: string }).code ?? ''; }
  check('F6 record without 18+ is refused (FP422 -> VALIDATION_ERROR)', c18 === 'VALIDATION_ERROR');
  let cx = ''; try { await recordAcceptance(memberB.memberId, tenantA, true); } catch (e) { cx = (e as { code?: string }).code ?? ''; }
  check('F7 record for a member of another tenant is refused (FP404)', cx === 'NOT_FOUND_IN_TENANT');
  let cu = ''; try { await recordAcceptance('00000000-0000-0000-0000-00000000dead', tenantA, true); } catch (e) { cu = (e as { code?: string }).code ?? ''; }
  check('F8 record for an unknown member is refused (FP404)', cu === 'NOT_FOUND_IN_TENANT');
  check('F9 required for another tenant\'s member id is false (no cross-tenant answer)',
    (await getAcceptanceRequired(memberB.memberId, tenantA)) === false);

  // effective dates change -> required again; accepting stores a second row, the first is kept
  const old = await versions();
  const newDate = '2099-01-01';
  const { error: upErr } = await svc.from('legal_document_versions')
    .update({ terms_effective_date: newDate, updated_at: new Date().toISOString() }).eq('id', true);
  let reRequired = false; let secondRows = 0;
  try {
    reRequired = (await getAcceptanceRequired(adminA.memberId, tenantA)) === true;
    await recordAcceptance(adminA.memberId, tenantA, true);
    secondRows = (await acceptanceRows(adminA.memberId)).length;
  } finally {
    await svc.from('legal_document_versions')
      .update({ terms_effective_date: old.terms_effective_date }).eq('id', true);
  }
  check('F10 changing the effective dates makes acceptance required again', !upErr && reRequired);
  check('F11 accepting the new version adds a row and keeps the old one', secondRows === 2);

  // the privacy date alone also triggers it
  const { error: up2 } = await svc.from('legal_document_versions')
    .update({ privacy_effective_date: '2099-02-02' }).eq('id', true);
  const reRequired2 = (await getAcceptanceRequired(memberB.memberId, tenantB)) === true &&
    (await getAcceptanceRequired(delTarget.memberId, tenantA)) === true;
  await svc.from('legal_document_versions').update({ privacy_effective_date: old.privacy_effective_date }).eq('id', true);
  check('F12 changing only the privacy date also makes it required again', !up2 && reRequired2);

  // ---------------------------------------------------------------- G. removed member
  console.log('--- G. removed member keeps the record');
  const target = await mkMember(tenantA, 'removeme', 'MEMBER');
  await recordAcceptance(target.memberId, tenantA, true);
  const before = await acceptanceRows(target.memberId);
  const { error: rmErr } = await svc.rpc('remove_member', { p_tenant_id: tenantA, p_member_id: target.memberId, p_reason: 'DEACTIVATED' });
  const after = await acceptanceRows(target.memberId);
  check('G1 remove_member works', !rmErr, rmErr?.message);
  check('G2 the acceptance row is kept after removal, unchanged',
    before.length === 1 && after.length === 1 && after[0].id === before[0].id && after[0].accepted_at === before[0].accepted_at);
  check('G3 required is false for a removed member', (await getAcceptanceRequired(target.memberId, tenantA)) === false);
  let cr = ''; try { await recordAcceptance(target.memberId, tenantA, true); } catch (e) { cr = (e as { code?: string }).code ?? ''; }
  check('G4 recording for a removed member is refused (FP404)', cr === 'NOT_FOUND_IN_TENANT');

  // ---------------------------------------------------------------- H. birthdate no longer collected
  console.log('--- H. no birthdate');
  const probe = await svc.from('members').select('birthdate').limit(1);
  const hasCol = !probe.error;
  console.log(`INFO members.birthdate column ${hasCol ? 'still exists (migration ...091 not applied)' : 'is gone (migration ...091 applied)'}`);
  const newMember = await svc.from('members').select('*').eq('id', reg1.memberId).single();
  check('H1 a member registered through the new function has no birthdate value',
    !('birthdate' in (newMember.data ?? {})) || (newMember.data as Record<string, unknown>).birthdate === null);
  const { data: audit } = await svc.from('audit_logs').select('after_value').eq('entity_id', reg1.memberId).eq('action', 'register').limit(1).single();
  const bd = (audit?.after_value as Record<string, unknown> | null)?.birthdate;
  check('H2 the registration audit entry holds no birthdate value', bd === undefined || bd === null);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('SOME FAILED'); process.exit(1); }
  console.log('ALL PASSED');
}

main().catch(e => { console.error('ERROR', e); process.exit(1); });
