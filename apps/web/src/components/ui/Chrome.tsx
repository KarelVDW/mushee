'use client'

import { Avatar, PageTitle, PrimaryButton, SubHeadline, Wordmark } from '@mushee/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type MouseEvent, type ReactNode, useCallback, useRef, useState } from 'react'

import { useSession } from '@/lib/auth-client'
import { requestConsentSettings } from '@/lib/consent'
import { useSignOut } from '@/lib/queries'

import { Container } from './Container'
import { Popover } from './Popover'
import { Tooltip } from './Tooltip'

const NAV_ITEMS = [
    { label: 'Library', href: '/scores' },
    { label: 'Settings', href: '/settings' },
] as const

/**
 * The page's skip link: visually hidden until it takes keyboard focus, then a small card in
 * the top-left corner. Render it as the first focusable element of a shell. It moves focus to
 * the element with id `content`, or the page's <main> when there is none.
 */
export function SkipLink() {
    const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
        const target = document.getElementById('content') ?? document.querySelector('main')
        if (!target) return
        e.preventDefault()
        // A landmark isn't focusable by default; -1 lets it take focus without joining the Tab order.
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        target.classList.add('outline-none')
        target.focus()
    }
    return (
        <a
            href="#content"
            onClick={onClick}
            className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-(--z-toast) focus:px-4 focus:py-3 rounded-full bg-surface-container-lowest editorial-shadow font-label font-semibold text-[14px] leading-none text-on-surface no-underline focus-ring">
            Skip to content
        </a>
    )
}

interface TopNavProps {
    user?: string
    onCreate?: () => void
    /**
     * The New score CTA's emphasis: `pop` (default) with the magenta plate, or `flat` where the
     * page itself already leads with a pop CTA (the empty first-run library), so the screen
     * never shows two.
     */
    createEmphasis?: 'pop' | 'flat'
}

export function TopNav({ user, onCreate, createEmphasis = 'pop' }: TopNavProps) {
    const pathname = usePathname()

    return (
        <nav className="sticky top-0 z-(--z-sticky) bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow">
            <SkipLink />
            <Container width="app" className="py-3.5 sm:py-4.5 flex items-center justify-between gap-3">
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
                                        // A 40px+ hit area on touch without moving the underline: the pseudo-element grows, the text doesn't.
                                        'relative pointer-coarse:after:absolute pointer-coarse:after:-inset-x-2 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-[""]',
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
                                <PrimaryButton onClick={onCreate} icon="plus" emphasis={createEmphasis}>
                                    New score
                                </PrimaryButton>
                            </span>
                            <span className="sm:hidden">
                                <PrimaryButton onClick={onCreate} icon="plus" emphasis={createEmphasis} ariaLabel="New score" />
                            </span>
                        </>
                    )}
                    <AccountMenu user={user} />
                </div>
            </Container>
        </nav>
    )
}

/** The avatar's hover and open state: a soft identity ring, offset from the avatar on the nav's own tone. */
const AVATAR_RING =
    'hover:ring-2 hover:ring-secondary-soft hover:ring-offset-2 hover:ring-offset-surface-container-low aria-expanded:ring-2 aria-expanded:ring-secondary-soft aria-expanded:ring-offset-2 aria-expanded:ring-offset-surface-container-low'

/**
 * The avatar is the account menu (library-account-09): a small Popover with who is signed
 * in, a link to Settings and Sign out. Escape or a click outside closes it; focus moves in on
 * open and back to the avatar on close.
 */
function AccountMenu({ user }: { user?: string }) {
    const [open, setOpen] = useState(false)
    const anchorRef = useRef<HTMLDivElement>(null)
    const close = useCallback(() => setOpen(false), [])
    const { data: session } = useSession()
    const signOut = useSignOut()
    const name = session?.user?.name || user
    const email = session?.user?.email

    const rowClass =
        'flex items-center w-full min-h-10 px-3 rounded-md border-0 bg-transparent cursor-pointer no-underline text-left font-label font-semibold text-[14px] leading-none text-on-surface hover:bg-surface-container-high transition-colors duration-150 ease-solkey focus-ring'

    return (
        <div ref={anchorRef} className="relative">
            <Tooltip label="Account" side="bottom">
                <button
                    type="button"
                    aria-label="Account menu"
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    onClick={() => setOpen((o) => !o)}
                    className={`relative inline-flex rounded-full border-0 bg-transparent p-0 cursor-pointer focus-ring transition-shadow duration-150 ease-solkey ${AVATAR_RING} pointer-coarse:after:absolute pointer-coarse:after:-inset-0.5 pointer-coarse:after:content-[''] pointer-coarse:after:rounded-full`}>
                    <Avatar name={name ?? 'You'} size="sm" tone="soft" />
                </button>
            </Tooltip>
            {open && (
                <Popover
                    ariaLabel="Account menu"
                    title="Account"
                    anchorRef={anchorRef}
                    onDismiss={close}
                    manageFocus
                    viewportGutter={16}
                    className="right-0 top-[calc(100%+0.5rem)] w-64 max-w-[calc(100vw-2rem)] gap-3">
                    {(name || email) && (
                        <div className="flex flex-col gap-1 min-w-0">
                            {name && (
                                <span className="font-label font-semibold text-[15px] leading-tight text-on-surface truncate">{name}</span>
                            )}
                            {email && <span className="font-body text-[13px] leading-[1.4] text-on-surface-variant truncate">{email}</span>}
                        </div>
                    )}
                    <div className="flex flex-col -mx-1.5">
                        <Link href="/settings" onClick={close} className={rowClass}>
                            Settings
                        </Link>
                        <button type="button" onClick={() => void signOut('/login')} className={rowClass}>
                            Sign out
                        </button>
                    </div>
                </Popover>
            )}
        </div>
    )
}

