-- DIP-FP-196-web: tenant-configurable invitation email subject/body,
-- replacing the single hardcoded template every tenant currently shares via
-- Supabase Auth's auto-sent invite email. Nullable columns, mirroring
-- tenants.tagline/description's exact precedent (20260707000025) — null
-- means "use the platform default," not "broken."
--
-- Design note beyond the DIP's literal plan: nullable + a JS-side fallback
-- constant (invitation.service.ts's DEFAULT_INVITE_SUBJECT/DEFAULT_INVITE_BODY,
-- kept byte-identical to the seed text below) covers every tenant — existing
-- (backfilled here), and future (any tenant row inserted after this migration
-- simply has these columns NULL until customized, and the JS fallback applies
-- exactly the same as it does for a not-yet-backfilled row). This achieves the
-- same "no tenant's dropdown/email silently breaks" guarantee the FP-181/
-- FP-191/FP-192 auto-provisioning triggers exist for for their own tables,
-- without needing a trigger here — because unlike those (separate rows in a
-- per-tenant catalog table), this is just a column value with a well-defined
-- null-means-default fallback already required for other reasons (letting an
-- admin reset to platform default by clearing the field).

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS invite_email_subject TEXT,
    ADD COLUMN IF NOT EXISTS invite_email_body TEXT;

-- Backfill existing tenants with the default wording, so "no tenant's email
-- silently changes on cutover" holds for rows that exist today too — even
-- though the JS fallback would produce the identical result if left NULL,
-- setting it explicitly here means an admin who opens Community Settings
-- sees the actual current wording pre-filled, not a blank field.
UPDATE tenants
SET
    invite_email_subject = 'You have been invited to join {{tenant_name}} on FlockPulse',
    invite_email_body = '<p>You have been invited to join {{tenant_name}} on FlockPulse.</p><p><a href="{{invite_link}}">Accept your invitation</a></p><p>If the button above does not work, copy and paste this link into your browser:</p><p>{{invite_link}}</p>'
WHERE invite_email_subject IS NULL AND invite_email_body IS NULL;
