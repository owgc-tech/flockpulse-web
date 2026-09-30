// FP-219-adj-1: server-side address verification via Geocodio. Never import
// this from a client component — GEOCODIO_API_KEY must stay out of the bundle.
//
// API shape verified against https://www.geocod.io/docs/ : GET
// https://api.geocod.io/v2/geocode?q=<address>, key via `Authorization: Bearer`
// (keeps it out of URLs/logs). Response is `{ results: [{ accuracy, accuracy_type, ... }] }`;
// an unmatched address returns `results: []`. `accuracy` is a 0-1 score.
const GEOCODIO_URL = 'https://api.geocod.io/v2/geocode';
const TIMEOUT_MS = 4000;

// `accuracy` only measures how exactly the result's text matches the input, so
// a non-address like "Test" can score 1.0 (it matches a place literally named
// "Test"). Geocodio's docs say to check `accuracy_type` too: only these
// street-level types count as a real, specific location. Region centroids
// (`place`, `county`, `state`, `nearest_place`) and anything unrecognized are
// rejected regardless of score.
const REAL_ADDRESS_TYPES = new Set([
  'rooftop',
  'range_interpolation',
  'nearest_street',
  'point',
  'nearest_rooftop_match',
  'street_center',
  'intersection',
]);

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
  if (address.trim() === 'N/A') {
    console.log(`[FP-219-investigate] N/A placeholder — skipped, returning true`);
    return true;
  }

  const apiKey = process.env.GEOCODIO_API_KEY;
  if (!apiKey) {
    console.warn('[geocodio] GEOCODIO_API_KEY not set — skipping address verification');
    console.log(`[FP-219-investigate] address=${JSON.stringify(address)} no API key — returning true (fail open)`);
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
      console.log(`[FP-219-investigate] address=${JSON.stringify(address)} HTTP ${res.status} — returning true (fail open)`);
      return true;
    }
    const data = (await res.json()) as { results?: { accuracy?: number; accuracy_type?: string }[] };
    if (!Array.isArray(data.results)) {
      console.warn('[geocodio] unexpected response shape — skipping address verification');
      console.log(`[FP-219-investigate] address=${JSON.stringify(address)} unexpected response shape — returning true (fail open)`);
      return true;
    }
    if (data.results.length === 0) {
      console.log(`[FP-219-investigate] address=${JSON.stringify(address)} rejected as unresolvable (no results) — returning false`);
      return false;
    }
    const best = data.results[0]?.accuracy;
    const bestType = data.results[0]?.accuracy_type;
    const resolvable =
      (typeof best !== 'number' || best >= MIN_ACCURACY) &&
      typeof bestType === 'string' && REAL_ADDRESS_TYPES.has(bestType);
    console.log(`[FP-219-investigate] address=${JSON.stringify(address)} bestAccuracy=${best} accuracy_type=${bestType} threshold=${MIN_ACCURACY} decision=${resolvable}`);
    return resolvable;
  } catch (err) {
    console.warn('[geocodio] lookup failed — skipping address verification', err);
    console.log(`[FP-219-investigate] address=${JSON.stringify(address)} lookup threw — returning true (fail open)`);
    return true;
  }
}
