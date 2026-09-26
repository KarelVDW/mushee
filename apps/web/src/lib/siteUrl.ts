/**
 * The public origin of this deployment, for canonical URLs, Open Graph, robots and the sitemap.
 * One fallback chain for every consumer: an explicit site URL, else the app URL a preview or
 * staging deploy sets, else production.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://solkey.io'
