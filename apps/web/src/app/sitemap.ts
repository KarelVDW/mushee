import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://solkey.io'

type PublicRoute = {
    path: string
    changeFrequency: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>
    priority: number
}

/**
 * Public, indexable pages only — the app itself lives behind login, share
 * links are noindex, and the admin console is a separate host. Keep this in
 * step with the `disallow` list in ./robots.ts.
 */
const PUBLIC_ROUTES: readonly PublicRoute[] = [
    { path: '/', changeFrequency: 'weekly', priority: 1 },
    { path: '/pricing', changeFrequency: 'monthly', priority: 0.9 },
    { path: '/signup', changeFrequency: 'monthly', priority: 0.8 },
    { path: '/login', changeFrequency: 'monthly', priority: 0.5 },
    { path: '/contact', changeFrequency: 'yearly', priority: 0.4 },
    { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
    { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
]

export default function sitemap(): MetadataRoute.Sitemap {
    const lastModified = new Date()
    return PUBLIC_ROUTES.map(({ path, changeFrequency, priority }) => ({
        url: `${SITE_URL}${path}`,
        lastModified,
        changeFrequency,
        priority,
    }))
}
