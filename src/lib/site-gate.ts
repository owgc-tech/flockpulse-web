// FP-249: "Coming soon" gate. Pure decision logic, no Next.js imports, so it can be
// tested directly (scripts/test-site-gate.ts) and used from proxy.ts.
//
// Gated = FP_PUBLIC_LAUNCH is not exactly 'true' AND (this is a Vercel production
// deployment OR the request host is flockpulse.ca / www.flockpulse.ca). Preview
// deployments and local development are never gated.

export type SiteGateDecision = 'pass' | 'coming-soon' | 'api-not-found' | 'asset';

export interface SiteGateInput {
  host: string;
  pathname: string;
  vercelEnv: string | undefined;
  publicLaunch: string | undefined;
}

const GATED_HOSTS = new Set(['flockpulse.ca', 'www.flockpulse.ca']);

// Paths that stay reachable while gated (the legal pages join here later). Exact
// match or a sub-path of an entry.
export const GATE_PUBLIC_PATHS: string[] = [];

// Files the coming-soon page and the browser tab need. app/icon.png is served at /icon.png.
const ASSET_EXACT = new Set(['/favicon.ico', '/icon.png']);

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + '/');
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}

export function isGated(input: Pick<SiteGateInput, 'host' | 'vercelEnv' | 'publicLaunch'>): boolean {
  if (input.publicLaunch === 'true') return false;
  return input.vercelEnv === 'production' || GATED_HOSTS.has(normalizeHost(input.host));
}

export function siteGateDecision(input: SiteGateInput): SiteGateDecision {
  if (!isGated(input)) return 'pass';

  const { pathname } = input;

  if (pathname.startsWith('/_next/static/') || pathname.startsWith('/_next/image') || ASSET_EXACT.has(pathname)) {
    return 'asset';
  }
  if (isUnder(pathname, '/api')) return 'api-not-found';
  if (isUnder(pathname, '/coming-soon')) return 'pass';
  if (GATE_PUBLIC_PATHS.some((p) => isUnder(pathname, p))) return 'pass';
  return 'coming-soon';
}
