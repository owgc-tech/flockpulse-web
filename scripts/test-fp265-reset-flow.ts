/**
 * FP-265 reset-flow tests.
 * Part A: pure helper cases (no network).
 * Part B: local Supabase only (assertLocalDb) — the verifyOtp -> admin.updateUserById -> global
 *   signOut sequence the Server Action performs, plus the sign-in checks, for an account WITH an
 *   MFA factor (verified TOTP row inserted into the LOCAL auth.mfa_factors via docker exec psql)
 *   and one without (FP-265 adj-1: updateUser at aal1 is refused with insufficient_aal for MFA users).
 * NOT covered: a Server Action cannot be invoked from a plain script, so cookies, redirect() and
 * the pages are covered by the manual browser walk-through, not here.
 * Run with local values: NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY from `supabase status -o env`.
 */
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { assertLocalDb } from './lib/assert-local-db';
import {
  parseResetCredential,
  resetDoneVariant,
  validateNewPassword,
} from '../src/features/auth/reset-password';
import { isFromApp, APP_RETURN_URL } from '../src/features/auth/reset-from-app';

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------- Part A ----------
check('token_hash + recovery', eq(parseResetCredential({ token_hash: 'abc', type: 'recovery' }), { kind: 'token_hash', tokenHash: 'abc' }));
check('token_hash trimmed', eq(parseResetCredential({ token_hash: '  abc ', type: 'recovery' }), { kind: 'token_hash', tokenHash: 'abc' }));
check('token_hash wrong type -> null', parseResetCredential({ token_hash: 'abc', type: 'signup' }) === null);
check('token_hash missing type -> null', parseResetCredential({ token_hash: 'abc' }) === null);
check('wrong type falls back to code', eq(parseResetCredential({ token_hash: 'abc', type: 'signup', code: 'c-1_x' }), { kind: 'code', code: 'c-1_x' }));
check('missing type falls back to code', eq(parseResetCredential({ token_hash: 'abc', code: 'c1' }), { kind: 'code', code: 'c1' }));
check('both present -> token_hash wins', eq(parseResetCredential({ token_hash: 'abc', type: 'recovery', code: 'c1' }), { kind: 'token_hash', tokenHash: 'abc' }));
check('code only', eq(parseResetCredential({ code: '5bbdbae7-f21e-4973-bdcf-4b50c369d447' }), { kind: 'code', code: '5bbdbae7-f21e-4973-bdcf-4b50c369d447' }));
check('empty -> null', parseResetCredential({}) === null);
check('empty strings -> null', parseResetCredential({ token_hash: '', type: 'recovery', code: '' }) === null);
check('whitespace -> null', parseResetCredential({ token_hash: '   ', type: 'recovery', code: '  ' }) === null);
check('token_hash 512 ok', parseResetCredential({ token_hash: 'a'.repeat(512), type: 'recovery' })?.kind === 'token_hash');
check('token_hash 513 -> null', parseResetCredential({ token_hash: 'a'.repeat(513), type: 'recovery' }) === null);
check('code 200 ok', parseResetCredential({ code: 'a'.repeat(200) })?.kind === 'code');
check('code 201 -> null', parseResetCredential({ code: 'a'.repeat(201) }) === null);
check('code bad chars -> null', parseResetCredential({ code: 'ab cd' }) === null && parseResetCredential({ code: 'ab/cd' }) === null && parseResetCredential({ code: '<x>' }) === null);
check('oversize token_hash falls back to valid code', eq(parseResetCredential({ token_hash: 'a'.repeat(513), type: 'recovery', code: 'ok1' }), { kind: 'code', code: 'ok1' }));

check('password too short', validateNewPassword('short', 'short') === 'Password must be at least 8 characters.');
check('password empty/null/undefined', validateNewPassword('', '') !== null && validateNewPassword(null, null) !== null && validateNewPassword(undefined, undefined) !== null);
check('password mismatch', validateNewPassword('longenough1', 'longenough2') === 'Passwords do not match.');
check('password valid', validateNewPassword('longenough1', 'longenough1') === null);

