import { betterAuth } from 'better-auth';
import { emailOTP } from 'better-auth/plugins/email-otp';
import { Pool } from 'pg';

import { mailService } from '../mail/mail.service';

const pool = new Pool({
  connectionString:
    process.env.POSTGRES_URL ??
    `postgres://${process.env.POSTGRES_USER ?? 'mushee'}:${process.env.POSTGRES_PASSWORD ?? 'mushee'}@${process.env.POSTGRES_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? '5632'}/${process.env.POSTGRES_DB ?? 'mushee'}`,
});

const trustedOrigins = [
  ...(process.env.TRUSTED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3200'] : []),
];

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:4200',
  trustedOrigins,
  database: pool,
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      await mailService.sendPasswordResetEmail(user.email, url);
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async (
        { user, newEmail, url }: { user: { email: string }; newEmail: string; url: string; token: string },
      ) => {
        await mailService.sendChangeEmailVerification(user.email, url, newEmail);
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
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== 'email-verification') return;
        await mailService.sendVerificationCode(email, otp);
      },
    }),
  ],
});
