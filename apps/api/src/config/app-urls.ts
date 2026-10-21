/**
 * Public origins of the apps the API links to or accepts requests from.
 * Decorator-free so better-auth's config and tsx scripts can import it
 * outside Nest DI. Read per call: env vars are the source of truth.
 */

/** The web app's dev-server origin, the fallback when no origin is configured. */
export const DEV_WEB_ORIGIN = 'http://localhost:3200'

/** Public base URL of the web app, for billing redirects and email links. */
export function webAppUrl(): string {
    return (process.env.WEB_APP_URL ?? process.env.CORS_ORIGIN ?? DEV_WEB_ORIGIN).replace(/\/$/, '')
}

/** Public base URL of the standalone admin console (apps/admin). */
export function adminAppUrl(): string {
    return (process.env.ADMIN_APP_URL ?? 'http://localhost:3500').replace(/\/$/, '')
}
