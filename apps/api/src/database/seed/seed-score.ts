import type { Client } from 'pg'

import { DEMO_SCORES } from './demo-data'

/**
 * Insert a seeded score's row + its edit-cache document (the idle flush writes it to storage
 * later, like any edited score). Existing rows (possibly edited since) are left as they are,
 * except that a public example gets its share token back: it is what the web app's example
 * link opens. Shared by the demo seeder and scripts/publish-example-score.ts, and free of the
 * auth config so a script can run it without the API's secrets.
 */
export async function ensureScore(client: Client, userId: string, scoreId: string): Promise<void> {
    const score = DEMO_SCORES[scoreId]
    if (!score) throw new Error(`No demo score defined for id ${scoreId}`)
    await client.query(
        `INSERT INTO scores (id, "userId", title, "storageKey", "shareToken") VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
        [scoreId, userId, score.title, `scores/${userId}/demo-${scoreId}.musicxml`, score.shareToken ?? null],
    )
    if (score.shareToken) {
        await client.query(`UPDATE scores SET "shareToken" = $2 WHERE id = $1 AND "shareToken" IS DISTINCT FROM $2`, [
            scoreId,
            score.shareToken,
        ])
    }
    await client.query(
        `INSERT INTO cached_scores ("scoreId", data) VALUES ($1, $2)
     ON CONFLICT ("scoreId") DO NOTHING`,
        [scoreId, JSON.stringify(score.document)],
    )
}
