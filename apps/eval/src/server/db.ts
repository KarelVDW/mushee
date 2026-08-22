/**
 * Postgres access for the eval app. Shares the API's database but owns the
 * `eval` schema outright — its own tables, its own migrations ledger — so
 * nothing here can interfere with apps/api's `public` schema or TypeORM
 * migrations table.
 */

import { Pool } from 'pg'

function buildPool(): Pool {
    if (process.env.POSTGRES_URL) return new Pool({ connectionString: process.env.POSTGRES_URL, max: 5 })
    return new Pool({
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: Number(process.env.POSTGRES_PORT ?? 5632),
        user: process.env.POSTGRES_USER ?? 'mushee',
        password: process.env.POSTGRES_PASSWORD ?? 'mushee',
        database: process.env.POSTGRES_DB ?? 'mushee',
        max: 5,
    })
}

/** Ordered, append-only. Each entry runs once, recorded in eval.migrations. */
const MIGRATIONS: Array<{ name: string; sql: string }> = [
    {
        name: '0001-initial',
        sql: `
            CREATE TABLE eval.corpus (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                kind TEXT NOT NULL,
                instrument_id TEXT,
                tier TEXT NOT NULL DEFAULT 'context',
                bpm INT NOT NULL,
                beats_per_measure INT NOT NULL DEFAULT 4,
                params JSONB NOT NULL,
                notes TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE eval.clip (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                corpus_id TEXT NOT NULL REFERENCES eval.corpus(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                seed INT NOT NULL,
                sort_order INT NOT NULL,
                melody JSONB NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                duration_sec REAL,
                recorded_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (corpus_id, name)
            );
            CREATE TABLE eval.transcription (
                id SERIAL PRIMARY KEY,
                clip_id TEXT NOT NULL REFERENCES eval.clip(id) ON DELETE CASCADE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                notes JSONB NOT NULL,
                measures JSONB,
                metrics JSONB,
                config JSONB
            );
            CREATE INDEX transcription_clip_idx ON eval.transcription (clip_id, created_at DESC);
            CREATE TABLE eval.run (
                id SERIAL PRIMARY KEY,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                label TEXT NOT NULL,
                scope TEXT,
                report_path TEXT,
                summary JSONB NOT NULL
            );
        `,
    },
]

async function migrate(pool: Pool): Promise<void> {
    const client = await pool.connect()
    try {
        // Serialize concurrent boots (dev server + a route both racing here).
        await client.query('SELECT pg_advisory_lock(727272)')
        await client.query('CREATE SCHEMA IF NOT EXISTS eval')
        await client.query(
            'CREATE TABLE IF NOT EXISTS eval.migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
        )
        const done = new Set(
            (await client.query<{ name: string }>('SELECT name FROM eval.migrations')).rows.map((r) => r.name),
        )
        for (const migration of MIGRATIONS) {
            if (done.has(migration.name)) continue
            await client.query('BEGIN')
            try {
                await client.query(migration.sql)
                await client.query('INSERT INTO eval.migrations (name) VALUES ($1)', [migration.name])
                await client.query('COMMIT')
            } catch (err) {
                await client.query('ROLLBACK')
                throw err
            }
        }
    } finally {
        await client.query('SELECT pg_advisory_unlock(727272)').catch(() => {})
        client.release()
    }
}

/** Survives Next dev-server HMR: one pool, migrated exactly once per process. */
const globalDb = globalThis as unknown as { __evalDb?: { pool: Pool; ready: Promise<void> } }

export function getDb(): { pool: Pool; ready: Promise<void> } {
    if (!globalDb.__evalDb) {
        const pool = buildPool()
        globalDb.__evalDb = { pool, ready: migrate(pool) }
    }
    return globalDb.__evalDb
}

export async function query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const { pool, ready } = getDb()
    await ready
    const result = await pool.query(sql, params)
    return result.rows as T[]
}
