import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    // The score model + notation renderer ship as TypeScript source; this app
    // compiles them along with its own code.
    transpilePackages: ['@mushee/notation', '@mushee/playback'],
    // ffmpeg-static resolves its binary path via __dirname, which bundling
    // rewrites to a phantom /ROOT path — keep it (and pg) as real requires.
    serverExternalPackages: ['ffmpeg-static', 'pg'],
    // eslint-disable-next-line @typescript-eslint/require-await -- Next's API is async
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    // Local-only tool — keep every crawler out. The microphone stays
                    // allowed: recording eval clips is this app's whole purpose.
                    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
                ],
            },
        ]
    },
}

export default nextConfig
