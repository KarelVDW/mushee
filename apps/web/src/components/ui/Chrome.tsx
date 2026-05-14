'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

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
        { label: 'Editor', href: '/scores', match: (p) => p.startsWith('/scores/') },
    ]

    return (
        <nav className="sticky top-0 z-50 bg-surface/85 backdrop-blur-xl tonal-layer-glow">
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
                                        active
                                            ? 'text-on-surface border-b-2 border-primary-container'
                                            : 'text-on-surface-variant border-b-2 border-transparent',
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
                        className="bg-surface-container text-on-surface border-0 rounded-full w-9 h-9 cursor-pointer font-label font-semibold text-[13px] leading-none inline-flex items-center justify-center">
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

export function Footer() {
    return (
        <footer className="bg-surface py-6 border-t border-outline-variant/15">
            <div className="max-w-384 mx-auto px-8 flex justify-between items-center">
                <Wordmark size={20} />
                <span className="font-body font-normal text-[12px] leading-none text-on-surface-variant whitespace-nowrap">
                    © 2026 Sheemu — built for composers.
                </span>
            </div>
        </footer>
    )
}

interface DialogScrimProps {
    children: ReactNode
    onDismiss?: () => void
}

export function DialogScrim({ children, onDismiss }: DialogScrimProps) {
    return (
        <div onClick={onDismiss} className="fixed inset-0 z-100 bg-on-surface/40 backdrop-blur-xs flex items-center justify-center p-6">
            <div onClick={(e) => e.stopPropagation()}>{children}</div>
        </div>
    )
}

interface DialogPanelProps {
    title: ReactNode
    eyebrow?: ReactNode
    children?: ReactNode
    footer?: ReactNode
    onClose?: () => void
    /** Pixel width — kept as inline style because it's a runtime prop value. */
    width?: number
}

export function DialogPanel({ title, eyebrow, children, footer, onClose, width = 560 }: DialogPanelProps) {
    return (
        <div className="glass-panel rounded-xl tonal-layer-glow max-w-[90vw] max-h-[90vh] flex flex-col" style={{ width }}>
            <header className="px-7 pt-6 pb-4 flex items-start justify-between">
                <div className="flex flex-col gap-1.5">
                    <ModalTitle>{title}</ModalTitle>
                    {eyebrow && <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">{eyebrow}</span>}
                </div>
                {onClose && (
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="bg-transparent border-0 text-on-surface-variant cursor-pointer p-1">
                        <Icon name="x" size={20} />
                    </button>
                )}
            </header>
            <div className="px-7 flex-1 min-h-0 flex flex-col">{children}</div>
            {footer && <footer className="px-7 py-5 flex justify-end items-center gap-3">{footer}</footer>}
        </div>
    )
}
