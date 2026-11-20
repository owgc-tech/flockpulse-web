// FP-263: `npm run dev:local` — run the app against the LOCAL Supabase only.
//
// Reads the local API URL and keys from `supabase status -o env`, refuses anything that is not
// on this computer, and starts `next dev` with those values in the CHILD PROCESS ENVIRONMENT.
// Next.js never overwrites a variable that is already set in the process environment with a
// value from .env.local, so the hosted values in .env.local are ignored. This script never
// writes a file, never reads .env.local, and never prints a key (only the host).
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Keep in step with LOCAL_HOSTS in scripts/lib/assert-local-db.ts (scripts/test-fp263-local-guard.ts checks it).
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

function isLocalSupabaseUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return LOCAL_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// shell: true so the Supabase CLI is found on Windows (supabase.cmd) as well as macOS/Linux.
const status = spawnSync('supabase status -o env', { shell: true, encoding: 'utf8' });
const values = {};
for (const line of (status.stdout ?? '').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
  if (m) values[m[1]] = m[2];
}

const apiUrl = values.API_URL;
const anonKey = values.ANON_KEY;
const serviceKey = values.SERVICE_ROLE_KEY;
if (status.status !== 0 || !apiUrl || !anonKey || !serviceKey) {
  fail('Start the local database first: supabase start');
}
if (!isLocalSupabaseUrl(apiUrl)) {
  let host = '(unreadable)';
  try { host = new URL(apiUrl).host; } catch { /* keep the placeholder */ }
  fail(`Refusing to start: the Supabase CLI reports a database that is not on this computer (host ${host}). See CLAUDE.md.`);
}

console.log(`dev:local: using the local Supabase at ${new URL(apiUrl).host} (not .env.local)`);

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
  },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
