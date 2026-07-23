import './globals.css'

import type { Metadata, Viewport } from 'next'
import { Geist_Mono, Manrope, Space_Grotesk } from 'next/font/google'

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
        default: 'Solkey Admin',
        template: '%s · Solkey Admin',
    },
    description: 'Operations console for Solkey.',
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
                <Providers>{children}</Providers>
            </body>
        </html>
    )
}
