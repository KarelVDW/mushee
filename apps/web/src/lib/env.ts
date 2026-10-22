/**
 * The public runtime config: every host this app reads from `NEXT_PUBLIC_*`, each with its
 * fallback defined once. Pure constants with no side effects — browser modules and
 * next.config.ts import this too, so anything that should run once per server (like the
 * missing-API-URL warning in s/[token]/page.tsx) stays out of here. Every read is spelled as
 * a literal `process.env.NEXT_PUBLIC_…` so Next can inline it at build time.
 */

/**
 * The public origin of this deployment, for canonical URLs, Open Graph, robots and the sitemap.
 * One fallback chain for every consumer: an explicit site URL, else the app URL a preview or
 * staging deploy sets, else production.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://solkey.io'

/** The API origin: REST calls, auth, recording audio. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4200'

/** The same origin on the WebSocket scheme (http → ws, https → wss), for the recording socket. */
export const API_WS_URL = API_URL.replace(/^http/, 'ws')

/** The PostHog project key; without one, analytics stay off entirely. */
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY

/** PostHog's ingestion host. EU cloud by default (GDPR: data stays in the EU). */
export const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

/**
 * The share token of a Solkey-owned example score (Frère Jacques), which the landing page's
 * "Hear an example" opens at /s/<token> so a visitor can hear a real score before signing up.
 * Per environment: the demo seeder publishes it locally, `pnpm -F @mushee/api example:publish`
 * everywhere else (production needs it set in the Vercel build env); unset = no example link.
 */
export const EXAMPLE_SHARE_TOKEN = process.env.NEXT_PUBLIC_EXAMPLE_SHARE_TOKEN || undefined
