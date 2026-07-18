import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { isLeaderTierOrAbove, type Role } from '@/src/lib/auth/middleware';

// MFA trust cookie written by /login/mfa-challenge/actions.ts after successful
// TOTP verification. Value is a Unix-ms timestamp (when trust expires).
const MFA_EXPIRES_COOKIE = 'fp_mfa_expires_at';

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect /admin/* routes. All other paths pass through unchanged.
  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  const res = NextResponse.next();

  // Create an SSR Supabase client that can read and refresh session cookies.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  // getUser() validates the JWT server-side (does not trust the cached session).
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const role = user.app_metadata?.role as string | undefined;
  if (!role || !isLeaderTierOrAbove(role as Role)) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // /admin/mfa-enroll is the enrollment destination for first-time
  // Leader-tier-or-above accounts.
  // It must be reachable with a password-only (aal1) session — applying the
  // AAL2 check here would redirect them to /login/mfa-challenge, which requires
  // a verified factor that doesn't exist yet (lockout). Session authentication
  // above is still enforced; only the MFA-complete check is skipped.
  if (pathname.startsWith('/admin/mfa-enroll')) {
    return res;
  }

  // Defense-in-depth: verify the underlying Supabase session is actually at AAL2
  // (meaning MFA was genuinely completed in this session).
  // getAuthenticatorAssuranceLevel() with no JWT arg reads from the loaded session
  // — fast, no network call after the getUser() above has already hydrated it.
  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const sessionIsAAL2 = aalData?.currentLevel === 'aal2';

  // Also check our trust-window cookie. Both must be satisfied:
  // - AAL2 confirms the session actually completed MFA verification.
  // - fp_mfa_expires_at confirms the trust window hasn't expired per the
  //   member's configured mfa_trust_duration_days.
  const mfaExpires = req.cookies.get(MFA_EXPIRES_COOKIE)?.value;
  const now = Date.now();
  const trustWindowValid = !!mfaExpires && parseInt(mfaExpires, 10) > now;

  if (!sessionIsAAL2 || !trustWindowValid) {
    // Either the session isn't at AAL2, or the trust window has expired.
    const challengeUrl = new URL('/login/mfa-challenge', req.url);
    challengeUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(challengeUrl);
  }

  return res;
}

export const config = {
  matcher: ['/admin/:path*'],
};
