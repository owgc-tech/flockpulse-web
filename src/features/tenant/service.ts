import { createClient } from '@supabase/supabase-js';

const TAGLINE_MAX = 150;
const DESCRIPTION_MAX = 500;
const NAME_MAX = 150;
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const LOGO_ALLOWED_TYPES = ['image/png', 'image/jpeg'];
// DIP-FP-196-web: subject is a plain email subject line; body is rich-text
// HTML from the Tiptap editor, generous enough for real formatted content.
const INVITE_EMAIL_SUBJECT_MAX = 200;
const INVITE_EMAIL_BODY_MAX = 20000;
// DIP-FP-198-web: never trust the Community settings dropdown's own
// constraint alone — a direct API call could send anything, so the same
// Intl.supportedValuesOf('timeZone') list (native ES2022+, no new package)
// backing the UI is re-validated against here, server-side.
const VALID_TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function err(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

export async function getTenantSettings(tenantId: string) {
  const { data, error } = await serviceClient()
    .from('tenants')
    .select('id, name, attendance_window_hours, rsvp_closure_days_default, rsvp_nudge_days_1, rsvp_nudge_days_2, rsvp_nudge_days_3, logo_url, tagline, description, invite_email_subject, invite_email_body, timezone, created_at')
    .eq('id', tenantId)
    .single();

  if (error) throw error;
  return data as {
    id: string;
    name: string;
    attendance_window_hours: number;
    rsvp_closure_days_default: number;
    rsvp_nudge_days_1: number;
    rsvp_nudge_days_2: number;
    rsvp_nudge_days_3: number;
    logo_url: string | null;
    tagline: string | null;
    description: string | null;
    // DIP-FP-196-web: null means "use the platform default" — invitation.service.ts's
    // DEFAULT_INVITE_SUBJECT/DEFAULT_INVITE_BODY, not a broken/missing template.
    invite_email_subject: string | null;
    invite_email_body: string | null;
    // DIP-FP-190-web-adj-1: NOT NULL DEFAULT 'America/Toronto' — never null,
    // unlike tagline/description/invite_email_*.
    timezone: string;
    created_at: string;
  };
}

export async function updateTenantSettings(
  tenantId: string,
  input: {
    name?: string;
    attendanceWindowHours?: number;
    rsvpClosureDaysDefault?: number;
    rsvpNudgeDays1?: number;
    rsvpNudgeDays2?: number;
    rsvpNudgeDays3?: number;
    tagline?: string | null;
    description?: string | null;
    inviteEmailSubject?: string | null;
    inviteEmailBody?: string | null;
    timezone?: string;
  }
) {
  const patch: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0 || trimmed.length > NAME_MAX) {
      throw err('VALIDATION_ERROR', `Community name must be 1–${NAME_MAX} characters`);
    }
    patch.name = trimmed;
  }

  if (input.attendanceWindowHours !== undefined) {
    if (
      !Number.isInteger(input.attendanceWindowHours) ||
      input.attendanceWindowHours < 1 ||
      input.attendanceWindowHours > 720
    ) {
      throw err('INVALID_VALUE', 'attendance_window_hours must be an integer between 1 and 720');
    }
    patch.attendance_window_hours = input.attendanceWindowHours;
  }

  if (input.rsvpClosureDaysDefault !== undefined) {
    if (
      !Number.isInteger(input.rsvpClosureDaysDefault) ||
      input.rsvpClosureDaysDefault < 0 ||
      input.rsvpClosureDaysDefault > 90
    ) {
      throw err('INVALID_VALUE', 'rsvp_closure_days_default must be an integer between 0 and 90');
    }
    patch.rsvp_closure_days_default = input.rsvpClosureDaysDefault;
  }

  if (input.rsvpNudgeDays1 !== undefined) {
    if (
      !Number.isInteger(input.rsvpNudgeDays1) ||
      input.rsvpNudgeDays1 < 0 ||
      input.rsvpNudgeDays1 > 90
    ) {
      throw err('INVALID_VALUE', 'rsvp_nudge_days_1 must be an integer between 0 and 90');
    }
    patch.rsvp_nudge_days_1 = input.rsvpNudgeDays1;
  }

  if (input.rsvpNudgeDays2 !== undefined) {
    if (
      !Number.isInteger(input.rsvpNudgeDays2) ||
      input.rsvpNudgeDays2 < 0 ||
      input.rsvpNudgeDays2 > 90
    ) {
      throw err('INVALID_VALUE', 'rsvp_nudge_days_2 must be an integer between 0 and 90');
    }
    patch.rsvp_nudge_days_2 = input.rsvpNudgeDays2;
  }

  if (input.rsvpNudgeDays3 !== undefined) {
    if (
      !Number.isInteger(input.rsvpNudgeDays3) ||
      input.rsvpNudgeDays3 < 0 ||
      input.rsvpNudgeDays3 > 90
    ) {
      throw err('INVALID_VALUE', 'rsvp_nudge_days_3 must be an integer between 0 and 90');
    }
    patch.rsvp_nudge_days_3 = input.rsvpNudgeDays3;
  }

  if (input.tagline !== undefined) {
    if (input.tagline !== null && input.tagline.length > TAGLINE_MAX) {
      throw err('VALIDATION_ERROR', `Tagline must be ${TAGLINE_MAX} characters or fewer`);
    }
    patch.tagline = input.tagline;
  }

  if (input.description !== undefined) {
    if (input.description !== null && input.description.length > DESCRIPTION_MAX) {
      throw err('VALIDATION_ERROR', `Description must be ${DESCRIPTION_MAX} characters or fewer`);
    }
    patch.description = input.description;
  }

  if (input.inviteEmailSubject !== undefined) {
    if (input.inviteEmailSubject !== null && input.inviteEmailSubject.length > INVITE_EMAIL_SUBJECT_MAX) {
      throw err('VALIDATION_ERROR', `Invitation email subject must be ${INVITE_EMAIL_SUBJECT_MAX} characters or fewer`);
    }
    patch.invite_email_subject = input.inviteEmailSubject;
  }

  if (input.inviteEmailBody !== undefined) {
    if (input.inviteEmailBody !== null && input.inviteEmailBody.length > INVITE_EMAIL_BODY_MAX) {
      throw err('VALIDATION_ERROR', `Invitation email body must be ${INVITE_EMAIL_BODY_MAX} characters or fewer`);
    }
    patch.invite_email_body = input.inviteEmailBody;
  }

  if (input.timezone !== undefined) {
    if (!VALID_TIMEZONES.has(input.timezone)) {
      throw err('VALIDATION_ERROR', 'timezone must be a valid IANA timezone name');
    }
    patch.timezone = input.timezone;
  }

  if (Object.keys(patch).length === 0) {
    throw err('NO_FIELDS', 'No updatable fields provided');
  }

  const { data, error } = await serviceClient()
    .from('tenants')
    .update(patch)
    .eq('id', tenantId)
    .select('id, name, attendance_window_hours, rsvp_closure_days_default, rsvp_nudge_days_1, rsvp_nudge_days_2, rsvp_nudge_days_3, logo_url, tagline, description, invite_email_subject, invite_email_body, timezone')
    .single();

  if (error) throw error;
  return data;
}

export async function uploadTenantLogo(tenantId: string, file: File): Promise<string> {
  if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
    throw err('VALIDATION_ERROR', 'Logo must be a PNG or JPEG image');
  }
  if (file.size > LOGO_MAX_BYTES) {
    throw err('VALIDATION_ERROR', 'Logo must be 2 MB or smaller');
  }

  const path = `${tenantId}/logo`;
  const supa = serviceClient();

  const { error: uploadError } = await supa.storage
    .from('tenant-logos')
    .upload(path, file, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) throw err('VALIDATION_ERROR', uploadError.message);

  const { data: urlData } = supa.storage.from('tenant-logos').getPublicUrl(path);
  const logoUrl = `${urlData.publicUrl}?v=${Date.now()}`;

  const { error: dbError } = await supa
    .from('tenants')
    .update({ logo_url: logoUrl })
    .eq('id', tenantId);

  if (dbError) throw dbError;

  return logoUrl;
}
