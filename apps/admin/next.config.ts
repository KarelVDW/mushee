import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    // The score model + notation renderer ship as TypeScript source; this app
    // compiles them along with its own code.
    transpilePackages: ['@mushee/notation'],
    // eslint-disable-next-line @typescript-eslint/require-await -- Next's API is async
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    // The console is an internal tool — keep every crawler out.
                    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
                    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
                ],
            },
        ]
    },
}

export default nextConfig
