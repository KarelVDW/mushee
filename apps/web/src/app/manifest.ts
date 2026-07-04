import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Sheemu',
        short_name: 'Sheemu',
        description: 'The fastest way to get a melody on the page — live audio-to-notation sheet music editing.',
        start_url: '/scores',
        display: 'standalone',
        background_color: '#f6f6f6',
        theme_color: '#f6f6f6',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
    }
}
