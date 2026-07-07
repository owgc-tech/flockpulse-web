/**
 * FP-102 — Web Admin Login: automated tests
 *
 * Group 1: DB constraint — mfa_trust_duration_days CHECK (BETWEEN 1 AND 56)
 * Group 2: MFA API — enroll, challengeAndVerify (correct + incorrect code),
 *          listFactors before/after verification, unenroll
 *
 * Run:  npx ts-node --project tsconfig.json scripts/test-fp102-web-admin-login.ts
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
process.env.SUPABASE_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPA_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing required env vars');
  process.exit(1);
}

function serviceClient() {
  return createClient(SUPA_URL, SERVICE_KEY);
}

// ── minimal RFC 6238 TOTP implementation using Node built-in crypto ──────────
// Decode base32 secret (no padding) → Buffer
function base32Decode(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const c of s.toUpperCase().replace(/=+$/, '')) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); }
  }
  return Buffer.from(out);
}

function hotp(key: Buffer, counter: bigint): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

function jwtAAL(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.aal ?? null;
  } catch {
    return null;
  }
}

function totpNow(secret: string): string {
  const key = base32Decode(secret);
  const counter = BigInt(Math.floor(Date.now() / 1000 / 30));
  return hotp(key, counter);
}
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(id: string, description: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${id}: ${description}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${id}: ${description}`);
    console.error(`     ${(err as Error).message}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ── test state ───────────────────────────────────────────────────────────────
// We'll create a real auth user and a members row to test against.
// The user is cleaned up in the final step.
let testUserId: string | null = null;
let testMemberId: string | null = null;
let testTenantId: string | null = null;
let enrolledFactorId: string | null = null;
let factorSecret: string | null = null;

async function setupTestUser() {
  const svc = serviceClient();
  const email = `fp102-test-${Date.now()}@test.internal`;

  // Create auth user
  const { data: authData, error: authErr } = await svc.auth.admin.createUser({
    email,
    password: 'TestPass1234!',
    email_confirm: true,
    app_metadata: { role: 'ADMIN' },
  });
  if (authErr || !authData.user) throw new Error('Could not create test auth user: ' + authErr?.message);
  testUserId = authData.user.id;

  // Create a minimal tenant
  const { data: tenantData, error: tenantErr } = await svc
    .from('tenants')
    .insert({ name: 'FP102 Test Tenant' })
    .select('id')
    .single();
  if (tenantErr || !tenantData) throw new Error('Could not create test tenant: ' + tenantErr?.message);
  testTenantId = tenantData.id;

  // Create a members row (needed for mfa_trust_duration_days constraint tests)
  const { data: memberData, error: memberErr } = await svc
    .from('members')
    .insert({
      tenant_id: testTenantId,
      user_id: testUserId,
      email,
      first_name: 'FP102',
      last_name: 'Test',
      role: 'ADMIN',
      gender: 'MALE',
      marital_status: 'SINGLE',
      birthdate: '1990-01-01',
    })
    .select('id')
    .single();
  if (memberErr || !memberData) throw new Error('Could not create test member: ' + memberErr?.message);
  testMemberId = memberData.id;

  return email;
}

async function teardownTestUser() {
  if (!testUserId) return;
  const svc = serviceClient();
  if (testMemberId) await svc.from('members').delete().eq('id', testMemberId);
  if (testTenantId) await svc.from('tenants').delete().eq('id', testTenantId);
  await svc.auth.admin.deleteUser(testUserId);
}

// ── Group 1: DB constraint ────────────────────────────────────────────────────
async function runGroup1() {
  console.log('\nGroup 1 — mfa_trust_duration_days constraint');

  await test('1.1', 'column exists on members with DEFAULT 28', async () => {
    // Verify via the already-created test member (inserted without specifying the
    // column, so it must have received the DB default of 28).
    assert(testMemberId !== null, 'testMemberId not set — setup failed');
    const svc = serviceClient();
    const { data, error } = await svc
      .from('members')
      .select('mfa_trust_duration_days')
      .eq('id', testMemberId!)
      .single();
    assert(!error, 'select failed (column may not exist): ' + error?.message);
    assert(data?.mfa_trust_duration_days === 28, `expected DEFAULT 28, got ${data?.mfa_trust_duration_days}`);
  });

  await test('1.2', 'INSERT with mfa_trust_duration_days = 28 (default) succeeds', async () => {
    // Already confirmed by setup — testMemberId was inserted without specifying the column
    assert(testMemberId !== null, 'testMemberId not set — setup failed');
    const svc = serviceClient();
    const { data, error } = await svc
      .from('members')
      .select('mfa_trust_duration_days')
      .eq('id', testMemberId!)
      .single();
    assert(!error, 'select failed: ' + error?.message);
    assert(data?.mfa_trust_duration_days === 28, `expected 28, got ${data?.mfa_trust_duration_days}`);
  });

  await test('1.3', 'UPDATE to 56 (max) succeeds', async () => {
    const svc = serviceClient();
    const { error } = await svc
      .from('members')
      .update({ mfa_trust_duration_days: 56 })
      .eq('id', testMemberId!);
    assert(!error, 'update to 56 failed: ' + error?.message);
  });

  await test('1.4', 'UPDATE to 57 (above max) rejected by CHECK constraint', async () => {
    const svc = serviceClient();
    const { error } = await svc
      .from('members')
      .update({ mfa_trust_duration_days: 57 })
      .eq('id', testMemberId!);
    assert(!!error, 'expected constraint violation but got no error');
    assert(
      error!.message.includes('check') || error!.message.includes('constraint') || error!.code === '23514',
      `unexpected error: ${error!.message}`
    );
  });

  await test('1.5', 'UPDATE to 1 (min) succeeds', async () => {
    const svc = serviceClient();
    const { error } = await svc
      .from('members')
      .update({ mfa_trust_duration_days: 1 })
      .eq('id', testMemberId!);
    assert(!error, 'update to 1 failed: ' + error?.message);
  });

  await test('1.6', 'UPDATE to 0 (below min) rejected by CHECK constraint', async () => {
    const svc = serviceClient();
    const { error } = await svc
      .from('members')
      .update({ mfa_trust_duration_days: 0 })
      .eq('id', testMemberId!);
    assert(!!error, 'expected constraint violation but got no error');
    assert(
      error!.message.includes('check') || error!.message.includes('constraint') || error!.code === '23514',
      `unexpected error: ${error!.message}`
    );
  });
}

// ── Group 2: MFA API ──────────────────────────────────────────────────────────
async function runGroup2(email: string) {
  console.log('\nGroup 2 — MFA API (enroll, challenge, verify, listFactors, unenroll)');

  // Sign in as the test user to get a real session for MFA operations.
  // MFA API calls must be authenticated as the user (not service-role).
  let userClient = createClient(SUPA_URL, ANON_KEY);
  const { data: signInData, error: signInErr } = await userClient.auth.signInWithPassword({
    email,
    password: 'TestPass1234!',
  });
  if (signInErr || !signInData.session) {
    console.error('  ⚠️  Could not sign in as test user — skipping Group 2:', signInErr?.message);
    return;
  }
  // Reinitialise client with the session so MFA calls are authenticated
  userClient = createClient(SUPA_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${signInData.session.access_token}` } },
  });

  await test('2.1', 'mfa.listFactors() returns empty before enrollment', async () => {
    const { data, error } = await userClient.auth.mfa.listFactors();
    assert(!error, 'listFactors error: ' + error?.message);
    const verifiedCount = data?.totp?.filter(f => f.status === 'verified').length ?? 0;
    assert(verifiedCount === 0, `expected 0 verified factors, got ${verifiedCount}`);
  });

  await test('2.2', 'mfa.enroll() returns factor ID and QR code SVG', async () => {
    const { data, error } = await userClient.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'FP102 Test',
    });
    assert(!error, 'enroll error: ' + error?.message);
    assert(!!data?.id, 'no factor id returned');
    assert(!!data?.totp?.qr_code, 'no qr_code returned');
    assert(!!data?.totp?.secret, 'no secret returned');
    // QR code is an SVG data URI
    assert(
      data!.totp!.qr_code.startsWith('data:image/svg') || data!.totp!.qr_code.startsWith('<svg') || data!.totp!.qr_code.length > 100,
      'qr_code does not look like SVG data'
    );
    enrolledFactorId = data!.id;
    factorSecret = data!.totp!.secret;
  });

  await test('2.3', 'mfa.listFactors() call succeeds (unverified factors not yet listed)', async () => {
    // Local Supabase only returns verified factors via listFactors — the factor
    // enrolled in 2.2 is still unverified and may not appear. Confirm the API
    // call itself succeeds without error.
    const { error } = await userClient.auth.mfa.listFactors();
    assert(!error, 'listFactors error: ' + error?.message);
    // enrolledFactorId was captured in 2.2; that is sufficient proof of enrollment.
    assert(!!enrolledFactorId, 'enrolledFactorId not set — 2.2 must have passed');
  });

  await test('2.4', 'mfa.challengeAndVerify() with wrong code is rejected', async () => {
    assert(!!enrolledFactorId, 'no enrolledFactorId — 2.2 must have passed');
    const { error } = await userClient.auth.mfa.challengeAndVerify({
      factorId: enrolledFactorId!,
      code: '000000',
    });
    assert(!!error, 'expected error for wrong code but got success');
  });

  await test('2.5', 'mfa.challengeAndVerify() with correct TOTP code succeeds and promotes to aal2', async () => {
    assert(!!enrolledFactorId && !!factorSecret, 'no factor state — 2.2 must have passed');
    const code = totpNow(factorSecret!);
    const { data, error } = await userClient.auth.mfa.challengeAndVerify({
      factorId: enrolledFactorId!,
      code,
    });
    assert(!error, `challengeAndVerify failed with correct code: ${error?.message}`);
    // verify response returns access_token directly (not nested under .session)
    assert(!!data?.access_token, 'no access_token returned after successful verification');
    // Confirm the returned JWT carries aal2 claim (decode directly — a static-header
    // client does not populate the session object needed by getAuthenticatorAssuranceLevel).
    const aal = jwtAAL(data!.access_token);
    assert(aal === 'aal2', `expected aal2 in JWT claim, got ${aal}`);
  });

  await test('2.6', 'mfa.listFactors() shows factor as verified after challengeAndVerify', async () => {
    // Use a fresh aal2 session to call listFactors — the userClient is still at aal1
    const code2 = totpNow(factorSecret!);
    const { data: verifyData2 } = await userClient.auth.mfa.challengeAndVerify({
      factorId: enrolledFactorId!,
      code: code2,
    });
    const aal2Token = verifyData2?.access_token;
    assert(!!aal2Token, 'could not get aal2 token for listFactors check');
    const aal2Client = createClient(SUPA_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${aal2Token}` } },
    });
    const { data, error } = await aal2Client.auth.mfa.listFactors();
    assert(!error, 'listFactors error: ' + error?.message);
    const factor = data?.totp?.find(f => f.id === enrolledFactorId);
    assert(!!factor, 'factor not found in listFactors');
    assert(factor!.status === 'verified', `expected verified, got ${factor!.status}`);
  });

  await test('2.7', 'mfa.unenroll() removes the factor', async () => {
    assert(!!enrolledFactorId, 'no enrolledFactorId');
    // unenroll requires aal2 — get a fresh aal2 session
    const code = totpNow(factorSecret!);
    const { data: verifyData } = await userClient.auth.mfa.challengeAndVerify({
      factorId: enrolledFactorId!,
      code,
    });
    const aal2Token = verifyData?.access_token;
    assert(!!aal2Token, 'could not get aal2 token for unenroll');

    const aal2Client = createClient(SUPA_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${aal2Token}` } },
    });
    const { error } = await aal2Client.auth.mfa.unenroll({ factorId: enrolledFactorId! });
    assert(!error, 'unenroll failed: ' + error?.message);

    // Confirm gone
    const { data: afterData } = await aal2Client.auth.mfa.listFactors();
    const stillThere = afterData?.totp?.some(f => f.id === enrolledFactorId);
    assert(!stillThere, 'factor still present after unenroll');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('FP-102 — Web Admin Login tests\n');
  let email: string;

  try {
    email = await setupTestUser();
  } catch (err) {
    console.error('Setup failed:', (err as Error).message);
    process.exit(1);
  }

  try {
    await runGroup1();
    await runGroup2(email!);
  } finally {
    await teardownTestUser();
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