for (const r of ['ADMIN', 'LEADER', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT', 'PASTORAL_LEADER']) {
  check(`variant ${r} -> leader`, resetDoneVariant(r) === 'leader');
}
check('variant MEMBER -> member', resetDoneVariant('MEMBER') === 'member');
check('variant undefined -> member', resetDoneVariant(undefined) === 'member');
check('variant garbage -> member', resetDoneVariant('garbage') === 'member' && resetDoneVariant('') === 'member' && resetDoneVariant('toString') === 'member');

check("isFromApp 'app' true", isFromApp('app') === true);
check('isFromApp other values false', ['App', 'APP', '', 'web', ' app'].every((v) => isFromApp(v) === false));
check('isFromApp undefined false', isFromApp(undefined) === false);
check("isFromApp ['app'] (array) false", isFromApp(['app']) === false && isFromApp(['app', 'app']) === false && isFromApp([]) === false);
check('APP_RETURN_URL', APP_RETURN_URL === 'flockpulse://');

// ---------- Part B ----------
function psql(sql: string) {
  const r = spawnSync(
    'docker',
    ['exec', '-i', 'supabase_db_flockpulse-web', 'psql', '-U', 'postgres', '-d', 'postgres', '--set', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error('psql failed: ' + r.stderr);
}

async function flow(label: string, withMfa: boolean) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `fp265-flow-${withMfa ? 'mfa' : 'plain'}-${Date.now()}@example.test`;
  const OLD = 'OldPassw0rd!', NEW = 'NewPassw0rd!2';
  const anonClient = () => createClient(url, anon, { auth: { persistSession: false } });

  const { data: created, error: cErr } = await svc.auth.admin.createUser({ email, password: OLD, email_confirm: true, app_metadata: { role: withMfa ? 'LEADER' : 'MEMBER' } });
  if (cErr || !created.user) throw new Error('createUser failed');
  const userId = created.user.id;
  try {
    if (withMfa) {
      psql(`insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
            values (gen_random_uuid(), '${userId}', 'FlockPulse Admin', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP');`);
    }
    const link = async () => {
      const { data, error } = await svc.auth.admin.generateLink({ type: 'recovery', email });
      if (error || !data.properties?.hashed_token) throw new Error('generateLink failed');
      return data.properties.hashed_token;
    };

    // another session for the same user, to prove the global sign-out
    const other = anonClient();
    const { data: otherSignIn } = await other.auth.signInWithPassword({ email, password: OLD });
    const otherRefresh = otherSignIn.session!.refresh_token;

    // wrong type is refused (and does not break a later correct use)
    const hash1 = await link();
    const wrongType = await anonClient().auth.verifyOtp({ token_hash: hash1, type: 'signup' });
    check(`B[${label}]: wrong type refused`, !!wrongType.error);

    // the action's sequence
    const c = anonClient();
    const v = await c.auth.verifyOtp({ token_hash: hash1, type: 'recovery' });
    check(`B[${label}]: verifyOtp recovery ok`, !v.error && !!v.data.session);
    const { data: { session } } = await c.auth.getSession();
    check(`B[${label}]: session present after verify`, !!session);

    // The user's own aal1 session: refused for MFA accounts, allowed otherwise (this is why the action uses admin).
    const own = await c.auth.updateUser({ password: NEW });
    if (withMfa) {
      check(`B[${label}]: own aal1 updateUser refused with 401 insufficient_aal`, own.error?.status === 401 && own.error?.code === 'insufficient_aal');
    } else {
      check(`B[${label}]: own aal1 updateUser allowed (no MFA)`, !own.error);
      await svc.auth.admin.updateUserById(userId, { password: OLD }); // put back so the admin step is the one under test
    }

    const upd = await svc.auth.admin.updateUserById(session!.user.id, { password: NEW });
    check(`B[${label}]: admin updateUserById ok`, !upd.error);
    // The action then calls admin.signOut(..., 'global') and ignores its result. Observed on the local
    // GoTrue: the admin password change already revokes every session, so this call returns 400
    // "Auth session missing". Either way no session may survive, which is what is asserted below.
    const so = await svc.auth.admin.signOut(session!.access_token, 'global');
    check(`B[${label}]: global signOut ok or session already revoked`, !so.error || so.error.message.includes('session missing'));
    check(
      `B[${label}]: reset-link session refresh token refused`,
      !!(await anonClient().auth.refreshSession({ refresh_token: session!.refresh_token })).error,
    );

    const nb = anonClient();
    const signIn = await nb.auth.signInWithPassword({ email, password: NEW });
    check(`B[${label}]: new password signs in`, !signIn.error);
    const aal = await nb.auth.mfa.getAuthenticatorAssuranceLevel();
    check(
      `B[${label}]: sign-in assurance (MFA account needs aal2 next, plain account does not)`,
      withMfa ? aal.data?.currentLevel === 'aal1' && aal.data?.nextLevel === 'aal2' : aal.data?.nextLevel === 'aal1',
    );
    check(`B[${label}]: old password refused`, !!(await anonClient().auth.signInWithPassword({ email, password: OLD })).error);
    const refreshed = await anonClient().auth.refreshSession({ refresh_token: otherRefresh });
    check(`B[${label}]: other session signed out`, !!refreshed.error);
    const reuse = await anonClient().auth.verifyOtp({ token_hash: hash1, type: 'recovery' });
    check(`B[${label}]: second use of same hashed_token refused`, !!reuse.error);

    // Same password through the admin API: Supabase accepts it (no error, so no 'same_password' code
    // on this path). Recorded here so a future Supabase change that starts rejecting it is noticed.
    const sameAdmin = await svc.auth.admin.updateUserById(userId, { password: NEW });
    check(`B[${label}]: admin accepts the same password (no same_password error on this path)`, !sameAdmin.error);

    const { data: u } = await svc.auth.admin.getUserById(userId);
    check(`B[${label}]: role readable from app_metadata`, resetDoneVariant(u.user?.app_metadata?.role) === (withMfa ? 'leader' : 'member'));
  } finally {
    await svc.auth.admin.deleteUser(userId);
  }
}

async function partB() {
  assertLocalDb();
  await flow('mfa', true);
  await flow('no-mfa', false);
}

partB()
  .catch((e) => { console.error('Part B error:', e instanceof Error ? e.message : e); failed++; })
  .finally(() => { console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED'); process.exit(failed ? 1 : 0); });