interface PageHeaderProps {
    title: ReactNode
    subtitle?: ReactNode
    /** The controls beside the heading on wide screens, and on their own row under it on a phone. */
    right?: ReactNode
    /** One quiet action on the title's own row, at its far end (a phone's lone 'Import a file'), so no row holds it alone. */
    titleAction?: ReactNode
}

export function PageHeader({ title, subtitle, right, titleAction }: PageHeaderProps) {
    return (
        <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4.5 pb-4.5">
            <div className="flex flex-col gap-2">
                {titleAction ? (
                    <div className="flex items-baseline justify-between gap-3">
                        <PageTitle>{title}</PageTitle>
                        {titleAction}
                    </div>
                ) : (
                    <PageTitle>{title}</PageTitle>
                )}
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

const SITE_LINKS = [
    { label: 'Pricing', href: '/pricing' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'Contact', href: '/contact' },
] as const

/**
 * The site footer. In the app it is one quiet 12px strip on the nav's grid; on the public pages
 * it closes the page properly — the 24px wordmark and the site links in two rows, the © line
 * under them, on the marketing grid.
 */
export function Footer({ width = 'app' }: FooterProps) {
    const marketing = width === 'marketing'
    const links = (linkClass: string, navClass: string) => (
        <nav aria-label="Site" className={navClass}>
            {SITE_LINKS.map(({ label, href }) => (
                <Link key={href} href={href} className={linkClass}>
                    {label}
                </Link>
            ))}
            <button
                type="button"
                onClick={() => requestConsentSettings()}
                className={`${linkClass} bg-transparent border-0 p-0 cursor-pointer`}>
                Cookie settings
            </button>
        </nav>
    )
    // The year is computed at render: prerendered pages show the build year until the next
    // deploy, and suppressHydrationWarning covers a server/client mismatch across New Year.
    const copyright = (size: string) => (
        <span suppressHydrationWarning className={`font-body font-normal ${size} leading-none text-on-surface-variant whitespace-nowrap`}>
            © {new Date().getFullYear()} Solkey.
        </span>
    )

    if (marketing) {
        // Touch: padding grows each 14px link to a 40px target (14px + 2 × 13px), the rows meeting edge to edge.
        const linkClass =
            'font-body font-normal text-[14px] leading-none text-on-surface-variant no-underline hover:text-on-surface transition-colors duration-150 ease-solkey pointer-coarse:py-3.25'
        return (
            <footer className="bg-surface border-t border-outline-variant/15">
                <Container width="marketing" className="pt-12 pb-10">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-8">
                        <Wordmark size={24} />
                        {links(linkClass, 'flex flex-wrap items-center gap-x-6 gap-y-3 pointer-coarse:gap-y-0')}
                    </div>
                    <div className="mt-10">{copyright('text-[13px]')}</div>
                </Container>
            </footer>
        )
    }

    // Touch: padding grows each link to a 40px target (12px text + 2 × 14px) and the row tightens to keep them on one line.
    const linkClass =
        'font-body font-normal text-[12px] leading-none text-on-surface-variant no-underline hover:text-on-surface pointer-coarse:py-3.5 pointer-coarse:px-1'
    return (
        <footer className="bg-surface py-6 border-t border-outline-variant/15">
            <Container width="app" className="flex justify-between items-center gap-6 flex-wrap">
                <Wordmark size={20} />
                {links(linkClass, 'flex items-center gap-5 pointer-coarse:gap-x-3 pointer-coarse:gap-y-0 flex-wrap')}
                {copyright('text-[12px]')}
            </Container>
        </footer>
    )
}
