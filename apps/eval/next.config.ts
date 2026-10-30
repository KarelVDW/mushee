import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    // The workspace packages (the score model's Pitch for note names, the shared UI kit)
    // ship as TypeScript source; this app compiles them along with its own code.
    transpilePackages: ['@mushee/notation', '@mushee/ui'],
    headers() {
        return Promise.resolve([
            {
                source: '/:path*',
                headers: [
                    // Local-only tool — keep every crawler out. It only plays audio back, so
                    // no device permission is granted.
                    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
                ],
            },
        ])
    },
}

export default nextConfig
