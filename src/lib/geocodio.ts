// FP-219-adj-1: server-side address verification via Geocodio. Never import
// this from a client component — GEOCODIO_API_KEY must stay out of the bundle.
//
// API shape verified against https://www.geocod.io/docs/ : GET
// https://api.geocod.io/v2/geocode?q=<address>, key via `Authorization: Bearer`
// (keeps it out of URLs/logs). Response is `{ results: [{ accuracy, accuracy_type, ... }] }`;
// an unmatched address returns `results: []`. `accuracy` is a 0-1 score.
const GEOCODIO_URL = 'https://api.geocod.io/v2/geocode';
const TIMEOUT_MS = 4000;

// Below this the best match is a weak guess rather than a recognizable place.
// Deliberately low: events are often at named venues ("Community Hall, Main St")
// that geocode imperfectly, and a false rejection blocks a legitimate save.
// Geocodio's docs give no official cutoff, so this only catches clear junk.
const MIN_ACCURACY = 0.5;

/**
 * Returns false only on a clear non-resolution (Geocodio answered and found
 * nothing usable). Fails OPEN — returns true — on a missing key, network error,
 * timeout, non-2xx, or unexpected payload, so a Geocodio outage can never block
 * saving a real event.
 */
export async function isResolvableAddress(address: string): Promise<boolean> {
  // EventForm sends 'N/A' as the placeholder address for Announcements, which
  // have no physical location — nothing to verify.
  if (address.trim() === 'N/A') return true;

  const apiKey = process.env.GEOCODIO_API_KEY;
  if (!apiKey) {
    console.warn('[geocodio] GEOCODIO_API_KEY not set — skipping address verification');
    return true;
  }

  try {
    const url = `${GEOCODIO_URL}?${new URLSearchParams({ q: address, limit: '1' })}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[geocodio] HTTP ${res.status} — skipping address verification`);
      return true;
    }
    const data = (await res.json()) as { results?: { accuracy?: number }[] };
    if (!Array.isArray(data.results)) {
      console.warn('[geocodio] unexpected response shape — skipping address verification');
      return true;
    }
    if (data.results.length === 0) return false;
    const best = data.results[0]?.accuracy;
    return typeof best !== 'number' || best >= MIN_ACCURACY;
  } catch (err) {
    console.warn('[geocodio] lookup failed — skipping address verification', err);
    return true;
  }
}
