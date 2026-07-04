import Link from 'next/link'
import type { ReactNode } from 'react'

import { Footer, Wordmark } from '@/components/ui'

/**
 * Shared chrome for public content pages (privacy, terms, contact): slim nav
 * back to the landing page, centered article column, standard footer.
 */
export function PublicPageShell({
    title,
    subtitle,
    children,
}: {
    title: string
    subtitle?: string
    children: ReactNode
}) {
    return (
        <div className="bg-surface min-h-screen flex flex-col">
            <nav className="sticky top-0 z-50 bg-[rgba(246,246,246,0.85)] backdrop-blur-xl">
                <div className="max-w-320 mx-auto px-8 py-5 flex justify-between items-center">
                    <Link href="/" className="no-underline">
                        <Wordmark size={28} />
                    </Link>
                    <Link href="/" className="font-body font-medium text-[14px] leading-none text-on-surface-variant no-underline">
                        ← Back to sheemu
                    </Link>
                </div>
            </nav>
            <main className="flex-1 w-full max-w-190 mx-auto px-8 pt-14 pb-20">
                <h1 className="font-display font-bold text-[44px] leading-[1.05] tracking-[-0.03em] text-on-surface m-0">{title}</h1>
                {subtitle && (
                    <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant mt-3 mb-0">{subtitle}</p>
                )}
                <article className="legal-prose mt-8">{children}</article>
            </main>
            <Footer />
        </div>
    )
}
