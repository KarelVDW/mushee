import './globals.css'

import type { Metadata, Viewport } from 'next'
import { Geist_Mono, Manrope, Space_Grotesk } from 'next/font/google'

import { Shell } from '@/components/Shell'

import { Providers } from './providers'

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
    title: { default: 'Solkey Eval', template: '%s — Solkey Eval' },
    description: 'Benchmark results, the score timeline and the test corpus of the recording pipeline.',
    robots: {
        index: false,
        follow: false,
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
        // The next/font family variables sit on <html>, beside :root, so the theme's
        // --font-body / --font-headline (theme.css) resolve for hand-written CSS too.
        <html lang="en" className={`${manrope.variable} ${spaceGrotesk.variable} ${geistMono.variable}`}>
            <body className="antialiased">
                <Providers>
                    <Shell>{children}</Shell>
                </Providers>
            </body>
        </html>
    )
}
