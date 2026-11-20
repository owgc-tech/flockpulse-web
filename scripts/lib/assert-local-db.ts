/**
 * FP-263: every test script calls assertLocalDb() before it connects, so a script can never
 * reach the hosted database (which holds real data) by accident.
 *
 * Only the HOST is ever printed. Never print a key or the contents of .env.local.
 * There is deliberately no override flag.
 */

// Keep in step with LOCAL_HOSTS in scripts/dev-local.mjs (scripts/test-fp263-local-guard.ts checks it).
const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

export function isLocalSupabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return LOCAL_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

function hostOf(url: string | undefined | null): string {
  if (!url) return '(not set)';
  try {
    return new URL(url).host || '(unreadable)';
  } catch {
    return '(unreadable)';
  }
}

/**
 * Exits with code 1 unless the URL is on this computer. A missing URL is refused too, except
 * for scripts that never connect to a database at all (pure checks) and pass `allowUnset`:
 * a URL that IS set but is not local is still refused for them.
 */
export function assertLocalDb(
  url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
  options: { allowUnset?: boolean } = {},
): void {
  if (!url && options.allowUnset) return;
  if (isLocalSupabaseUrl(url)) return;
  console.error(
    `Refusing to run: this script only runs against the local Supabase (got host ${hostOf(url)}). See CLAUDE.md.`,
  );
  process.exit(1);
}
