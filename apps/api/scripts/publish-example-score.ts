/**
 * Publish Solkey's example score — Frère Jacques, public at /s/solkey-example-frere-jacques —
 * in an environment that doesn't run the demo seeder (production, staging), so the landing
 * page's "Hear an example" has a score to open:
 *
 *   POSTGRES_URL=… POSTGRES_SSL=require pnpm -F @mushee/api example:publish <owner email>
 *
 * The owner is an existing account: sign Solkey's own account up through the app first (a
 * dedicated one, so the example stays out of anyone's library). This script never creates
 * users or passwords. Idempotent, like the demo seeder it shares its insert with
 * (src/database/seed/seed-score.ts): rows already there are left as they are. Afterwards set
 * NEXT_PUBLIC_EXAMPLE_SHARE_TOKEN to the printed token in the web app's build env (Vercel bakes
 * NEXT_PUBLIC_* in at build time, so redeploy).
 */
import { Client } from 'pg'

import { postgresSsl, postgresUrl } from '../src/database/postgres-connection'
import { EXAMPLE_SCORE_ID, EXAMPLE_SHARE_TOKEN } from '../src/database/seed/demo-data'
import { ensureScore } from '../src/database/seed/seed-score'

async function main(ownerEmail: string | undefined): Promise<void> {
    if (!ownerEmail) throw new Error('Usage: pnpm example:publish <owner email> (an existing account, e.g. Solkey’s own)')
    const client = new Client({ connectionString: postgresUrl(), ssl: postgresSsl() || undefined })
    await client.connect()
    try {
        const owner = await client.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email) = lower($1)', [ownerEmail])
        if (owner.rows.length === 0) throw new Error(`No account for ${ownerEmail} — sign it up through the app first`)
        const ownerId = owner.rows[0].id
        const existing = await client.query<{ userId: string }>('SELECT "userId" FROM scores WHERE id = $1', [EXAMPLE_SCORE_ID])
        if (existing.rows.length > 0 && existing.rows[0].userId !== ownerId) {
            throw new Error(`The example score already belongs to account ${existing.rows[0].userId}; leaving it as it is`)
        }
        await ensureScore(client, ownerId, EXAMPLE_SCORE_ID)
    } finally {
        await client.end()
    }
    console.log(`Frère Jacques is public at /s/${EXAMPLE_SHARE_TOKEN} (owner ${ownerEmail}).`)
    console.log(`Next: set NEXT_PUBLIC_EXAMPLE_SHARE_TOKEN=${EXAMPLE_SHARE_TOKEN} in the web app's build env and redeploy it.`)
}

main(process.argv[2]).then(
    () => process.exit(0),
    (error) => {
        console.error(error instanceof Error ? error.message : error)
        process.exit(1)
    },
)
