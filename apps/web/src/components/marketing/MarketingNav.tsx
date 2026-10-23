import Link from 'next/link'
import type { ReactNode } from 'react'

import { Container, SkipLink, Wordmark } from '@/components/ui'

import { GetStartedButton } from './GetStartedButton'
import { SignInLink } from './SignInLink'

// Every text link in the bar, Sign in included: 14px Manrope medium that darkens on hover.
// Touch: each link grows to a 40px target (DESIGN.md §4b); desktop keeps the tight row.
const TEXT_LINK_CLASS =
    'inline-flex items-center pointer-coarse:min-h-10 font-body font-medium text-[14px] leading-none no-underline whitespace-nowrap rounded-sm focus-ring transition-colors duration-150 ease-solkey'

/** A section link: hidden on phones (the bar keeps only Sign in and the CTA there), underlined in cyan when it is the page. */
function sectionLinkClass(current: boolean): string {
    return [
        TEXT_LINK_CLASS,
        'max-md:hidden',
        // The underline adds 7px under the text (pb-1 plus the 3px rule); the same 7px on top keeps
        // the label on its neighbours' line.
        current ? 'text-on-surface pt-1.75 pb-1 border-b-3 border-primary-container' : 'text-on-surface-variant hover:text-on-surface',
    ].join(' ')
}

interface MarketingNavProps {
    /**
     * The section links: the landing page's own (`landing`: its How it works and Features
     * anchors, and the pricing page), or the same set on /pricing (`pricing`: the anchors point
     * back to the landing page, and Pricing is marked as the page you are on).
     */
    sectionLinks?: 'landing' | 'pricing'
    /** The get-started CTA's `location` for analytics. */
    ctaLocation?: string
    /** Right-hand actions in place of sign-in + the get-started CTA (the legal pages' way back, the shared page's one CTA). */
    children?: ReactNode
}

/**
 * The public pages' sticky top bar, the page's banner: the home-linked wordmark on the left,
 * the page's actions on the right, on the marketing grid. Its first stop is the skip link (to
 * the page's main#content), so keyboard users needn't tab through the bar on every page. The
 * session-dependent parts are client islands, so it renders in server and client pages alike.
 */
export function MarketingNav({ sectionLinks, ctaLocation = 'nav', children }: MarketingNavProps) {
    const onPricing = sectionLinks === 'pricing'
    // On the landing page the anchors are same-page; from /pricing they lead home to the section.
    const anchor = (id: string) => (onPricing ? `/#${id}` : `#${id}`)
    return (
        <header className="sticky top-0 z-(--z-sticky) bg-surface-container-low/85 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
            <SkipLink />
            <nav aria-label="Primary">
                <Container width="marketing" className="py-4 sm:py-5 flex justify-between items-center gap-3">
                    <Link
                        href="/"
                        className="no-underline inline-flex items-center pointer-coarse:min-h-10 rounded-sm focus-ring"
                        aria-label="Solkey home">
                        <Wordmark size={28} />
                    </Link>
                    {/* At least the CTA's height (--control-md), so the bar is one height whatever the page puts here (a quiet link, a CTA). */}
                    <div className="flex items-center gap-4 sm:gap-6 min-h-(--control-md)">
                        {sectionLinks && (
                            <>
                                {/* Plain <a>: a same-page anchor has no route to navigate, and from /pricing it is a full jump home. */}
                                <a href={anchor('how')} className={sectionLinkClass(false)}>
                                    How it works
                                </a>
                                <a href={anchor('features')} className={sectionLinkClass(false)}>
                                    Features
                                </a>
                                <Link href="/pricing" aria-current={onPricing ? 'page' : undefined} className={sectionLinkClass(onPricing)}>
                                    Pricing
                                </Link>
                            </>
                        )}
                        {children ?? (
                            <>
                                <SignInLink className={`${TEXT_LINK_CLASS} text-on-surface-variant hover:text-on-surface`}>
                                    Sign in
                                </SignInLink>
                                <GetStartedButton location={ctaLocation} />
                            </>
                        )}
                    </div>
                </Container>
            </nav>
        </header>
    )
}
