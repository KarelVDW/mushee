'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { requestConsentSettings } from '@/lib/consent'

import { Avatar, PageTitle, SubHeadline, Wordmark } from './Brand'
import { PrimaryButton } from './Buttons'

const NAV_ITEMS = [
    { label: 'Library', href: '/scores' },
    { label: 'Settings', href: '/settings' },
] as const

interface TopNavProps {
    user?: string
    onCreate?: () => void
}

export function TopNav({ user, onCreate }: TopNavProps) {
    const pathname = usePathname()

    return (
        <nav className="sticky top-0 z-50 bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow">
            <div className="max-w-384 mx-auto px-4 sm:px-8 py-3.5 sm:py-4.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 sm:gap-6.5 min-w-0">
                    <Link href="/scores" className="no-underline max-[24rem]:hidden">
                        <Wordmark size={28} />
                    </Link>
                    <div className="flex items-center gap-4 sm:gap-5.5 sm:ml-4">
                        {NAV_ITEMS.map((n) => {
                            const active = pathname.startsWith(n.href)
                            return (
                                <Link
                                    key={n.label}
                                    href={n.href}
                                    aria-current={active ? 'page' : undefined}
                                    className={[
                                        'no-underline cursor-pointer font-body font-medium text-[14px] leading-none pb-1',
                                        'transition-colors duration-150 ease-solkey',
                                        active
                                            ? 'text-on-surface border-b-[3px] border-primary-container'
                                            : 'text-on-surface-variant border-b-[3px] border-transparent hover:text-on-surface',
                                    ].join(' ')}>
                                    {n.label}
                                </Link>
                            )
                        })}
                    </div>
                </div>
                <div className="flex items-center gap-2.5 sm:gap-3.5 shrink-0">
                    {onCreate && (
                        <>
                            {/* One CTA, two widths: the label costs too much room on a phone. */}
                            <span className="max-sm:hidden">
                                <PrimaryButton onClick={onCreate} icon="plus" emphasis="pop">
                                    New score
                                </PrimaryButton>
                            </span>
                            <span className="sm:hidden">
                                <PrimaryButton onClick={onCreate} icon="plus" emphasis="pop" ariaLabel="New score" />
                            </span>
                        </>
                    )}
                    <Link
                        href="/settings"
                        title={user}
                        aria-label="Account settings"
                        className="inline-flex no-underline rounded-full focus-ring">
                        <Avatar
                            name={user ?? 'You'}
                            size="sm"
                            tone="neutral"
                            className="hover:bg-surface-container-highest transition-colors duration-150 ease-solkey"
                        />
                    </Link>
                </div>
            </div>
        </nav>
    )
}

export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
    return (
        <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4.5 pb-4.5">
            <div className="flex flex-col gap-2">
                <PageTitle>{title}</PageTitle>
                {subtitle && <SubHeadline>{subtitle}</SubHeadline>}
            </div>
            {right}
        </div>
    )
}

interface FooterProps {
    /** `app` (1536px) for authenticated chrome, `marketing` (1280px) to line up with public-page content. */
    width?: 'app' | 'marketing'
}

export function Footer({ width = 'app' }: FooterProps) {
    const linkClass = 'font-body font-normal text-[12px] leading-none text-on-surface-variant no-underline hover:text-on-surface'
    return (
        <footer className="bg-surface py-6 border-t border-outline-variant/15">
            <div
                className={`${width === 'app' ? 'max-w-384' : 'max-w-320'} mx-auto px-8 flex justify-between items-center gap-6 flex-wrap`}>
                <Wordmark size={20} />
                <nav aria-label="Site" className="flex items-center gap-5 flex-wrap">
                    <Link href="/pricing" className={linkClass}>
                        Pricing
                    </Link>
                    <Link href="/privacy" className={linkClass}>
                        Privacy
                    </Link>
                    <Link href="/terms" className={linkClass}>
                        Terms
                    </Link>
                    <Link href="/contact" className={linkClass}>
                        Contact
                    </Link>
                    <button
                        type="button"
                        onClick={() => requestConsentSettings()}
                        className={`${linkClass} bg-transparent border-0 p-0 cursor-pointer`}>
                        Cookie settings
                    </button>
                </nav>
                {/* The year is computed at render: prerendered pages show the build year until the next
                    deploy, and suppressHydrationWarning covers a server/client mismatch across New Year. */}
                <span
                    suppressHydrationWarning
                    className="font-body font-normal text-[12px] leading-none text-on-surface-variant whitespace-nowrap">
                    © {new Date().getFullYear()} Solkey.
                </span>
            </div>
        </footer>
    )
}
