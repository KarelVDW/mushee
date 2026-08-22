import './globals.css'

import type { Metadata, Viewport } from 'next'
import { Geist_Mono, Manrope, Space_Grotesk } from 'next/font/google'
import Link from 'next/link'

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
    title: {
        default: 'Solkey Eval',
        template: '%s · Solkey Eval',
    },
    description: 'Corpus and benchmarking workbench for the recording pipeline.',
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
        <html lang="en">
            <body className={`${manrope.variable} ${spaceGrotesk.variable} ${geistMono.variable} antialiased`}>
                <Providers>
                    <div className="min-h-screen">
                        <header className="border-b border-outline-variant bg-surface-container-lowest">
                            <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
                                <Link href="/" className="font-display text-lg font-bold tracking-tight text-primary">
                                    Solkey Eval
                                </Link>
                                <Link href="/" className="font-label text-sm text-on-surface-variant hover:text-on-surface">
                                    Corpora
                                </Link>
                                <Link href="/reports" className="font-label text-sm text-on-surface-variant hover:text-on-surface">
                                    Reports
                                </Link>
                            </nav>
                        </header>
                        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
                    </div>
                </Providers>
            </body>
        </html>
    )
}
