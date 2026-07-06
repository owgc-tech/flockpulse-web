import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

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
  if (role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Optimistic MFA trust check — read expiry timestamp from cookie.
  // Written by the MFA challenge action after successful TOTP verification.
  const mfaExpires = req.cookies.get(MFA_EXPIRES_COOKIE)?.value;
  const now = Date.now();

  if (!mfaExpires || parseInt(mfaExpires, 10) <= now) {
    // Trust window absent or expired — require fresh TOTP verification.
    const challengeUrl = new URL('/login/mfa-challenge', req.url);
    challengeUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(challengeUrl);
  }

  return res;
}

export const config = {
  matcher: ['/admin/:path*'],
};
