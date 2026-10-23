import './globals.css'

import type { Metadata, Viewport } from 'next'
import { Geist_Mono, Manrope, Newsreader, Space_Grotesk } from 'next/font/google'

import { AuthGate } from '@/components/AuthGate'
import { HydrationMarker } from '@/components/HydrationMarker'
import { BRAND } from '@/lib/brandColors'
import { SITE_URL } from '@/lib/env'

import { Providers } from './providers'

const newsreader = Newsreader({
    variable: '--font-newsreader',
    subsets: ['latin'],
    style: ['normal', 'italic'],
    // The optical-size axis: Newsreader draws its display cut at headline sizes and its text
    // cut small (font-optical-sizing: auto, the default, picks per size).
    axes: ['opsz'],
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

export const metadata: Metadata = {
    metadataBase: new URL(SITE_URL),
    title: {
        default: 'Solkey',
        template: '%s — Solkey',
    },
    description:
        'Solkey turns what you play or sing into sheet music, live. Record a melody, watch the notation appear, and fix it in a simple editor.',
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
        description: 'Play or sing, and watch the sheet music appear in real time. Free to start.',
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Solkey — the fastest way to get a melody on the page',
        description: 'Play or sing, and watch the sheet music appear in real time. Free to start.',
    },
    robots: {
        index: true,
        follow: true,
    },
}

// Edge to edge (`viewportFit: 'cover'`) is the editor's alone for now (scores/[id]/layout.tsx): its
// header and dock pad themselves by env(safe-area-inset-*), while the other pages' chrome (the
// library's TopNav, the auth card, the cookie sheet, the marketing nav) does not yet, and would
// run under a landscape notch or an Android gesture bar. Once those pad their insets, cover can
// move here for every page.
export const viewport: Viewport = {
    themeColor: BRAND.surface,
}

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode
}>) {
    return (
        // The next/font family variables sit on <html>, beside :root, so the theme's
        // --font-body / --font-headline (theme.css) resolve for hand-written CSS too.
        <html lang="en" className={`${newsreader.variable} ${manrope.variable} ${spaceGrotesk.variable} ${geistMono.variable}`}>
            <body className="antialiased">
                <HydrationMarker />
                <Providers>
                    {children}
                    <AuthGate />
                </Providers>
            </body>
        </html>
    )
}
