import type { Metadata } from 'next';

// FP-249: shown for every page while the site gate is closed (see proxy.ts and
// src/lib/site-gate.ts). Server component: no data, no auth, no analytics.
export const metadata: Metadata = {
  title: 'FlockPulse — Coming soon',
  robots: { index: false, follow: false },
};

export default function ComingSoonPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        {/* Plain <img>, like app/login/page.tsx: avoids /_next/image on a gated host. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/flockpulse-logo.png" alt="FlockPulse" className="mx-auto mb-6 h-auto w-full" />
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl">Coming soon</h1>
        <p className="mt-4 text-base text-zinc-600">
          Helping communities run their events, attendance and programs.
        </p>
        <p className="mt-6 text-sm text-zinc-600">
          Questions?{' '}
          <a
            href="mailto:support@flockpulse.ca"
            className="font-medium text-zinc-900 underline underline-offset-2"
          >
            support@flockpulse.ca
          </a>
        </p>
      </div>
    </main>
  );
}
