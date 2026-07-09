import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sheemu.com'

/** Public, indexable pages only — the app itself lives behind login. */
export default function sitemap(): MetadataRoute.Sitemap {
    return [
        { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
        { url: `${SITE_URL}/signup`, changeFrequency: 'monthly', priority: 0.8 },
        { url: `${SITE_URL}/login`, changeFrequency: 'monthly', priority: 0.5 },
        { url: `${SITE_URL}/contact`, changeFrequency: 'yearly', priority: 0.4 },
        { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
        { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    ]
}
