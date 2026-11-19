import type { Metadata } from 'next';

// FP-249: shown for every page while the site gate is closed (see proxy.ts and
// src/lib/site-gate.ts). Server component: no data, no auth, no analytics.
export const metadata: Metadata = {
  title: 'FlockPulse — Coming soon',
  robots: { index: false, follow: false },
};

export default function ComingSoonPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <p className="text-lg font-semibold tracking-wide text-zinc-900 dark:text-zinc-50">FlockPulse</p>
      <p className="max-w-md text-base text-zinc-600 dark:text-zinc-400">
        Helping communities run their events, attendance and programs.
      </p>
      <h1 className="text-5xl font-bold tracking-tight text-zinc-900 sm:text-6xl dark:text-zinc-50">Coming soon</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Questions?{' '}
        <a
          href="mailto:support@flockpulse.ca"
          className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
        >
          support@flockpulse.ca
        </a>
      </p>
    </main>
  );
}
