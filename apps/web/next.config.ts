import type { NextConfig } from 'next'

// PostHog ingestion is reverse-proxied through /ingest so ad blockers don't
// silently drop analytics. EU cloud by default (GDPR: data stays in the EU).
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'
const POSTHOG_ASSETS_HOST = POSTHOG_HOST.replace('.i.posthog.com', '-assets.i.posthog.com')

const nextConfig: NextConfig = {
    rewrites() {
        return Promise.resolve([
            { source: '/ingest/static/:path*', destination: `${POSTHOG_ASSETS_HOST}/static/:path*` },
            { source: '/ingest/:path*', destination: `${POSTHOG_HOST}/:path*` },
        ])
    },
    // PostHog's API endpoints require the trailing slash to survive.
    skipTrailingSlashRedirect: true,
}

export default nextConfig
