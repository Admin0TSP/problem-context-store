/**
 * Auth.js v5 configuration.
 *
 *   Providers:
 *     - Email (magic link via custom sendVerificationRequest, see lib/email.ts)
 *     - Google OAuth — only registered if AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET are set
 *
 *   Strategy: database sessions (persisted in the `session` table) so we can
 *   revoke them server-side and so cookie tampering doesn't give access.
 *
 *   Adapter: @auth/prisma-adapter wired to the shared singleton from @pcs/db.
 */

import NextAuth, { type NextAuthConfig } from 'next-auth';
import Email from 'next-auth/providers/nodemailer';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@pcs/db';
import { sendEmail } from '@/lib/email';

const hasGoogle = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'database' },
  pages: {
    signIn: '/signin',
    verifyRequest: '/verify-request',
    error: '/auth-error',
  },
  providers: [
    Email({
      // We don't use Nodemailer's SMTP — we override the dispatch.
      // The `server` value is required by the provider but unused.
      server: { host: 'noop', port: 1, auth: { user: 'noop', pass: 'noop' } },
      from: process.env.EMAIL_FROM || 'Problem Context Store <onboarding@resend.dev>',
      maxAge: 60 * 15, // 15 minutes
      async sendVerificationRequest({ identifier: email, url }) {
        await sendEmail({
          to: email,
          subject: 'Your sign-in link for Problem Context Store',
          html: magicLinkHtml(email, url),
          text: `Sign in to Problem Context Store:\n\n${url}\n\nThis link expires in 15 minutes.`,
        });
      },
    }),
    ...(hasGoogle
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID!,
            clientSecret: process.env.AUTH_GOOGLE_SECRET!,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  callbacks: {
    // Expose the userId on the session object so server components / actions
    // can rely on `session.user.id` without re-querying.
    async session({ session, user }) {
      if (user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  trustHost: true,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

function magicLinkHtml(email: string, url: string) {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#fafaf9; padding:32px; color:#0f0f0d;">
    <div style="max-width:480px; margin:0 auto; background:white; border-radius:12px; padding:32px; border:1px solid #e7e7e2;">
      <p style="font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:#71716a; margin:0 0 8px;">Problem Context Store</p>
      <h1 style="font-size:20px; margin:0 0 12px;">Sign in to your workspace</h1>
      <p style="margin:0 0 24px; color:#3a3a35;">Click the button below to sign in as <strong>${escapeHtml(email)}</strong>. This link is valid for 15 minutes and can only be used once.</p>
      <a href="${url}" style="display:inline-block; background:#0f0f0d; color:white; padding:12px 20px; border-radius:8px; text-decoration:none; font-weight:500;">Sign in →</a>
      <p style="margin:32px 0 0; font-size:12px; color:#71716a;">If the button doesn't work, paste this URL into your browser:</p>
      <p style="word-break:break-all; font-size:12px; color:#71716a; font-family:'SF Mono', monospace; margin:4px 0 0;">${url}</p>
      <p style="margin:32px 0 0; font-size:12px; color:#71716a;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
