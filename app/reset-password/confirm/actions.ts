'use server';

import { createSupabaseServerClient } from '@/src/lib/supabase/server';
import {
  parseResetCredential,
  resetDoneVariant,
  validateNewPassword,
} from '@/src/features/auth/reset-password';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

export interface ResetConfirmState {
  error?: string;
  // True when the emailed link can no longer be used (invalid, expired, or already used).
  linkInvalid?: boolean;
}

const INVALID_LINK: ResetConfirmState = {
  error: 'Invalid reset link. Please request a new one.',
  linkInvalid: true,
};

export async function confirmPasswordResetAction(
  _prev: ResetConfirmState,
  formData: FormData
): Promise<ResetConfirmState> {
  const password = formData.get('password') as string | null;
  const confirm = formData.get('confirmPassword') as string | null;
  const tokenHash = (formData.get('tokenHash') as string | null) ?? undefined;
  const code = (formData.get('code') as string | null) ?? undefined;

  // 1. Validate the password first: a typo must not use up the one-time link.
  const passwordError = validateNewPassword(password, confirm);
  if (passwordError) return { error: passwordError };

  // 2. Which credential did the link carry?
  const credential = parseResetCredential({ token_hash: tokenHash, type: 'recovery', code });
  if (!credential) return INVALID_LINK;

  // 3. Verify the link HERE (a Server Action can set the session cookies; the page cannot).
  // Always verify; never reuse a session already in this browser, or a different signed-in
  // account's password could be changed.
  const supabase = await createSupabaseServerClient();
  const { error: verifyError } =
    credential.kind === 'token_hash'
      ? await supabase.auth.verifyOtp({ token_hash: credential.tokenHash, type: 'recovery' })
      : await supabase.auth.exchangeCodeForSession(credential.code);
  if (verifyError) {
    return { error: 'Reset link is invalid or expired. Please request a new one.', linkInvalid: true };
  }

  // 4. The session that verification just created.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return INVALID_LINK;

  // 5. Set the password. The link is already used at this point, so any failure means a new link.
  // Why the admin API: a reset-link session is only aal1, and Supabase refuses
  // auth.updateUser({ password }) at aal1 when the account has MFA (401 insufficient_aal).
  // The link has just proven control of the mailbox. The new password alone signs nobody in:
  // sign-in still needs the authenticator code (aal2), and step 6 revokes every existing session.
  // The service-role client is used only for this call and the global sign-out below.
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { error: updateError } = await svc.auth.admin.updateUserById(session.user.id, {
    password: password!,
  });
  if (updateError) {
    if (updateError.code === 'same_password') {
      return {
        error: 'Choose a password you have not used before. Please request a new reset link.',
        linkInvalid: true,
      };
    }
    return { error: 'Could not update password. Please request a new reset link.', linkInvalid: true };
  }

  // 6. Globally invalidate ALL sessions for this account — not just this browser's.
  // An attacker who triggered the reset (or was already logged in elsewhere) keeps nothing.
  await svc.auth.admin.signOut(session.access_token, 'global');

  // Clear MFA trust cookie on this browser too — belt-and-suspenders.
  const cookieStore = await cookies();
  cookieStore.delete('fp_mfa_expires_at');

  // 7. Clear this browser's own session cookies (the token is already revoked; ignore errors).
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {}

  // 8. redirect() throws, so it stays outside any try/catch.
  const variant = resetDoneVariant(session.user.app_metadata?.role as string | undefined);
  redirect(`/reset-password/done?for=${variant}`);
}
