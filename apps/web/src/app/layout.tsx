import './globals.css'

import type { Metadata, Viewport } from 'next'
import { Geist_Mono, Manrope, Newsreader, Space_Grotesk } from 'next/font/google'

import { AuthGate } from '@/components/AuthGate'

import { Providers } from './providers'

const newsreader = Newsreader({
    variable: '--font-newsreader',
    subsets: ['latin'],
    style: ['normal', 'italic'],
})

const manrope = Manrope({
    variable: '--font-manrope',
    subsets: ['latin'],
})

const spaceGrotesk = Space_Grotesk({
    variable: '--font-space-grotesk',
    subsets: ['latin'],
})

const geistMono = Geist_Mono({
    variable: '--font-geist-mono',
    subsets: ['latin'],
})

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://solkey.io'

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: {
        default: 'Solkey — the fastest way to get a melody on the page',
        template: '%s · Solkey',
    },
    description:
        'Solkey turns what you play or sing into clean sheet music, live. Record a melody, watch the notation appear, and polish it in a fast, keyboard-first editor.',
    applicationName: 'Solkey',
    keywords: [
        'sheet music editor',
        'music notation software',
        'audio to sheet music',
        'melody transcription',
        'hum to notation',
        'music transcription app',
        'score editor',
        'compose music online',
    ],
    openGraph: {
        type: 'website',
        siteName: 'Solkey',
        url: SITE_URL,
        title: 'Solkey — the fastest way to get a melody on the page',
        description: 'Play or sing, and watch clean sheet music appear in real time. Free to start.',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Solkey — the fastest way to get a melody on the page',
        description: 'Play or sing, and watch clean sheet music appear in real time. Free to start.',
    },
    robots: {
        index: true,
        follow: true,
    },
}

export const viewport: Viewport = {
    themeColor: '#f6f6f6',
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        <html lang="en">
            <body className={`${newsreader.variable} ${manrope.variable} ${spaceGrotesk.variable} ${geistMono.variable} antialiased`}>
                <Providers>
                    <AuthGate>{children}</AuthGate>
                </Providers>
            </body>
        </html>
    )
}
