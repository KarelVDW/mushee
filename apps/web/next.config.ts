import type { NextConfig } from 'next'

// PostHog ingestion is reverse-proxied through /ingest so ad blockers don't
// silently drop analytics. EU cloud by default (GDPR: data stays in the EU).
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'
const POSTHOG_ASSETS_HOST = POSTHOG_HOST.replace('.i.posthog.com', '-assets.i.posthog.com')

// Baseline security headers. No CSP yet: Next's hydration scripts and
// PostHog's session replay both need nonce plumbing to pass a strict policy —
// tracked as a follow-up so a misconfigured CSP can't silently break
// recording or replay during the beta.
const securityHeaders = [
    // The microphone is the product; everything else is denied.
    { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=(), payment=()' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
]

const nextConfig: NextConfig = {
    // Next locks .next/dev per instance; a separate dist dir lets the e2e web
    // server (playwright.config) boot while the regular dev server is running.
    distDir: process.env.NEXT_DIST_DIR ?? '.next',
    rewrites() {
        return Promise.resolve([
            { source: '/ingest/static/:path*', destination: `${POSTHOG_ASSETS_HOST}/static/:path*` },
            { source: '/ingest/:path*', destination: `${POSTHOG_HOST}/:path*` },
        ])
    },
    headers() {
        return Promise.resolve([{ source: '/(.*)', headers: securityHeaders }])
    },
    // PostHog's API endpoints require the trailing slash to survive.
    skipTrailingSlashRedirect: true,
}

export default nextConfig
