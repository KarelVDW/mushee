import Link from 'next/link'
import type { ReactNode } from 'react'

import { MarketingNav } from '@/components/marketing/MarketingNav'
import { Footer, Icon } from '@/components/ui'

interface PublicPageShellProps {
    title: string
    subtitle?: string
    /** Designed content above the article (the contact cards), kept out of the legal-prose styles. */
    lead?: ReactNode
    children: ReactNode
}

/**
 * Shared chrome for public content pages (privacy, terms, contact): the
 * marketing nav with a way back to the landing page, centered article
 * column, standard footer.
 */
export function PublicPageShell({ title, subtitle, lead, children }: PublicPageShellProps) {
    return (
        <div className="bg-surface min-h-dvh flex flex-col">
            <MarketingNav>
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 font-body font-medium text-[14px] leading-none text-on-surface-variant no-underline hover:text-on-surface transition-colors duration-150 ease-solkey focus-ring">
                    <Icon name="arrow-left" size={14} />
                    Back to Solkey
                </Link>
            </MarketingNav>
            <main className="flex-1 w-full max-w-190 mx-auto px-5 sm:px-8 pt-14 pb-20">
                <h1 className="font-display font-bold text-[32px] sm:text-[44px] leading-[1.05] tracking-[-0.03em] text-on-surface m-0">
                    {title}
                </h1>
                {subtitle && (
                    <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant mt-3 mb-0">{subtitle}</p>
                )}
                {/* .legal-prose is unlayered CSS: inside it, it beats Tailwind's utilities, so designed blocks go above. */}
                {lead && <div className="mt-8">{lead}</div>}
                <article className="legal-prose mt-8">{children}</article>
            </main>
            <Footer width="marketing" />
        </div>
    )
}
