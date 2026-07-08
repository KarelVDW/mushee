import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { Pool } from 'pg';

import { adminEmails, isAdminEmail, isBetaMode, signupTierId, signupUserFields } from '../beta/beta-config';
import { postgresSsl } from '../database/postgres-ssl';
import { mailService } from '../mail/mail.service';

const pool = new Pool({
  connectionString:
    process.env.POSTGRES_URL ??
    `postgres://${process.env.POSTGRES_USER ?? 'mushee'}:${process.env.POSTGRES_PASSWORD ?? 'mushee'}@${process.env.POSTGRES_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? '5632'}/${process.env.POSTGRES_DB ?? 'mushee'}`,
  ssl: postgresSsl() || undefined,
});

const trustedOrigins = [
  ...(process.env.TRUSTED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3200'] : []),
];

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:4200',
  trustedOrigins,
  database: pool,
  // Production serves web and API on different hosts of one site (e.g.
  // sheemu.app + api.sheemu.app). The session cookie must be scoped to the
  // shared parent domain or the web middleware never sees it. Set
  // COOKIE_DOMAIN to that parent (e.g. '.sheemu.app'); leave unset for
  // same-host dev.
  ...(process.env.COOKIE_DOMAIN
    ? {
        advanced: {
          crossSubDomainCookies: {
            enabled: true,
            domain: process.env.COOKIE_DOMAIN,
          },
        },
      }
    : {}),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await mailService.sendPasswordResetEmail(user.email, url);
    },
  },
  user: {
    // Surfaced on session.user so both API guards and the web app can gate
    // on them without an extra round trip. Never client-writable.
    additionalFields: {
      role: { type: 'string', defaultValue: 'user', input: false },
      betaStatus: { type: 'string', required: false, input: false },
    },
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async (
        { user, newEmail, url }: { user: { email: string }; newEmail: string; url: string; token: string },
      ) => {
        await mailService.sendChangeEmailVerification(user.email, url, newEmail);
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Stamp role + beta status onto the row before insert so the very
        // first session already carries them.
        before: (user) => {
          const email = (user as { email?: string }).email ?? '';
          return Promise.resolve({ data: { ...user, ...signupUserFields(email) } });
        },
        // Provision the subscription row (beta tier while the beta runs) and
        // send the waitlist emails. Failures here must never block signup.
        after: async (user) => {
          try {
            const tierId = isAdminEmail(user.email) ? 'studio' : signupTierId();
            await pool.query(
              `INSERT INTO user_subscriptions ("userId", "tierId") VALUES ($1, $2)
               ON CONFLICT ("userId") DO NOTHING`,
              [user.id, tierId],
            );
            const betaStatus = (user as { betaStatus?: string | null }).betaStatus;
            if (isBetaMode() && betaStatus === 'pending') {
              await mailService.sendBetaWaitlistEmail(user.email, user.name);
              for (const admin of adminEmails()) {
                await mailService.sendBetaSignupNotification(admin, user.email, user.name);
              }
            }
          } catch (err) {
            console.error('post-signup provisioning failed', err);
          }
        },
      },
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      // A 6-digit code must not be guessable by hammering the verify
      // endpoint; after this many wrong attempts the code is invalidated
      // and a new one has to be requested.
      allowedAttempts: 5,
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== 'email-verification') return;
        await mailService.sendVerificationCode(email, otp);
      },
    }),
  ],
});
