-- FP-102: Add mfa_trust_duration_days to members.
-- Controls how long a successful TOTP verification is trusted in a given browser
-- before MFA is required again. Default 28 days, max 56 days (8 weeks).
-- The application layer enforces the 1-56 range; the CHECK is the DB safety net.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS mfa_trust_duration_days INTEGER NOT NULL DEFAULT 28
    CHECK (mfa_trust_duration_days BETWEEN 1 AND 56);
