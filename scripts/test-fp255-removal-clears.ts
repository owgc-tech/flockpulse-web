/**
 * FP-255: removing a member clears gender, marital status and (after the login is deleted)
 * the leftover login link. Drives removeMember() end to end on the LOCAL database.
 *
 *  1. an ordinary removal: gender, marital status, birthdate and user_id end up NULL, the login is deleted
 *  2. deleteUser fails: AUTH_DELETE_FAILED, user_id is KEPT; a second removeMember() completes it
 *  3. clearing the link fails after the login is gone: LOGIN_LINK_CLEAR_FAILED, user_id kept;
 *     a second removeMember() completes it (deleteUser reports "not found" and is treated as success)
 *  4. removing an already-removed, fully cleaned member is a no-op, not an error
 *
 * Run: npx tsx scripts/test-fp255-removal-clears.ts   (requires local Supabase running)
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// FP-263: refuse to run unless the database is on this computer.
import { assertLocalDb } from './lib/assert-local-db';
assertLocalDb();

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { GoTrueAdminApi } from '@supabase/auth-js';
import { removeMember } from '../src/features/members/service';

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
}

// ---- failure injection (restored after each use) -------------------------------------------
type AnyFn = (...a: unknown[]) => Promise<unknown>;
const adminProto = GoTrueAdminApi.prototype as unknown as { deleteUser: AnyFn };
const realDeleteUser = adminProto.deleteUser;
const clientProto = SupabaseClient.prototype as unknown as { rpc: AnyFn };
const realRpc = clientProto.rpc;
function failDeleteUserOnce() {
  adminProto.deleteUser = async () => {
    adminProto.deleteUser = realDeleteUser;
    return { data: { user: null }, error: { message: 'injected failure', status: 500, code: 'unexpected_failure' } };
  };
}
function failClearLinkOnce() {
  clientProto.rpc = async function (this: unknown, fn: unknown, args: unknown) {
    if (fn === 'clear_removed_member_login_link') {
      clientProto.rpc = realRpc;
      return { data: null, error: { message: 'injected failure', code: 'XX000' } };
    }
    return realRpc.call(this, fn, args);
  };
}

// ---- fixtures -------------------------------------------------------------------------------
const tag = Date.now().toString(36);
let tenantId = '';
const loginIds: string[] = [];

async function mustOk<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

async function newMemberWithLogin(label: string): Promise<{ memberId: string; userId: string }> {
  const created = await svc.auth.admin.createUser({
    email: `fp255-${tag}-${label}@example.test`, password: 'Passw0rd!fp255', email_confirm: true,
  });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const userId = created.data.user.id;
  loginIds.push(userId);
  const row = await mustOk(svc.from('members').insert({
    tenant_id: tenantId, user_id: userId, email: `fp255-${tag}-${label}@example.test`,
    role: 'MEMBER', first_name: label, last_name: 'Tester',
    gender: 'FEMALE', marital_status: 'MARRIED', birthdate: '1988-07-07',
  }).select('id').single(), 'insert member') as { id: string };
  return { memberId: row.id, userId };
}

async function memberRow(memberId: string) {
  return await mustOk(svc.from('members').select('first_name, gender, marital_status, user_id, deleted_at, birthdate').eq('id', memberId).single(), 'read member') as
    { first_name: string; gender: string | null; marital_status: string | null; user_id: string | null; deleted_at: string | null; birthdate: string | null };
}
async function loginExists(userId: string): Promise<boolean> {
  const r = await svc.auth.admin.getUserById(userId);
  return !r.error && !!r.data.user;
}
async function codeOf(p: Promise<unknown>): Promise<string> {
  try { await p; return 'NO_ERROR'; } catch (e) { return (e as { code?: string }).code ?? 'NO_CODE'; }
}

async function main() {
  const t = await mustOk(svc.from('tenants').insert({ name: `FP255 test ${tag}` }).select('id').single(), 'insert tenant') as { id: string };
  tenantId = t.id;

  console.log('=== 1. ordinary removal');
  const m1 = await newMemberWithLogin('One');
  await removeMember(m1.memberId, tenantId, 'DEACTIVATED');
  const r1 = await memberRow(m1.memberId);
  check('removed and renamed', r1.deleted_at !== null && r1.first_name === 'Deactivated');
  check('gender cleared', r1.gender === null);
  check('marital status cleared', r1.marital_status === null);
  check('user_id cleared', r1.user_id === null);
  check('birthdate cleared completely (not just reduced to a year)', r1.birthdate === null);
  check('login deleted', !(await loginExists(m1.userId)));

  console.log('\n=== 2. deleteUser fails: link kept, retry completes');
  const m2 = await newMemberWithLogin('Two');
  failDeleteUserOnce();
  check('first call -> AUTH_DELETE_FAILED', (await codeOf(removeMember(m2.memberId, tenantId, 'SELF_DELETED'))) === 'AUTH_DELETE_FAILED');
  const r2a = await memberRow(m2.memberId);
  check('record already scrubbed (gender, marital status and birthdate NULL)', r2a.gender === null && r2a.marital_status === null && r2a.birthdate === null && r2a.deleted_at !== null);
  check('user_id KEPT so the retry can find the login', r2a.user_id === m2.userId);
  check('login still exists', await loginExists(m2.userId));
  await removeMember(m2.memberId, tenantId, 'SELF_DELETED');
  const r2b = await memberRow(m2.memberId);
  check('second call completes: user_id NULL', r2b.user_id === null);
  check('second call completes: login deleted', !(await loginExists(m2.userId)));

  console.log('\n=== 3. clearing the link fails after the login is gone');
  const m3 = await newMemberWithLogin('Three');
  failClearLinkOnce();
  check('first call -> LOGIN_LINK_CLEAR_FAILED', (await codeOf(removeMember(m3.memberId, tenantId, 'DEACTIVATED'))) === 'LOGIN_LINK_CLEAR_FAILED');
  const r3a = await memberRow(m3.memberId);
  check('login already gone', !(await loginExists(m3.userId)));
  check('user_id still set until the retry', r3a.user_id === m3.userId);
  await removeMember(m3.memberId, tenantId, 'DEACTIVATED');
  check('second call completes: user_id NULL', (await memberRow(m3.memberId)).user_id === null);

  console.log('\n=== 4. already removed and fully cleaned: no-op');
  check('third call on member 1 does not throw', (await codeOf(removeMember(m1.memberId, tenantId, 'DEACTIVATED'))) === 'NO_ERROR');
  check('still cleared', (await memberRow(m1.memberId)).user_id === null);
}

main()
  .catch((e) => { console.error('ERROR', e); failures++; })
  .finally(async () => {
    adminProto.deleteUser = realDeleteUser;
    clientProto.rpc = realRpc;
    // cleanup: the tenant cascades to its members, role catalog etc.; then any logins left over
    if (tenantId) {
      const { error } = await svc.from('tenants').delete().eq('id', tenantId);
      if (error) console.error('cleanup (tenant):', error.message);
    }
    for (const id of loginIds) await svc.auth.admin.deleteUser(id).catch(() => undefined);
    console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
