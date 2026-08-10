import nodemailer from 'nodemailer';

// DIP-FP-196-web: the first application-level email sender in this codebase
// (confirmed via full-repo search before writing this) — everything prior
// went through Supabase Auth's own SMTP configuration, entirely outside
// this app's reach. Configured against Mailtrap via plain SMTP env vars;
// real credentials are a genuine external prerequisite not covered by this
// DIP's code (see PR description) — Joseph provides these separately,
// locally and on Vercel.
//
// Required env vars: MAILTRAP_HOST, MAILTRAP_PORT, MAILTRAP_USER,
// MAILTRAP_PASS, MAILTRAP_FROM_EMAIL.
export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

function transporter() {
  return nodemailer.createTransport({
    host: process.env.MAILTRAP_HOST,
    port: Number(process.env.MAILTRAP_PORT ?? 587),
    // Mailtrap's live-send SMTP (as opposed to its sandbox/testing inbox)
    // uses STARTTLS on 587, not implicit TLS — secure: false is correct here,
    // not a downgrade; nodemailer still upgrades the connection via STARTTLS.
    secure: false,
    auth: {
      user: process.env.MAILTRAP_USER,
      pass: process.env.MAILTRAP_PASS,
    },
  });
}

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  if (!process.env.MAILTRAP_HOST || !process.env.MAILTRAP_USER || !process.env.MAILTRAP_PASS) {
    const err = new Error('Mailtrap credentials are not configured (MAILTRAP_HOST/MAILTRAP_USER/MAILTRAP_PASS)') as Error & { code: string };
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  await transporter().sendMail({
    from: process.env.MAILTRAP_FROM_EMAIL || 'no-reply@flockpulse.app',
    to,
    subject,
    html,
  });
}
