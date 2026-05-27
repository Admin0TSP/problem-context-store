/**
 * Email sender.
 *
 * Strategy:
 *   - If RESEND_API_KEY is set, send via Resend.
 *   - Otherwise, log the email body to the server console.
 *
 * The console fallback is critical for dev: it means you can sign in with
 * a magic link without configuring any external service.
 */

import { Resend } from 'resend';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

let resend: Resend | null = null;
function getResend() {
  if (resend) return resend;
  if (!process.env.RESEND_API_KEY) return null;
  resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const FROM = process.env.EMAIL_FROM || 'Problem Context Store <onboarding@resend.dev>';

export async function sendEmail({ to, subject, html, text }: SendEmailOptions) {
  const client = getResend();

  if (!client) {
    // Dev console fallback — print the email so the developer can copy the
    // magic link or invite link without configuring SMTP.
    // eslint-disable-next-line no-console
    console.log(
      '\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
        '📬  EMAIL (console fallback — set RESEND_API_KEY to actually send)\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
        `  To:      ${to}\n` +
        `  Subject: ${subject}\n` +
        '  ───────────────────────────────────────────────\n' +
        (text || stripHtml(html)) +
        '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n',
    );
    return { ok: true, mode: 'console' as const };
  }

  const { data, error } = await client.emails.send({
    from: FROM,
    to,
    subject,
    html,
    text,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error('Resend error:', error);
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return { ok: true, mode: 'resend' as const, id: data?.id };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
