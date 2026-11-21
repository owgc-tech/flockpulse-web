// FP-265 adj-3: pure helpers for the "opened from the phone app" reset page.
// This file must have NO imports: ResetRequestForm.tsx is a client component and imports it.

/** Where "Back to the app" points. The phone app registers this scheme (not verifiable from this repo). */
export const APP_RETURN_URL = 'flockpulse://';

/**
 * True only for ?from=app exactly. The parameter changes wording and one link, nothing else.
 * Arrays (a repeated parameter), empty, other values and other casing are all false.
 */
export function isFromApp(value: string | string[] | undefined): boolean {
  return value === 'app';
}
