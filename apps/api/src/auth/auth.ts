import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString:
    process.env.POSTGRES_URL ??
    `postgres://${process.env.POSTGRES_USER ?? 'mushee'}:${process.env.POSTGRES_PASSWORD ?? 'mushee'}@${process.env.POSTGRES_HOST ?? 'localhost'}:${process.env.POSTGRES_PORT ?? '5432'}/${process.env.POSTGRES_DB ?? 'mushee'}`,
});

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:4000',
  trustedOrigins: [
    ...(process.env.TRUSTED_ORIGINS?.split(',') ?? []),
    ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:3000'] : []),
  ],
  database: pool,
  emailAndPassword: {
    enabled: true,
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
});
