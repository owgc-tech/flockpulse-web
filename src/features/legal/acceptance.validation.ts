// FP-254: pure input check for POST /api/members/me/acceptance. No imports.
// Both flags must be exactly the boolean true; anything else (missing, "true", 1, false, null) is refused.

export type AcceptanceBodyResult = { ok: true } | { ok: false; message: string };

export function validateAcceptanceBody(body: unknown): AcceptanceBodyResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be an object with confirmAdult and acceptTerms' };
  }
  const { confirmAdult, acceptTerms } = body as Record<string, unknown>;
  if (confirmAdult !== true) {
    return { ok: false, message: 'confirmAdult must be true: you must confirm you are 18 or older' };
  }
  if (acceptTerms !== true) {
    return { ok: false, message: 'acceptTerms must be true: you must accept the Terms of Service and the Privacy Policy' };
  }
  return { ok: true };
}
