/**
 * FP-263: the local-only database guard. Pure checks; no database or network is touched.
 * Run: npx tsx scripts/test-fp263-local-guard.ts
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLocalSupabaseUrl, assertLocalDb } from './lib/assert-local-db';

assertLocalDb(undefined, { allowUnset: true });

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
}

console.log('=== isLocalSupabaseUrl');
const cases: [string, boolean][] = [
  ['http://127.0.0.1:54321', true],
  ['http://localhost:54321', true],
  ['http://[::1]:54321', true],
  ['https://abcd.supabase.co', false],
  ['http://127.0.0.1.evil.com', false],
  ['http://localhost.evil.com', false],
  ['http://evil.com/127.0.0.1', false],
  ['http://127.0.0.1@evil.com', false],
  ['', false],
  ['not a url', false],
  ['127.0.0.1:54321', false],
  ['ftp://127.0.0.1', false],
];
for (const [url, want] of cases) check(`${JSON.stringify(url)} -> ${want}`, isLocalSupabaseUrl(url) === want);
check('undefined -> false', !isLocalSupabaseUrl(undefined));

console.log('\n=== assertLocalDb in a child process (exit code)');
const repoRoot = process.cwd();
// tsx is not a project dependency (npx fetches it), so children run through `npx tsx`; shell: true
// is what finds npx on Windows. No argument below contains a space.
const NPX = { shell: true, cwd: repoRoot, encoding: 'utf8' as const };
const slashes = (p: string) => p.split(String.fromCharCode(92)).join('/');
const helperPath = slashes(join(repoRoot, 'scripts/lib/assert-local-db.ts'));
const tmp = mkdtempSync(join(tmpdir(), 'fp263-'));
function runAssert(url: string | undefined, allowUnset = false) {
  const file = join(tmp, `child-${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(file,
    [
      `import { assertLocalDb } from '${helperPath}';`,
      `assertLocalDb(${url === undefined ? 'undefined' : JSON.stringify(url)}, { allowUnset: ${allowUnset} });`,
      `console.log('passed');`,
    ].join('\n'));
  const env = { ...process.env };
  delete env.NEXT_PUBLIC_SUPABASE_URL;
  return spawnSync('npx', ['tsx', slashes(file)],{ ...NPX, env });
}
const hosted = runAssert('https://abcd.supabase.co');
check('hosted URL exits 1', hosted.status === 1, `status ${hosted.status}`);
check('message names the host only and points to CLAUDE.md',
  /Refusing to run: this script only runs against the local Supabase \(got host abcd\.supabase\.co\)\. See CLAUDE\.md\./.test(hosted.stderr ?? ''));
check('local URL exits 0', runAssert('http://127.0.0.1:54321').status === 0);
check('missing URL exits 1', runAssert(undefined).status === 1);
check('missing URL with allowUnset exits 0 (pure scripts)', runAssert(undefined, true).status === 0);
check('hosted URL with allowUnset still exits 1', runAssert('https://abcd.supabase.co', true).status === 1);

console.log('\n=== every tracked scripts/test-*.ts calls assertLocalDb(');
const tracked = execFileSync('git', ['ls-files', 'scripts'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter((f) => /^scripts\/test-[^/]+\.ts$/.test(f));
const missing = tracked.filter((f) => !readFileSync(f, 'utf8').includes('assertLocalDb('));
check(`${tracked.length} test scripts checked`, tracked.length > 0 && missing.length === 0, missing.join(', '));
// the guard must come before the first createClient( in each script
const late = tracked.filter((f) => {
  const s = readFileSync(f, 'utf8');
  const g = s.indexOf('assertLocalDb(');
  const c = s.indexOf('createClient(');
  return c !== -1 && g > c;
});
check('the guard comes before the first createClient( call', late.length === 0, late.join(', '));

console.log('\n=== host list is the same in the guard and in dev-local.mjs');
const LIST = `['127.0.0.1', 'localhost', '[::1]']`;
check('same LOCAL_HOSTS literal in both files',
  readFileSync('scripts/lib/assert-local-db.ts', 'utf8').includes(`LOCAL_HOSTS = ${LIST}`) &&
  readFileSync('scripts/dev-local.mjs', 'utf8').includes(`LOCAL_HOSTS = ${LIST}`));

console.log('\n=== maintenance script opt-in (fake URL and key, --dry-check stops before any client is created)');
function runMaint(url: string, ...args: string[]) {
  return spawnSync('npx', ['tsx', 'scripts/maintenance/remove-already-deactivated-members.mjs', ...args, '--dry-check'], {
    ...NPX,
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'fake-key-not-real' },
  });
}
const noFlag = runMaint('https://abcd.supabase.co');
check('hosted URL without the flag exits 1', noFlag.status === 1, `status ${noFlag.status}`);
check('it prints the host and the exact flag needed',
  /Database: abcd\.supabase\.co/.test(noFlag.stderr) && /--hosted=abcd/.test(noFlag.stderr));
check('wrong project ref exits 1', runMaint('https://abcd.supabase.co', '--hosted=other').status === 1);
check('matching --hosted=abcd passes the guard', (() => {
  const r = runMaint('https://abcd.supabase.co', '--hosted=abcd');
  return r.status === 0 && /Guard passed/.test(r.stdout);
})());
check('local URL runs without any flag', (() => {
  const r = runMaint('http://127.0.0.1:54321');
  return r.status === 0 && /Guard passed/.test(r.stdout);
})());
check('look-alike host is not treated as local', runMaint('http://127.0.0.1.evil.com').status === 1);

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
