// FP-265: pure helpers for the password-reset confirm step. No React, no Supabase client.
// (isLeaderTierOrAbove is the single source of truth for role tiers, so it is reused here.)
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';

export type ResetCredential =
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'code'; code: string };

const MAX_TOKEN_HASH = 512;
const MAX_CODE = 200;
const CODE_CHARS = /^[A-Za-z0-9_-]+$/;

/**
 * Reads the credential from the emailed link. `token_hash` (works in any browser) is accepted
 * only with type=recovery and wins over `code` (PKCE, same browser only). Anything else is null.
 */
export function parseResetCredential(params: {
  token_hash?: string;
  type?: string;
  code?: string;
}): ResetCredential | null {
  const tokenHash = params.token_hash?.trim();
  if (tokenHash && params.type === 'recovery' && tokenHash.length <= MAX_TOKEN_HASH) {
    return { kind: 'token_hash', tokenHash };
  }
  const code = params.code?.trim();
  if (code && code.length <= MAX_CODE && CODE_CHARS.test(code)) {
    return { kind: 'code', code };
  }
  return null;
}

export function validateNewPassword(
  password: string | null | undefined,
  confirm: string | null | undefined,
): string | null {
  if (!password || password.length < 8) return 'Password must be at least 8 characters.';
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

/** Leader-tier and above sign in with an authenticator code; Members use the phone app. */
export function resetDoneVariant(role: string | undefined): 'leader' | 'member' {
  return role && isLeaderTierOrAbove(role as Role) ? 'leader' : 'member';
}
