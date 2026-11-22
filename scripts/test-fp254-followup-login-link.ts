/**
 * FP-254 follow-up: which roles get the "Continue to Login" button on the registration-complete screen.
 * Pure helper cases only: no network, no database (so no assertLocalDb call is needed).
 * NOT covered: the rendered screen and the /accept-terms redirect (browser only).
 */
import { showContinueToLogin } from '../src/features/registration/registration-complete';

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed++;
}

// Admin tier and Leader tier: button shown.
for (const role of ['ADMIN', 'LEADER', 'SR_COORDINATOR', 'COORDINATOR', 'COMMUNITY_SERVANT', 'PASTORAL_LEADER']) {
  check(`${role} -> true`, showContinueToLogin(role) === true);
}

// Member: no button.
check('MEMBER -> false', showContinueToLogin('MEMBER') === false);

// Missing, empty, wrong case, padded, unknown: no button.
check('null -> false', showContinueToLogin(null) === false);
check('undefined -> false', showContinueToLogin(undefined) === false);
check("'' -> false", showContinueToLogin('') === false);
check("'admin' (lower case) -> false", showContinueToLogin('admin') === false);
check("' ADMIN' (padded) -> false", showContinueToLogin(' ADMIN') === false);
check("'SUPERUSER' (unknown) -> false", showContinueToLogin('SUPERUSER') === false);
check("'constructor' (object key, not a role) -> false", showContinueToLogin('constructor') === false);
check('non-string 1 -> false', showContinueToLogin(1 as unknown as string) === false);

// Same set as the Role type in src/lib/auth/middleware.ts: every role there except MEMBER is true.
import { readFileSync } from 'node:fs';
const src = readFileSync('src/lib/auth/middleware.ts', 'utf8');
const typeBlock = src.slice(src.indexOf('export type Role'), src.indexOf('export interface AuthContext'));
const roles = [...typeBlock.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
check(`middleware.ts Role type parsed (${roles.length} roles)`, roles.length >= 7);
check(
  'every Role except MEMBER -> true, MEMBER -> false (stays in step with middleware.ts)',
  roles.every((r) => showContinueToLogin(r) === (r !== 'MEMBER')),
);

console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
