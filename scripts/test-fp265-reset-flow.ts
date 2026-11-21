/**
 * FP-265 reset-flow tests.
 * Part A: pure helper cases (no network).
 * Part B: local Supabase only (assertLocalDb) — the verifyOtp -> updateUser -> global signOut
 *   sequence the Server Action performs, plus the sign-in checks.
 * NOT covered: a Server Action cannot be invoked from a plain script, so cookies, redirect() and
 * the pages are covered by the manual browser walk-through, not here.
 * Run with local values: NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY from `supabase status -o env`.
 */
import { createClient } from '@supabase/supabase-js';
import { assertLocalDb } from './lib/assert-local-db';
import {
  parseResetCredential,
  resetDoneVariant,
  validateNewPassword,
} from '../src/features/auth/reset-password';

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

// ---------- Part B ----------
async function partB() {
  assertLocalDb();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const svc = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const email = `fp265-flow-${Date.now()}@example.test`;
  const OLD = 'OldPassw0rd!', NEW = 'NewPassw0rd!2';
  const anonClient = () => createClient(url, anon, { auth: { persistSession: false } });

  const { data: created, error: cErr } = await svc.auth.admin.createUser({ email, password: OLD, email_confirm: true, app_metadata: { role: 'MEMBER' } });
  if (cErr || !created.user) throw new Error('createUser failed');
  const userId = created.user.id;
  try {
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
    check('B: wrong type refused', !!wrongType.error);

    // the action's sequence
    const c = anonClient();
    const v = await c.auth.verifyOtp({ token_hash: hash1, type: 'recovery' });
    check('B: verifyOtp recovery ok', !v.error && !!v.data.session);
    const { data: { session } } = await c.auth.getSession();
    check('B: session present after verify', !!session);
    const same = await c.auth.updateUser({ password: OLD });
    check("B: same password -> code 'same_password'", same.error?.code === 'same_password');
    const upd = await c.auth.updateUser({ password: NEW });
    check('B: updateUser ok', !upd.error);
    const so = await svc.auth.admin.signOut(session!.access_token, 'global');
    check('B: global signOut ok', !so.error);

    check('B: new password signs in', !(await anonClient().auth.signInWithPassword({ email, password: NEW })).error);
    check('B: old password refused', !!(await anonClient().auth.signInWithPassword({ email, password: OLD })).error);
    const refreshed = await anonClient().auth.refreshSession({ refresh_token: otherRefresh });
    check('B: other session signed out', !!refreshed.error);
    const reuse = await anonClient().auth.verifyOtp({ token_hash: hash1, type: 'recovery' });
    check('B: second use of same hashed_token refused', !!reuse.error);

    // role as the action reads it
    const { data: u } = await svc.auth.admin.getUserById(userId);
    check('B: role readable from app_metadata', resetDoneVariant(u.user?.app_metadata?.role) === 'member');
  } finally {
    await svc.auth.admin.deleteUser(userId);
  }
}

partB()
  .catch((e) => { console.error('Part B error:', e instanceof Error ? e.message : e); failed++; })
  .finally(() => { console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED'); process.exit(failed ? 1 : 0); });
