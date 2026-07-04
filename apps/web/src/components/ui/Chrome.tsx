'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from 'react'

import { ModalTitle, PageTitle, SubHeadline, Wordmark } from './Brand'
import { PrimaryButton } from './Buttons'
import { Icon } from './Icon'

interface TopNavProps {
    user?: string
    onCreate?: () => void
}

export function TopNav({ user, onCreate }: TopNavProps) {
    const pathname = usePathname()
    const router = useRouter()
    const initials = (user ?? 'You')
        .split(' ')
        .map((s) => s[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    const items: { label: string; href: string; match: (p: string) => boolean }[] = [
        { label: 'Library', href: '/scores', match: (p) => p === '/scores' || p === '/' },
        { label: 'Settings', href: '/settings', match: (p) => p.startsWith('/settings') },
    ]

    return (
        <nav className="sticky top-0 z-50 bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow">
            <div className="max-w-384 mx-auto px-8 py-4.5 flex items-center justify-between">
                <div className="flex items-center gap-6.5">
                    <Link href="/scores" className="no-underline">
                        <Wordmark size={28} />
                    </Link>
                    <div className="flex items-center gap-5.5 ml-4">
                        {items.map((n) => {
                            const active = n.match(pathname ?? '')
                            return (
                                <Link
                                    key={n.label}
                                    href={n.href}
                                    className={[
                                        'no-underline cursor-pointer font-body font-medium text-[14px] leading-none pb-1',
                                        'transition-colors duration-150 ease-sheemu',
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
                <div className="flex items-center gap-3.5">
                    {onCreate && (
                        <PrimaryButton onClick={onCreate} icon="plus" emphasis="pop">
                            New score
                        </PrimaryButton>
                    )}
                    <button
                        onClick={() => router.push('/settings')}
                        title={user}
                        aria-label="Account settings"
                        className={[
                            'bg-surface-container text-on-surface border-0 rounded-full w-9 h-9 cursor-pointer',
                            'font-label font-semibold text-[13px] leading-none inline-flex items-center justify-center',
                            'hover:bg-surface-container-highest transition-colors duration-150 ease-sheemu',
                        ].join(' ')}>
                        {initials}
                    </button>
                </div>
            </div>
        </nav>
    )
}

export function PageHeader({
    title,
    subtitle,
    italic = false,
    right,
}: {
    title: ReactNode
    subtitle?: ReactNode
    italic?: boolean
    right?: ReactNode
}) {
    return (
        <div className="flex justify-between items-end gap-4.5 pb-4.5">
            <div className="flex flex-col gap-2">
                <PageTitle italic={italic}>{title}</PageTitle>
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
            <div className={`${width === 'app' ? 'max-w-384' : 'max-w-320'} mx-auto px-8 flex justify-between items-center gap-6 flex-wrap`}>
                <Wordmark size={20} />
                <nav aria-label="Legal" className="flex items-center gap-5 flex-wrap">
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
                        // Same event CookieConsent listens on (see openCookieSettings).
                        onClick={() => window.dispatchEvent(new Event('sheemu:cookie-settings'))}
                        className={`${linkClass} bg-transparent border-0 p-0 cursor-pointer`}>
                        Cookie settings
                    </button>
                </nav>
                <span className="font-body font-normal text-[12px] leading-none text-on-surface-variant whitespace-nowrap">
                    © 2026 Sheemu. Made for composers.
                </span>
            </div>
        </footer>
    )
}

interface DialogScrimProps {
    children: ReactNode
    onDismiss?: () => void
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

export function DialogScrim({ children, onDismiss }: DialogScrimProps) {
    const panelRef = useRef<HTMLDivElement>(null)

    // Move focus into the dialog on open and hand it back to the trigger on close, so
    // keyboard users never end up "behind" the scrim.
    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
        panelRef.current?.focus()
        return () => previouslyFocused?.focus()
    }, [])

    const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Escape') {
            onDismiss?.()
            return
        }
        if (e.key !== 'Tab') return
        // Cycle Tab within the dialog instead of letting it escape into the page behind.
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
        if (!focusables?.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
            e.preventDefault()
            last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
        }
    }

    return (
        <div onClick={onDismiss} className="fixed inset-0 z-100 bg-on-surface/40 backdrop-blur-xs flex items-center justify-center p-6">
            <div ref={panelRef} tabIndex={-1} onKeyDown={handleKeyDown} onClick={(e) => e.stopPropagation()} className="outline-none">
                {children}
            </div>
        </div>
    )
}

interface DialogPanelProps {
    title: ReactNode
    subtitle?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    onClose?: () => void
    /** Pixel width — kept as inline style because it's a runtime prop value. */
    width?: number
}

export function DialogPanel({ title, subtitle, children, footer, onClose, width = 560 }: DialogPanelProps) {
    const titleId = useId()
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="glass-panel rounded-lg editorial-shadow max-w-[90vw] max-h-[90vh] flex flex-col"
            style={{ width }}>
            <header className="px-7 pt-6 pb-4 flex items-start justify-between">
                <div className="flex flex-col gap-1.5">
                    <ModalTitle id={titleId}>{title}</ModalTitle>
                    {subtitle && <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">{subtitle}</span>}
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className={[
                            'bg-transparent border-0 text-on-surface-variant cursor-pointer p-1 rounded-full',
                            'hover:text-on-surface transition-colors duration-150 ease-sheemu',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                        ].join(' ')}>
                        <Icon name="x" size={20} />
                    </button>
                )}
            </header>
            <div className="px-7 flex-1 min-h-0 flex flex-col">{children}</div>
            {footer && <footer className="px-7 py-5 flex justify-end items-center gap-3">{footer}</footer>}
        </div>
    )
}
