import type { Metadata } from 'next';
import LegalPage from '@/src/features/legal-pages/LegalPage';

// FP-249: public, static, no login and no API call.
export const dynamic = 'force-static';

export const metadata: Metadata = { title: 'Terms of Service | FlockPulse' };

export default function Page() {
  return <LegalPage doc="terms-of-service" />;
}
