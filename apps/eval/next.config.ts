import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    // The workspace packages (score model + notation renderer, playback engine,
    // shared UI kit) ship as TypeScript source; this app compiles them along with
    // its own code.
    transpilePackages: ['@mushee/notation', '@mushee/playback', '@mushee/ui'],
    // ffmpeg-static resolves its binary path via __dirname, which bundling
    // rewrites to a phantom /ROOT path — keep it (and pg) as real requires.
    serverExternalPackages: ['ffmpeg-static', 'pg'],
    headers() {
        return Promise.resolve([
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
        ])
    },
}

export default nextConfig
