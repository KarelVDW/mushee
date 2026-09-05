import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/lib/siteUrl'

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
                    // Defensive: the admin console and the API live on other hosts, but a
                    // misrouted path here must never be indexed either. /ingest is the analytics proxy.
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
