/**
 * FP-249: tests for the coming-soon gate decision.
 * Run: npx tsx scripts/test-site-gate.ts
 */
import assert from 'node:assert/strict';
import { siteGateDecision, GATE_PUBLIC_PATHS } from '../src/lib/site-gate';

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.equal(actual, expected, name);
  passed++;
  console.log(`  PASS  ${name}`);
}

const d = (host: string, pathname: string, vercelEnv?: string, publicLaunch?: string) =>
  siteGateDecision({ host, pathname, vercelEnv, publicLaunch });

console.log('=== Not gated');
for (const p of ['/', '/login', '/api/events']) {
  check(`preview host + preview env: ${p}`, d('preview.flockpulse.ca', p, 'preview'), 'pass');
}
check('localhost:3000, no env', d('localhost:3000', '/', undefined), 'pass');
check('localhost api, no env', d('localhost:3000', '/api/events', undefined), 'pass');

console.log('=== Gated by host / env');
check('flockpulse.ca + preview env: host rule alone gates', d('flockpulse.ca', '/', 'preview'), 'coming-soon');
check('FlockPulse.CA:443: case and port', d('FlockPulse.CA:443', '/', 'preview'), 'coming-soon');
check('www.flockpulse.ca', d('www.flockpulse.ca', '/', 'preview'), 'coming-soon');
check('flockpulse-web.vercel.app + production: env rule', d('flockpulse-web.vercel.app', '/', 'production'), 'coming-soon');

console.log('=== Gated paths');
check('gated /', d('flockpulse.ca', '/', 'production'), 'coming-soon');
check('gated /login', d('flockpulse.ca', '/login', 'production'), 'coming-soon');
check('gated /admin/events', d('flockpulse.ca', '/admin/events', 'production'), 'coming-soon');
check('gated /coming-soon', d('flockpulse.ca', '/coming-soon', 'production'), 'pass');
check('gated /api', d('flockpulse.ca', '/api', 'production'), 'api-not-found');
check('gated /api/events/123', d('flockpulse.ca', '/api/events/123', 'production'), 'api-not-found');
check('gated /apiary is a page, not api', d('flockpulse.ca', '/apiary', 'production'), 'coming-soon');
check('gated /_next/static/x.js', d('flockpulse.ca', '/_next/static/x.js', 'production'), 'asset');
check('gated /_next/image', d('flockpulse.ca', '/_next/image', 'production'), 'asset');
check('gated /favicon.ico', d('flockpulse.ca', '/favicon.ico', 'production'), 'asset');
check('gated /icon.png', d('flockpulse.ca', '/icon.png', 'production'), 'asset');
check('gated /flockpulse-logo.png', d('flockpulse.ca', '/flockpulse-logo.png', 'production'), 'asset');
check('gated /flockpulse-logo.png.html: exact match only', d('flockpulse.ca', '/flockpulse-logo.png.html', 'production'), 'coming-soon');
check('preview host /flockpulse-logo.png', d('preview.flockpulse.ca', '/flockpulse-logo.png', 'preview'), 'pass');

console.log('=== Launch switch');
check("publicLaunch 'true' opens the site", d('flockpulse.ca', '/', 'production', 'true'), 'pass');
check("publicLaunch 'TRUE' stays gated", d('flockpulse.ca', '/', 'production', 'TRUE'), 'coming-soon');
check("publicLaunch '1' stays gated", d('flockpulse.ca', '/', 'production', '1'), 'coming-soon');
check('allowlist is empty for now', GATE_PUBLIC_PATHS.length, 0);

console.log(`\n${passed}/${passed} checks passed`);
