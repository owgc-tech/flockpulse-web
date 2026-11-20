## Database safety (FP-263) — read before running anything
- `.env.local` points at the HOSTED database with real data. Never read it into a script, never `source` it, and never start a dev server or script that uses it.
- To run the app locally, use `npm run dev:local` (local Supabase only). Never `npm run dev`.
- Every test script must call `assertLocalDb()` from `scripts/lib/assert-local-db.ts` before connecting. New test scripts must do the same.
- Never apply migrations or run SQL against a hosted project. Joseph does that by hand.
- If anything you ran may have touched a hosted database, stop and say so in your report.

@AGENTS.md
