import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://solkey.io'

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                // Authenticated app surface + analytics proxy: nothing to index.
                disallow: ['/scores', '/settings', '/onboarding', '/admin', '/beta', '/reset-password', '/ingest'],
            },
        ],
        sitemap: `${SITE_URL}/sitemap.xml`,
    }
}
