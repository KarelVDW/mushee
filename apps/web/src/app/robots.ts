import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://solkey.io'

/**
 * Crawl policy for the marketing site. Everything behind login, the share
 * links (`/s/…` — noindex per page), the admin console and any API/analytics
 * proxy paths are kept out of the index; the sitemap lists what is public.
 */
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: [
                    // Authenticated app surface.
                    '/scores',
                    '/settings',
                    '/onboarding',
                    '/beta',
                    '/reset-password',
                    // Share links are noindex; do not let crawlers enumerate them.
                    '/s/',
                    // Admin console and API/analytics proxies: nothing to index.
                    '/admin',
                    '/api',
                    '/ingest',
                ],
            },
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
        host: SITE_URL,
    }
}
