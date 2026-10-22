import Link from 'next/link'
import type { ReactNode } from 'react'

import { MarketingNav } from '@/components/marketing/MarketingNav'
import { Eyebrow, Footer, Icon } from '@/components/ui'

interface PublicPageShellProps {
    title: string
    subtitle?: string
    /** Designed content above the article (the contact cards, a legal page's short version), kept out of the legal-prose styles. */
    lead?: ReactNode
    /** The page's prose (the legal text); a page made only of designed blocks leaves it out. */
    children?: ReactNode
}

/**
 * Shared chrome for public content pages (privacy, terms, contact): the
 * marketing nav with a way back to the landing page, centered article
 * column, standard footer. The <main> is the skip link's target.
 */
export function PublicPageShell({ title, subtitle, lead, children }: PublicPageShellProps) {
    return (
        <div className="bg-surface min-h-dvh flex flex-col">
            <MarketingNav>
                <Link
                    href="/"
                    className="inline-flex items-center gap-1.5 font-body font-medium text-[14px] leading-none text-on-surface-variant no-underline hover:text-on-surface transition-colors duration-150 ease-solkey focus-ring pointer-coarse:min-h-10">
                    <Icon name="arrow-left" size={14} />
                    Back to Solkey
                </Link>
            </MarketingNav>
            <main id="content" className="flex-1 w-full max-w-190 mx-auto px-5 sm:px-8 pt-14 pb-20">
                <h1 className="font-display font-bold text-[32px] sm:text-[44px] leading-[1.05] tracking-[-0.03em] text-on-surface m-0">
                    {title}
                </h1>
                {subtitle && (
                    <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant mt-3 mb-0">{subtitle}</p>
                )}
                {/* .legal-prose is unlayered CSS: inside it, it beats Tailwind's utilities, so designed blocks go above. */}
                {lead && <div className="mt-8">{lead}</div>}
                {children != null && <article className="legal-prose mt-8">{children}</article>}
            </main>
            <Footer width="marketing" />
        </div>
    )
}

interface ShortVersionProps {
    /** What a normal person wants to know, one plain sentence each. */
    points: readonly string[]
    /** The closing line that says which text binds ("The full policy below is the one that counts."). */
    closing: string
    /** The page's sections, for the "On this page" list: each h2's id and its title. */
    sections: readonly { id: string; title: string }[]
}

/**
 * A legal page's opening: "The short version" in a few plain lines, then an "On this page"
 * list of anchor links to its sections. For PublicPageShell's `lead`; the full text below
 * stays the binding one.
 */
export function ShortVersion({ points, closing, sections }: ShortVersionProps) {
    return (
        <div className="flex flex-col gap-6">
            <section aria-labelledby="short-version" className="bg-surface-container-lowest rounded-lg p-6 flex flex-col gap-4">
                <h2
                    id="short-version"
                    className="font-headline font-semibold text-[20px] leading-[1.2] tracking-[-0.01em] text-on-surface m-0">
                    The short version
                </h2>
                <ul className="m-0 pl-5 flex flex-col gap-2.5 font-body font-normal text-[16px] leading-[1.55] text-on-surface list-disc">
                    {points.map((point) => (
                        <li key={point}>{point}</li>
                    ))}
                </ul>
                <p className="m-0 font-body font-normal text-[14px] leading-normal text-on-surface-variant">{closing}</p>
            </section>
            <nav aria-label="On this page" className="flex flex-col gap-2">
                <Eyebrow>On this page</Eyebrow>
                <ul className="m-0 p-0 list-none flex flex-wrap gap-x-4 gap-y-1">
                    {sections.map((section) => (
                        <li key={section.id}>
                            <a
                                href={`#${section.id}`}
                                className="inline-flex items-center font-body font-normal text-[14px] leading-none text-primary underline py-1.5 pointer-coarse:min-h-10 focus-ring rounded-sm">
                                {section.title}
                            </a>
                        </li>
                    ))}
                </ul>
            </nav>
        </div>
    )
}
