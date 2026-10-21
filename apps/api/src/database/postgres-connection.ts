/**
 * How the API reaches Postgres. Every connection goes through here — the
 * TypeORM data source, better-auth's pg.Pool and the demo seeder — so they
 * can never connect to different databases or with different TLS settings.
 * Decorator-free, so tsx scripts can import it outside Nest.
 */

/**
 * The connection URL: POSTGRES_URL when set, else one assembled from
 * POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_HOST / POSTGRES_PORT /
 * POSTGRES_DB with the local dev defaults. Credentials are percent-encoded so
 * a password containing '@', ':' or '/' still parses.
 */
export function postgresUrl(): string {
    if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL
    // The mushee:mushee@localhost fallbacks exist for local dev only; a
    // production pod that reaches them is misconfigured (Secret not mounted) and
    // must not sit in a crash-loop of connection errors that looks like a DB
    // outage.
    if (process.env.NODE_ENV === 'production' && !process.env.POSTGRES_PASSWORD) {
        throw new Error('POSTGRES_URL or POSTGRES_PASSWORD must be set in production — refusing to fall back to the local dev credentials.')
    }
    const user = process.env.POSTGRES_USER ?? 'mushee'
    const password = process.env.POSTGRES_PASSWORD ?? 'mushee'
    const host = process.env.POSTGRES_HOST ?? 'localhost'
    const port = process.env.POSTGRES_PORT ?? '5632'
    const db = process.env.POSTGRES_DB ?? 'mushee'
    return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(db)}`
}

/**
 * TLS settings for every connection.
 *
 * POSTGRES_SSL:
 *  - unset / 'false'   → plaintext (local dev, docker-compose)
 *  - 'require' / 'true' → encrypted, certificate NOT verified (managed-DB
 *                         default; equivalent to libpq sslmode=require)
 *  - 'verify'           → encrypted + verified: against POSTGRES_SSL_CA
 *                         (inline PEM) when set, else the system CA bundle
 */
export function postgresSsl(): false | { rejectUnauthorized: boolean; ca?: string } {
    const mode = (process.env.POSTGRES_SSL ?? 'false').trim().toLowerCase()
    if (mode === '' || mode === 'false') return false
    if (mode === 'verify') {
        return { rejectUnauthorized: true, ca: process.env.POSTGRES_SSL_CA }
    }
    return { rejectUnauthorized: false }
}
