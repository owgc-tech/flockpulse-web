// FP-228: probes the Supabase REST API directly (bypassing the Next.js API) and
// reports PASS/FAIL. PASS = the database refused the direct access.
//
// Probes are side-effect-free even if a privilege were present:
//   - PATCH members / DELETE tenants use a filter on a nonexistent UUID, so they
//     can never match a row. "Permission denied" is the PASS; a 204 (zero rows
//     affected) means the privilege exists, which is a FAIL.
//   - GETs on members, tenants and events must be denied. A 200 with an empty
//     array is a FAIL: it means SELECT is granted and only RLS hid the rows.
//   - The one RPC is get_event_effective_status with a random UUID — read-only.
//   No action function is ever called.
//
// Keys come from the environment; nothing is committed:
//   SUPABASE_URL        e.g. http://127.0.0.1:54321
//   SUPABASE_ANON_KEY   the project's anon / publishable key
//   MEMBER_JWT          (optional) a real signed-in member's access token; when
//                       set, the probes run a second time as anon key + member JWT
//
// Usage: node scripts/security/probe-direct-access.mjs
// Exit code 0 = every probe PASSed, 1 = at least one FAIL, 2 = bad setup.

const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY;
const memberJwt = process.env.MEMBER_JWT;

if (!url || !anonKey) {
  console.error('Set SUPABASE_URL and SUPABASE_ANON_KEY (and optionally MEMBER_JWT).');
  process.exit(2);
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const RANDOM_UUID = crypto.randomUUID();

const probes = [
  { name: 'GET    members',     method: 'GET',    path: '/rest/v1/members?select=id&limit=1' },
  { name: 'GET    tenants',     method: 'GET',    path: '/rest/v1/tenants?select=id&limit=1' },
  { name: 'GET    events',      method: 'GET',    path: '/rest/v1/events?select=id&limit=1' },
  { name: 'PATCH  members',     method: 'PATCH',  path: `/rest/v1/members?id=eq.${NIL_UUID}`, body: { role: 'ADMIN' } },
  { name: 'DELETE tenants',     method: 'DELETE', path: `/rest/v1/tenants?id=eq.${NIL_UUID}` },
  { name: 'RPC    get_event_effective_status', method: 'POST', path: '/rest/v1/rpc/get_event_effective_status', body: { p_event_id: RANDOM_UUID } },
];

async function run(label, bearer) {
  const results = [];
  for (const p of probes) {
    const res = await fetch(url + p.path, {
      method: p.method,
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: p.body ? JSON.stringify(p.body) : undefined,
    });
    const text = await res.text();
    let code = '';
    try { code = JSON.parse(text)?.code ?? ''; } catch { /* non-JSON body */ }

    // Denied = 401/403 (PostgREST maps SQLSTATE 42501 to 401 for anon, 403 for
    // authenticated). Anything that executed — 200/204 — is a FAIL, even when the
    // result is empty, because it proves the privilege exists.
    const denied = res.status === 401 || res.status === 403 || code === '42501';
    results.push({
      caller: label,
      probe: p.name,
      http: res.status,
      sqlstate: code || '-',
      result: denied ? 'PASS' : 'FAIL',
    });
  }
  return results;
}

const all = [...(await run('anon key only', anonKey))];
if (memberJwt) all.push(...(await run('anon key + member JWT', memberJwt)));
else console.warn('MEMBER_JWT not set — skipping the member-JWT probes.\n');

console.table(all);
const failed = all.filter((r) => r.result === 'FAIL');
console.log(failed.length === 0 ? `ALL ${all.length} PROBES PASSED` : `${failed.length} OF ${all.length} PROBES FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
