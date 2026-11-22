import type { Metadata } from 'next';
import LegalPage from '@/src/features/legal-pages/LegalPage';

// FP-249: public, static, no login and no API call.
export const dynamic = 'force-static';

export const metadata: Metadata = { title: 'Delete your account | FlockPulse' };

export default function Page() {
  return <LegalPage doc="account-deletion-page" />;
}
