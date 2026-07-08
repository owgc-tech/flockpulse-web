/**
 * FP-104 nav shell + community banner verification.
 *
 * GROUP 1 — Tagline update
 *   1.1  updateTenantSettings: sets tagline on tenant record
 *   1.2  updateTenantSettings: clears tagline when null passed
 *   1.3  updateTenantSettings: rejects tagline > 150 chars (VALIDATION_ERROR)
 *   1.4  updateTenantSettings: accepts tagline exactly 150 chars
 *   1.5  updateTenantSettings: tenant isolation — one tenant's tagline does not affect another's
 *
 * GROUP 2 — Logo upload
 *   2.1  uploadTenantLogo: rejects non-image MIME type (VALIDATION_ERROR)
 *   2.2  uploadTenantLogo: rejects oversized file > 2 MB (VALIDATION_ERROR)
 *   2.3  uploadTenantLogo: rejects SVG MIME type (not png/jpeg)
 *   2.4  uploadTenantLogo: accepts valid PNG under 2 MB, updates logo_url in DB
 *   2.5  uploadTenantLogo: re-upload produces a new URL with different cache-buster (?v=...)
 *   2.6  uploadTenantLogo: tenant isolation — tenant A upload path does not overwrite tenant B path
 *
 * GROUP 3 — getTenantSettings
 *   3.1  getTenantSettings: returns name, logo_url, tagline, attendance_window_hours
 *   3.2  getTenantSettings: logo_url and tagline are null when not set
 *
 * Run: npx tsx scripts/test-fp104-nav-shell-community-banner.ts
 * Requires local Supabase running + migration 20260707000025 applied.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRFA0NiK7kyqHQ4t6t0p0pWMj0F-PQsf2k3Ke6EzXLo';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { createClient } from '@supabase/supabase-js';
import { getTenantSettings, updateTenantSettings, uploadTenantLogo } from '../src/features/tenant/service';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(label: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`  ✗  ${label}\n     ${msg}`);
    failed++;
    failures.push(`${label}: ${msg}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function assertThrowsCode(code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    throw new Error(`Expected error with code ${code} but resolved`);
  } catch (e) {
    const thrown = e as { code?: string; message?: string };
    if (thrown.message === `Expected error with code ${code} but resolved`) throw e;
    assert(thrown.code === code, `Expected code ${code}, got ${thrown.code ?? 'unknown'}: ${thrown.message}`);
  }
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
async function setupTenant(name: string): Promise<string> {
  const { data, error } = await supa.from('tenants').insert({ name }).select('id').single();
  if (error || !data) throw new Error(`Failed to create tenant ${name}: ${error?.message}`);
  return data.id;
}

async function cleanup(tenantIds: string[]) {
  for (const tid of tenantIds) {
    // Remove from storage (best-effort)
    await supa.storage.from('tenant-logos').remove([`${tid}/logo`]);
    await supa.from('tenants').delete().eq('id', tid);
  }
}

// Minimal valid PNG (1×1 transparent pixel)
function makePng(sizeBytes = 100): File {
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // Pad to requested size if needed (still valid PNG header, extra bytes ignored by upload)
  const buf = bytes.length >= sizeBytes ? bytes : new Uint8Array(sizeBytes);
  if (bytes.length < sizeBytes) buf.set(bytes, 0);
  return new File([buf], 'logo.png', { type: 'image/png' });
}

function makeOversizedPng(): File {
  const TWO_MB_PLUS = 2 * 1024 * 1024 + 1;
  return new File([new Uint8Array(TWO_MB_PLUS)], 'big.png', { type: 'image/png' });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  let tenantA = '';
  let tenantB = '';

  try {
    tenantA = await setupTenant('FP-104 Tenant A');
    tenantB = await setupTenant('FP-104 Tenant B');
  } catch (e) {
    console.error('Setup failed:', e);
    process.exit(1);
  }

  // ── GROUP 1: Tagline ──────────────────────────────────────────────────────
  console.log('\nGROUP 1 — Tagline update');

  await test('1.1  updateTenantSettings: sets tagline on tenant record', async () => {
    await updateTenantSettings(tenantA, { tagline: 'Serving together' });
    const s = await getTenantSettings(tenantA);
    assert(s.tagline === 'Serving together', `Expected "Serving together", got "${s.tagline}"`);
  });

  await test('1.2  updateTenantSettings: clears tagline when null passed', async () => {
    await updateTenantSettings(tenantA, { tagline: null });
    const s = await getTenantSettings(tenantA);
    assert(s.tagline === null, `Expected null, got "${s.tagline}"`);
  });

  await test('1.3  updateTenantSettings: rejects tagline > 150 chars (VALIDATION_ERROR)', async () => {
    await assertThrowsCode('VALIDATION_ERROR', () =>
      updateTenantSettings(tenantA, { tagline: 'x'.repeat(151) })
    );
  });

  await test('1.4  updateTenantSettings: accepts tagline exactly 150 chars', async () => {
    const t = 'x'.repeat(150);
    await updateTenantSettings(tenantA, { tagline: t });
    const s = await getTenantSettings(tenantA);
    assert(s.tagline === t, `Expected 150-char tagline, got length ${s.tagline?.length}`);
  });

  await test('1.5  updateTenantSettings: tenant isolation — tenant A tagline does not affect tenant B', async () => {
    await updateTenantSettings(tenantA, { tagline: 'Tenant A tagline' });
    const b = await getTenantSettings(tenantB);
    assert(b.tagline === null, `Expected tenantB tagline null, got "${b.tagline}"`);
  });

  // ── GROUP 2: Logo upload ──────────────────────────────────────────────────
  console.log('\nGROUP 2 — Logo upload');

  await test('2.1  uploadTenantLogo: rejects non-image MIME type (VALIDATION_ERROR)', async () => {
    const pdf = new File([new Uint8Array(100)], 'doc.pdf', { type: 'application/pdf' });
    await assertThrowsCode('VALIDATION_ERROR', () => uploadTenantLogo(tenantA, pdf));
  });

  await test('2.2  uploadTenantLogo: rejects oversized file > 2 MB (VALIDATION_ERROR)', async () => {
    await assertThrowsCode('VALIDATION_ERROR', () => uploadTenantLogo(tenantA, makeOversizedPng()));
  });

  await test('2.3  uploadTenantLogo: rejects SVG MIME type', async () => {
    const svg = new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' });
    await assertThrowsCode('VALIDATION_ERROR', () => uploadTenantLogo(tenantA, svg));
  });

  await test('2.4  uploadTenantLogo: accepts valid PNG, updates logo_url in DB', async () => {
    const url = await uploadTenantLogo(tenantA, makePng());
    assert(typeof url === 'string' && url.includes('tenant-logos'), `Unexpected url: ${url}`);
    const s = await getTenantSettings(tenantA);
    assert(s.logo_url === url, `DB logo_url mismatch: ${s.logo_url} vs ${url}`);
  });

  await test('2.5  uploadTenantLogo: re-upload produces different cache-buster', async () => {
    // Small delay to guarantee different timestamp
    await new Promise(r => setTimeout(r, 10));
    const url1Before = (await getTenantSettings(tenantA)).logo_url ?? '';
    await new Promise(r => setTimeout(r, 10));
    const url2 = await uploadTenantLogo(tenantA, makePng());
    assert(url1Before !== url2, `Expected different cache-buster. Both: ${url1Before}`);
    assert(url2.includes('?v='), `Expected ?v= query param in ${url2}`);
  });

  await test('2.6  uploadTenantLogo: tenant isolation — uploading for A does not touch B logo_url', async () => {
    const bBefore = (await getTenantSettings(tenantB)).logo_url;
    await uploadTenantLogo(tenantA, makePng());
    const bAfter = (await getTenantSettings(tenantB)).logo_url;
    assert(bBefore === bAfter, `Tenant B logo_url changed unexpectedly: ${bAfter}`);
  });

  // ── GROUP 3: getTenantSettings ────────────────────────────────────────────
  console.log('\nGROUP 3 — getTenantSettings');

  await test('3.1  getTenantSettings: returns expected fields including description', async () => {
    const s = await getTenantSettings(tenantA);
    assert('id' in s, 'Missing id');
    assert('name' in s, 'Missing name');
    assert('logo_url' in s, 'Missing logo_url');
    assert('tagline' in s, 'Missing tagline');
    assert('description' in s, 'Missing description');
    assert('attendance_window_hours' in s, 'Missing attendance_window_hours');
  });

  await test('3.2  getTenantSettings: logo_url, tagline, description null on fresh tenant', async () => {
    const s = await getTenantSettings(tenantB);
    assert(s.logo_url === null, `Expected logo_url null, got ${s.logo_url}`);
    assert(s.tagline === null, `Expected tagline null, got ${s.tagline}`);
    assert(s.description === null, `Expected description null, got ${s.description}`);
  });

  // ── GROUP 4: Description ──────────────────────────────────────────────────
  console.log('\nGROUP 4 — Description update');

  await test('4.1  updateTenantSettings: sets description on tenant record', async () => {
    await updateTenantSettings(tenantA, { description: 'A community for men seeking growth.' });
    const s = await getTenantSettings(tenantA);
    assert(s.description === 'A community for men seeking growth.', `Got: "${s.description}"`);
  });

  await test('4.2  updateTenantSettings: clears description when null passed', async () => {
    await updateTenantSettings(tenantA, { description: null });
    const s = await getTenantSettings(tenantA);
    assert(s.description === null, `Expected null, got "${s.description}"`);
  });

  await test('4.3  updateTenantSettings: rejects description > 500 chars (VALIDATION_ERROR)', async () => {
    await assertThrowsCode('VALIDATION_ERROR', () =>
      updateTenantSettings(tenantA, { description: 'x'.repeat(501) })
    );
  });

  await test('4.4  updateTenantSettings: description tenant isolation', async () => {
    await updateTenantSettings(tenantA, { description: 'Tenant A only' });
    const b = await getTenantSettings(tenantB);
    assert(b.description === null, `Expected tenantB description null, got "${b.description}"`);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  await cleanup([tenantA, tenantB]);

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.error('\nFailures:');
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
