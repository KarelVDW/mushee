import Link from 'next/link'
import type { ReactNode } from 'react'

import { SkipLink, Wordmark } from '@/components/ui'

import { GetStartedButton } from './GetStartedButton'
import { SignInLink } from './SignInLink'

// Touch: each link grows to a 40px target (DESIGN.md §4b); desktop keeps the tight row.
const SECTION_LINK_CLASS =
    'inline-flex items-center pointer-coarse:min-h-10 font-body font-medium text-[14px] leading-none text-on-surface-variant hover:text-on-surface no-underline whitespace-nowrap rounded-sm focus-ring max-md:hidden'

interface MarketingNavProps {
    /** The landing page's own links: its How it works and Features sections, and the pricing page. */
    sectionLinks?: boolean
    /** The get-started CTA's `location` for analytics. */
    ctaLocation?: string
    /** Right-hand actions in place of sign-in + the get-started CTA (the legal pages' way back). */
    children?: ReactNode
}

/**
 * The public pages' sticky top bar: the home-linked wordmark on the left, the
 * page's actions on the right. Its first stop is the skip link (to the page's
 * main#content), so keyboard users needn't tab through the bar on every page.
 * The session-dependent parts are client islands, so it renders in server and
 * client pages alike.
 */
export function MarketingNav({ sectionLinks = false, ctaLocation = 'nav', children }: MarketingNavProps) {
    return (
        <nav aria-label="Primary" className="sticky top-0 z-(--z-sticky) bg-surface-container-low/85 backdrop-blur-xl">
            <SkipLink />
            <div className="max-w-320 mx-auto px-4 sm:px-8 py-4 sm:py-5 flex justify-between items-center gap-3">
                <Link
                    href="/"
                    className="no-underline inline-flex items-center pointer-coarse:min-h-10 rounded-sm focus-ring"
                    aria-label="Solkey home">
                    <Wordmark size={28} />
                </Link>
                <div className="flex items-center gap-4 sm:gap-6">
                    {sectionLinks && (
                        <>
                            {/* Same-page anchors: plain <a>, there is no route to navigate. */}
                            <a href="#how" className={SECTION_LINK_CLASS}>
                                How it works
                            </a>
                            <a href="#features" className={SECTION_LINK_CLASS}>
                                Features
                            </a>
                            <Link href="/pricing" className={SECTION_LINK_CLASS}>
                                Pricing
                            </Link>
                        </>
                    )}
                    {children ?? (
                        <>
                            <SignInLink>Sign in</SignInLink>
                            <GetStartedButton location={ctaLocation} />
                        </>
                    )}
                </div>
            </div>
        </nav>
    )
}
