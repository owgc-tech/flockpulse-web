/**
 * FP-101 founder self-registration verification.
 *
 * GROUP 1 — Migration / schema
 *   1.1  create_tenant_and_founding_admin() function exists
 *   1.2  Unauthenticated caller (anon key, no JWT) → blocked
 *   1.3  Calling as a valid founder (with description) creates tenant + member rows;
 *        description stored correctly in tenants
 *   1.4  Calling again with the same Auth user raises 'already registered'
 *   1.5  attendance_window_hours on the created tenant = 24 (column default applied,
 *        not hardcoded — neither screen exposes attendance_window_hours in the UI)
 *   1.6  Both audit log entries present (entity_type=tenant/member, action=create/register)
 *        with correct actor_id and non-null after_value
 *   1.7  NULL description accepted cleanly (founder leaves it blank — no constraint violation)
 *
 * GROUP 2 — createTenantAndFoundingAdmin() service layer
 *   2.1  Happy path with description: tenant + member rows exist, description stored,
 *        app_metadata set correctly (tenant_id, role='ADMIN', member_id — verified via
 *        getUserById, not just "no error")
 *   2.2  Duplicate call (same Auth user) → ALREADY_REGISTERED error code
 *   2.3  Path B (hash-token arrival): session established via setSession() with real
 *        access_token/refresh_token tokens (simulating email-confirmation-link delivery)
 *        → createTenantAndFoundingAdmin() succeeds with that session token
 *
 * GROUP 3 — Regression
 *   3.1  inviteMember() (FP-54 path) still works after this DIP's changes
 *
 * GROUP 4 — DIP-FP-105: widened marital_status
 *   4.1  Widowed founder registration succeeds (previously a CHECK constraint failure)
 *   4.2  Divorced founder registration succeeds (previously a CHECK constraint failure)
 *   4.3  Separated founder registration succeeds (previously a CHECK constraint failure)
 *
 * Run: npx tsx scripts/test-fp101-founder-registration.ts
 * Requires local Supabase running.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

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
function psqlQueryJson(sql: string): unknown {
  const raw = psqlQuery(sql);
  return raw ? JSON.parse(raw) : null;
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function anonClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}

function founderClient(accessToken: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  );
}

async function createTestFounder(email: string): Promise<{ authId: string; token: string }> {
  const db = serviceClient();
  const { data: created } = await db.auth.admin.createUser({
    email,
    password: 'Test1234!FP101',
    email_confirm: true,
  });
  const authId = created?.user?.id;
  if (!authId) throw new Error(`Failed to create auth user for ${email}`);
  const { data: sess } = await anonClient().auth.signInWithPassword({
    email,
    password: 'Test1234!FP101',
  });
  const token = sess?.session?.access_token;
  if (!token) throw new Error(`Failed to sign in as ${email}`);
  return { authId, token };
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

async function cleanupAuthUsers(emailPrefix: string) {
  const db = serviceClient();
  const { data } = await db.auth.admin.listUsers({ perPage: 200 });
  for (const u of (data?.users ?? []).filter(u => u.email?.startsWith(emailPrefix))) {
    await db.auth.admin.deleteUser(u.id);
  }
}

const createdTenantIds: string[] = [];

async function main() {
  const db = serviceClient();

  // ── GROUP 1: Migration / schema ───────────────────────────────────────────

  console.log('\n── GROUP 1: Migration / schema ──');

  console.log('\n1.1: create_tenant_and_founding_admin() function exists');
  try {
    const exists = psqlQuery(
      `SELECT COUNT(*) FROM pg_proc WHERE proname = 'create_tenant_and_founding_admin' AND pronamespace = 'public'::regnamespace`
    );
    parseInt(exists) === 1
      ? pass('1.1 function exists', 'function present in public schema')
      : fail('1.1 function exists', `count=${exists}`);
  } catch (e) { fail('1.1 function exists', (e as Error).message); }

  console.log('\n1.2: Unauthenticated caller (anon key, no JWT) → blocked');
  try {
    const { error } = await anonClient().rpc('create_tenant_and_founding_admin', {
      p_community_name: 'Anon Attempt', p_description: null,
      p_first_name: 'A', p_last_name: 'B',
      p_gender: 'MALE', p_marital_status: 'SINGLE', p_birthdate: '1990-01-01',
    });
    // PGRST301 = PostgREST JWT rejection; 42501 = Postgres permission denied.
    const blocked = !!error && (
      error.message.toLowerCase().includes('permission') ||
      error.code === '42501' || error.code === 'PGRST301'
    );
    blocked
      ? pass('1.2 anon blocked', `code=${error!.code}: ${error!.message}`)
      : fail('1.2 anon blocked', error ? `unexpected error: ${error.message}` : 'no error — allowed');
  } catch (e) { fail('1.2 anon blocked', (e as Error).message); }

  // ── Tests 1.3–1.6: use a single founder auth user ──
  let g1Token: string | null = null;
  let g1TenantId: string | null = null;
  let g1MemberId: string | null = null;

  try {
    const f = await createTestFounder('fp101-g1founder@t.com');
    g1Token = f.token;
  } catch (e) {
    ['1.3 happy path', '1.4 duplicate blocked', '1.5 attendance default', '1.6 audit logs']
      .forEach(n => fail(n, `Setup failed: ${(e as Error).message}`));
  }

  console.log('\n1.3: Happy path with description — creates tenant + member; description stored');
  if (g1Token) {
    try {
      const { data: rows, error } = await founderClient(g1Token).rpc('create_tenant_and_founding_admin', {
        p_community_name: 'SQL Test Community',
        p_description:    'A community for testing description storage',
        p_first_name: 'Founder', p_last_name: 'One',
        p_gender: 'MALE', p_marital_status: 'SINGLE', p_birthdate: '1990-01-01',
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(rows) ? rows[0] : rows) as { tenant_id: string; member_id: string };
      g1TenantId = row.tenant_id;
      g1MemberId = row.member_id;
      createdTenantIds.push(g1TenantId);
      const memberRole = psqlQuery(`SELECT role FROM members WHERE id = '${g1MemberId}'`);
      const storedDesc = psqlQuery(`SELECT description FROM tenants WHERE id = '${g1TenantId}'`);
      if (parseInt(psqlQuery(`SELECT COUNT(*) FROM tenants WHERE id = '${g1TenantId}'`)) === 1 &&
          memberRole === 'ADMIN' &&
          storedDesc === 'A community for testing description storage') {
        pass('1.3 happy path', `tenant_id=${g1TenantId}, role=${memberRole}, description="${storedDesc}"`);
      } else {
        fail('1.3 happy path', `role=${memberRole}, description="${storedDesc}"`);
      }
    } catch (e) { fail('1.3 happy path', (e as Error).message); }
  }

  console.log('\n1.4: Duplicate call with same Auth user → already registered');
  if (g1Token && g1TenantId) {
    try {
      const { error } = await founderClient(g1Token).rpc('create_tenant_and_founding_admin', {
        p_community_name: 'Second Attempt', p_description: null,
        p_first_name: 'Founder', p_last_name: 'One',
        p_gender: 'MALE', p_marital_status: 'SINGLE', p_birthdate: '1990-01-01',
      });
      error?.message.includes('already registered')
        ? pass('1.4 duplicate blocked', `error: ${error.message}`)
        : fail('1.4 duplicate blocked', error ? `wrong error: ${error.message}` : 'no error thrown');
    } catch (e) { fail('1.4 duplicate blocked', (e as Error).message); }
  }

  console.log('\n1.5: attendance_window_hours = 24 (column default; not exposed in any screen UI)');
  if (g1TenantId) {
    try {
      const hours = psqlQuery(`SELECT attendance_window_hours FROM tenants WHERE id = '${g1TenantId}'`);
      parseInt(hours) === 24
        ? pass('1.5 attendance default', `attendance_window_hours=${hours}`)
        : fail('1.5 attendance default', `attendance_window_hours=${hours}`);
    } catch (e) { fail('1.5 attendance default', (e as Error).message); }
  }

  console.log('\n1.6: Both audit log entries present (tenant create + member register)');
  if (g1TenantId && g1MemberId) {
    try {
      const tenantAudit = psqlQueryJson(`
        SELECT row_to_json(a) FROM audit_logs a
        WHERE entity_type = 'tenant' AND entity_id = '${g1TenantId}' AND action = 'create'
      `) as Record<string, unknown> | null;
      const memberAudit = psqlQueryJson(`
        SELECT row_to_json(a) FROM audit_logs a
        WHERE entity_type = 'member' AND entity_id = '${g1MemberId}' AND action = 'register'
      `) as Record<string, unknown> | null;
      const tenantOk = !!tenantAudit && tenantAudit['actor_id'] === g1MemberId &&
        tenantAudit['before_value'] === null && tenantAudit['after_value'] !== null;
      const memberOk = !!memberAudit && memberAudit['actor_id'] === g1MemberId &&
        memberAudit['before_value'] === null && memberAudit['after_value'] !== null;
      tenantOk && memberOk
        ? pass('1.6 audit logs', `tenant actor=${tenantAudit!['actor_id']}, member actor=${memberAudit!['actor_id']}`)
        : fail('1.6 audit logs', `tenantOk=${tenantOk}, memberOk=${memberOk}`);
    } catch (e) { fail('1.6 audit logs', (e as Error).message); }
  }

  console.log('\n1.7: NULL description accepted cleanly (founder leaves it blank)');
  try {
    const f = await createTestFounder('fp101-g1-nodesc@t.com');
    const { data: rows, error } = await founderClient(f.token).rpc('create_tenant_and_founding_admin', {
      p_community_name: 'No-Desc Community', p_description: null,
      p_first_name: 'No', p_last_name: 'Desc',
      p_gender: 'FEMALE', p_marital_status: 'MARRIED', p_birthdate: '1985-03-10',
    });
    if (error) throw new Error(error.message);
    const row = (Array.isArray(rows) ? rows[0] : rows) as { tenant_id: string; member_id: string };
    createdTenantIds.push(row.tenant_id);
    const storedDesc = psqlQuery(`SELECT COALESCE(description, 'NULL') FROM tenants WHERE id = '${row.tenant_id}'`);
    storedDesc === 'NULL'
      ? pass('1.7 null description', `description IS NULL in DB as expected`)
      : fail('1.7 null description', `description="${storedDesc}"`);
  } catch (e) { fail('1.7 null description', (e as Error).message); }

  // ── GROUP 2: createTenantAndFoundingAdmin() service layer ─────────────────

  console.log('\n── GROUP 2: createTenantAndFoundingAdmin() service layer ──');

  const { createTenantAndFoundingAdmin } = await import(
    '../src/features/founder-registration/founder-registration.service'
  );

  let g2FounderAuthId: string | null = null;
  let g2FounderToken: string | null = null;
  let svcResult: { tenantId: string; memberId: string } | null = null;

  try {
    const f = await createTestFounder('fp101-svc-founder@t.com');
    g2FounderAuthId = f.authId;
    g2FounderToken = f.token;
  } catch (e) {
    ['2.1 service happy path', '2.2 duplicate error code']
      .forEach(n => fail(n, `Setup failed: ${(e as Error).message}`));
  }

  console.log('\n2.1: Happy path with description — app_metadata verified via getUserById');
  if (g2FounderToken && g2FounderAuthId) {
    try {
      svcResult = await createTenantAndFoundingAdmin(g2FounderToken, {
        communityName: 'Service Test Community',
        description: 'We meet every Sunday at 9am.',
        firstName: 'Svc', lastName: 'Founder',
        gender: 'FEMALE', maritalStatus: 'SINGLE', birthdate: '1992-06-15',
      });
      createdTenantIds.push(svcResult.tenantId);
      const memberRole = psqlQuery(`SELECT role FROM members WHERE id = '${svcResult.memberId}'`);
      const storedDesc = psqlQuery(`SELECT description FROM tenants WHERE id = '${svcResult.tenantId}'`);
      const { data: userInfo } = await db.auth.admin.getUserById(g2FounderAuthId);
      const meta = userInfo?.user?.app_metadata ?? {};
      const metaOk = meta['tenant_id'] === svcResult.tenantId &&
        meta['role'] === 'ADMIN' && meta['member_id'] === svcResult.memberId;
      metaOk && memberRole === 'ADMIN' && storedDesc === 'We meet every Sunday at 9am.'
        ? pass('2.1 service happy path', `role=${memberRole}, description="${storedDesc}", meta.role=${meta['role']}, meta.tenant_id=${meta['tenant_id']}`)
        : fail('2.1 service happy path', `role=${memberRole}, desc="${storedDesc}", metaOk=${metaOk}, meta=${JSON.stringify(meta)}`);
    } catch (e) { fail('2.1 service happy path', (e as Error).message); }
  }

  console.log('\n2.2: Duplicate call → ALREADY_REGISTERED error code');
  if (g2FounderToken) {
    try {
      await createTenantAndFoundingAdmin(g2FounderToken, {
        communityName: 'Second Community', description: null,
        firstName: 'Svc', lastName: 'Founder',
        gender: 'FEMALE', maritalStatus: 'SINGLE', birthdate: '1992-06-15',
      });
      fail('2.2 duplicate error code', 'no error thrown');
    } catch (e) {
      const code = (e as { code?: string }).code;
      code === 'ALREADY_REGISTERED'
        ? pass('2.2 duplicate error code', `code=${code}, msg=${(e as Error).message}`)
        : fail('2.2 duplicate error code', `code=${code}, msg=${(e as Error).message}`);
    }
  }

  console.log('\n2.3: Path B (hash-token arrival) — session via setSession() → service call succeeds');
  // Simulates what Screen 2 does when the founder arrives via an email confirmation link:
  // tokens are delivered in the URL hash and setSession() is called to establish the session
  // before calling createTenantAndFoundingAdmin(). We can't simulate the URL hash in Node,
  // but we can simulate the exact sequence: create fresh tokens → call setSession() → use
  // the resulting access_token in the service call.
  try {
    const pathBFounderEmail = 'fp101-pathb-founder@t.com';
    const { data: created } = await db.auth.admin.createUser({
      email: pathBFounderEmail, password: 'Test1234!FP101', email_confirm: true,
    });
    const pathBAuthId = created?.user?.id;
    if (!pathBAuthId) throw new Error('Failed to create auth user for Path B test');

    // Sign in to get a real access_token + refresh_token pair (simulating what the
    // email confirmation link would deliver as URL hash tokens on fpdb-dev).
    const { data: initialSess } = await anonClient().auth.signInWithPassword({
      email: pathBFounderEmail, password: 'Test1234!FP101',
    });
    const hashAccessToken = initialSess?.session?.access_token;
    const hashRefreshToken = initialSess?.session?.refresh_token;
    if (!hashAccessToken || !hashRefreshToken) throw new Error('Could not obtain Path B tokens');

    // Create a fresh client (no pre-existing session), then call setSession() with the
    // hash-delivered tokens — same code path as Screen 2's Path B useEffect.
    const freshClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: sessionData, error: sessionError } = await freshClient.auth.setSession({
      access_token: hashAccessToken,
      refresh_token: hashRefreshToken,
    });
    if (sessionError || !sessionData.session) {
      throw new Error(`setSession() failed: ${sessionError?.message}`);
    }
    const postSetSessionToken = sessionData.session.access_token;

    // Now call the service with the token obtained via setSession — this is what
    // Screen 2 does after Path B's useEffect resolves.
    const pathBResult = await createTenantAndFoundingAdmin(postSetSessionToken, {
      communityName: 'Path B Community', description: 'Via email link',
      firstName: 'Path', lastName: 'B',
      gender: 'MALE', maritalStatus: 'SINGLE', birthdate: '1991-09-20',
    });
    createdTenantIds.push(pathBResult.tenantId);
    const memberRole = psqlQuery(`SELECT role FROM members WHERE id = '${pathBResult.memberId}'`);
    const { data: userInfo } = await db.auth.admin.getUserById(pathBAuthId);
    const meta = userInfo?.user?.app_metadata ?? {};
    const metaOk = meta['tenant_id'] === pathBResult.tenantId &&
      meta['role'] === 'ADMIN' && meta['member_id'] === pathBResult.memberId;
    metaOk && memberRole === 'ADMIN'
      ? pass('2.3 Path B hash-token', `setSession succeeded, role=${memberRole}, meta.role=${meta['role']}, tenant_id=${pathBResult.tenantId}`)
      : fail('2.3 Path B hash-token', `role=${memberRole}, metaOk=${metaOk}, meta=${JSON.stringify(meta)}`);
  } catch (e) { fail('2.3 Path B hash-token', (e as Error).message); }

  // ── GROUP 3: Regression ───────────────────────────────────────────────────

  console.log('\n── GROUP 3: Regression ──');

  console.log('\n3.1: inviteMember() (FP-54 path) still works after this DIP\'s changes');
  try {
    const regTenantId = psqlQuery(`SELECT gen_random_uuid()`);
    const regAdminId = psqlQuery(`SELECT gen_random_uuid()`);
    const regAdminUserId = psqlQuery(`SELECT gen_random_uuid()`);
    psql(`
      INSERT INTO tenants (id, name) VALUES ('${regTenantId}', 'Regression Tenant FP101') ON CONFLICT DO NOTHING;
      INSERT INTO members (id, tenant_id, user_id, email, role, first_name, last_name, gender, marital_status, birthdate)
      VALUES ('${regAdminId}', '${regTenantId}', '${regAdminUserId}', 'fp101-regadmin@t.com', 'ADMIN', 'Reg', 'Admin', 'MALE', 'SINGLE', '1980-01-01')
      ON CONFLICT DO NOTHING;
    `);
    const { inviteMember } = await import('../src/features/invitations/invitation.service');
    const inv = await inviteMember(regTenantId, regAdminId, { email: 'fp101-reg-invitee@t.com', role: 'MEMBER' });
    if (inv.id && inv.status === 'PENDING') {
      pass('3.1 FP-54 regression', `invitation id=${inv.id}, status=${inv.status}`);
    } else {
      fail('3.1 FP-54 regression', JSON.stringify(inv));
    }
    await db.auth.admin.deleteUser(inv.auth_user_id);
    psql(`
      DELETE FROM audit_logs WHERE tenant_id = '${regTenantId}';
      DELETE FROM invitations WHERE tenant_id = '${regTenantId}';
      DELETE FROM members WHERE tenant_id = '${regTenantId}';
      DELETE FROM tenants WHERE id = '${regTenantId}';
    `);
  } catch (e) { fail('3.1 FP-54 regression', (e as Error).message); }

  // ── GROUP 4: DIP-FP-105 — widened marital_status ──────────────────────────

  console.log('\n── GROUP 4: DIP-FP-105 — widened marital_status ──');

  const widenedStatuses: Array<{ label: string; value: string; email: string }> = [
    { label: '4.1 Widowed',   value: 'WIDOWED',   email: 'fp101-widowed@t.com' },
    { label: '4.2 Divorced',  value: 'DIVORCED',  email: 'fp101-divorced@t.com' },
    { label: '4.3 Separated', value: 'SEPARATED', email: 'fp101-separated@t.com' },
  ];

  for (const { label, value, email } of widenedStatuses) {
    console.log(`\n${label}: founder registration with marital_status=${value} succeeds`);
    try {
      const f = await createTestFounder(email);
      const result = await createTenantAndFoundingAdmin(f.token, {
        communityName: `${value} Community`, description: null,
        firstName: 'Test', lastName: value,
        gender: 'FEMALE', maritalStatus: value, birthdate: '1988-04-12',
      });
      createdTenantIds.push(result.tenantId);
      const storedStatus = psqlQuery(`SELECT marital_status FROM members WHERE id = '${result.memberId}'`);
      storedStatus === value
        ? pass(label, `marital_status stored as ${storedStatus}`)
        : fail(label, `expected ${value}, got ${storedStatus}`);
    } catch (e) { fail(label, (e as Error).message); }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  console.log('\nCleaning up Auth users and DB fixtures...');
  await cleanupAuthUsers('fp101-');
  for (const tid of createdTenantIds) {
    psql(`
      DELETE FROM audit_logs WHERE tenant_id = '${tid}';
      DELETE FROM members WHERE tenant_id = '${tid}';
      DELETE FROM tenants WHERE id = '${tid}';
    `);
  }

  const passed = results.filter(r => r.passed).length;
  console.log(`\n${passed}/${results.length} tests passed`);
  if (passed < results.length) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
