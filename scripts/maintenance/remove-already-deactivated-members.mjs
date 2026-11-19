// FP-235: one-time cleanup of members who were deactivated BEFORE FP-235 and still
// hold identifying details and/or a live login.
//
// For each such member it runs the SAME shared routine the app uses
// (removeMember() in src/features/members/service.ts -> remove_member() + deleting the
// Auth login) with reason DEACTIVATED, so the result is identical to an admin Remove.
// Already-scrubbed members keep their label (a 'Self-deleted User' is not relabelled).
//
// A member needs cleanup when it is removed (deleted_at set) AND at least one of:
//   - details : email is not the 'deleted-<id>@deleted.invalid' placeholder
//   - login   : the Auth user still exists
//   - invite  : an invitation row for their login still has a real email or is PENDING
//
// DRY RUN by default: lists who WOULD be removed — by member id, removal date and which
// of the three conditions apply — and never prints names or emails. Nothing is written
// until you pass --execute.
//
// Keys come from the environment (nothing is committed). It talks to whatever database
// NEXT_PUBLIC_SUPABASE_URL points at and prints the host first, so check it.
//
//   Dry run:  npx tsx --env-file=.env.local scripts/maintenance/remove-already-deactivated-members.mjs
//   Execute:  npx tsx --env-file=.env.local scripts/maintenance/remove-already-deactivated-members.mjs --execute
//
// (tsx is what lets this .mjs import the TypeScript service; the script is safe to
// re-run — a second run finds nothing left to do.)
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}
const execute = process.argv.includes('--execute');

const db = createClient(url, key);
const PLACEHOLDER = /^deleted-[0-9a-f-]{36}@deleted\.invalid$/;
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

console.log(`Database: ${new URL(url).host}`);
console.log(execute ? 'MODE: EXECUTE (will remove)' : 'MODE: DRY RUN (no changes; pass --execute to remove)');

const { data: removed, error } = await db
  .from('members')
  .select('id, tenant_id, user_id, email, deleted_at')
  .not('deleted_at', 'is', null)
  .order('deleted_at', { ascending: true });
if (error) { console.error('Could not read members:', error.code ?? error.message); process.exit(1); }

// pending / un-scrubbed invitation rows, by login id
const dirtyInviteLogins = new Set();
for (const ids of chunk((removed ?? []).map((m) => m.user_id), 100)) {
  const { data: invs, error: invErr } = await db
    .from('invitations').select('auth_user_id, email, status').in('auth_user_id', ids);
  if (invErr) { console.error('Could not read invitations:', invErr.code ?? invErr.message); process.exit(1); }
  for (const i of invs ?? []) {
    if (!PLACEHOLDER.test(i.email) || i.status === 'PENDING') dirtyInviteLogins.add(i.auth_user_id);
  }
}

const candidates = [];
for (const m of removed ?? []) {
  const details = !PLACEHOLDER.test(m.email);
  const { data: u } = await db.auth.admin.getUserById(m.user_id);
  const login = !!u?.user;
  const invite = dirtyInviteLogins.has(m.user_id);
  if (details || login || invite) candidates.push({ id: m.id, tenant_id: m.tenant_id, deleted_at: m.deleted_at, details, login, invite });
}

console.log(`\nRemoved members in total: ${(removed ?? []).length}`);
console.log(`Still holding details, a login or invitation data: ${candidates.length}\n`);
for (const c of candidates) {
  console.log(`  ${c.id}  removed ${String(c.deleted_at).slice(0, 10)}  [${[c.details && 'details', c.login && 'login', c.invite && 'invite'].filter(Boolean).join(', ')}]`);
}

if (!execute) {
  console.log(candidates.length ? '\nDry run only. Re-run with --execute to remove them.' : '\nNothing to do.');
  process.exit(0);
}

const { removeMember } = await import('../../src/features/members/service.ts');
let ok = 0, failed = 0;
for (const c of candidates) {
  try {
    await removeMember(c.id, c.tenant_id, 'DEACTIVATED');
    ok++;
    console.log(`  removed  ${c.id}`);
  } catch (e) {
    failed++;
    // code only — never print messages that could carry personal data
    console.log(`  FAILED   ${c.id}  (${e?.code ?? 'ERROR'})`);
  }
}
console.log(`\nDone: ${ok} removed, ${failed} failed.${failed ? ' Re-run to retry the failed ones.' : ''}`);
process.exit(failed ? 1 : 0);
