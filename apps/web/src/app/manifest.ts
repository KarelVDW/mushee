import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Solkey',
        short_name: 'Solkey',
        description: 'The fastest way to get a melody on the page — live audio-to-notation sheet music editing.',
        start_url: '/scores',
        display: 'standalone',
        background_color: '#f6f6f6',
        theme_color: '#f6f6f6',
        icons: [
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    }
}
