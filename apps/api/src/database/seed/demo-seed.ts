import { Logger } from '@nestjs/common'
import { Client } from 'pg'

import { auth } from '../../auth/auth.config'
import { ADVISORY_LOCKS } from '../advisory-locks'
import { postgresSsl, postgresUrl } from '../postgres-connection'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demo-data'
import { ensureScore } from './seed-score'

/**
 * Seeds the demo accounts and their scores. Idempotent: existing users are
 * kept (their tier is re-asserted), existing scores are left untouched, so
 * it is safe to run on every boot and from multiple API replicas at once
 * (an advisory lock serializes concurrent seeders).
 *
 * Users are created through better-auth's own server API so password hashing
 * and account rows always match what the auth layer expects; everything else
 * is plain SQL against the tables the migrations created.
 *
 * Runs on boot when SEED_DEMO_DATA=true (docker-compose / the local k8s
 * overlay), or explicitly via `pnpm db:seed`.
 */
export async function seedDemoData(): Promise<void> {
    const logger = new Logger('DemoSeed')
    const client = new Client({ connectionString: postgresUrl(), ssl: postgresSsl() || undefined })
    await client.connect()
    try {
        // One seeder at a time; replicas that lose the race wait, then find the
        // rows already present and no-op.
        await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCKS.demoSeed])
        for (const account of DEMO_ACCOUNTS) {
            const userId = await ensureUser(client, account.email, account.name, account.role)
            await client.query(
                `INSERT INTO user_subscriptions ("userId", "tierId") VALUES ($1, $2)
         ON CONFLICT ("userId") DO UPDATE SET "tierId" = EXCLUDED."tierId", "updatedAt" = now()`,
                [userId, account.tierId],
            )
            // Demo users skip the first-login onboarding wizard.
            await client.query(
                `INSERT INTO user_onboarding ("userId", "completedAt") VALUES ($1, now())
         ON CONFLICT ("userId") DO NOTHING`,
                [userId],
            )
            for (const scoreId of account.scoreIds) {
                await ensureScore(client, userId, scoreId)
            }
            logger.log(`Seeded ${account.email} (${account.tierId})`)
        }
        logger.log(`Demo data ready — log in with any of ${DEMO_ACCOUNTS.map((a) => a.email).join(', ')} / ${DEMO_PASSWORD}`)
    } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCKS.demoSeed]).catch(() => {})
        await client.end()
    }
}

/** Find or create the user, returning its id. Email is marked verified so
 *  demo logins never hit the OTP flow, and beta status is pre-approved so
 *  the demo accounts work even with BETA_MODE=true. */
async function ensureUser(client: Client, email: string, name: string, role?: 'admin'): Promise<string> {
    const existing = await client.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email])
    if (existing.rows.length === 0) {
        await auth.api.signUpEmail({
            body: { email, name, password: DEMO_PASSWORD },
        })
    }
    const { rows } = await client.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email])
    if (rows.length === 0) throw new Error(`Demo user ${email} was not created`)
    await client.query(
        `UPDATE "user"
     SET "emailVerified" = true,
         "betaStatus" = CASE WHEN "betaStatus" IS NULL THEN NULL ELSE 'approved' END,
         "role" = $2
     WHERE id = $1`,
        [rows[0].id, role ?? 'user'],
    )
    return rows[0].id
}
