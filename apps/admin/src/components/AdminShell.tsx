'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

import { Eyebrow, Icon, Wordmark } from '@/components/ui'
import { logout } from '@/lib/api'

const NAV = [
    { href: '/', label: 'Dashboard', icon: 'grid' },
    { href: '/users', label: 'Users', icon: 'users' },
    { href: '/waitlist', label: 'Waitlist', icon: 'user-plus' },
    { href: '/tiers', label: 'Tiers', icon: 'credit-card' },
] as const

function isActive(pathname: string, href: string): boolean {
    if (href === '/') return pathname === '/'
    // Score pages belong to the Users section — you always reach them through a user.
    if (href === '/users') return pathname.startsWith('/users') || pathname.startsWith('/scores')
    return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Console chrome: brand + nav as a side rail on desktop, a sticky top bar
 * with a horizontally scrolling tab row on phones. Content column caps at
 * the app width like the main product.
 */
export function AdminShell({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    const router = useRouter()

    const signOut = async () => {
        try {
            await logout()
        } finally {
            router.push('/login')
        }
    }

    const nav = (
        <nav aria-label="Console sections" className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {NAV.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={[
                            'inline-flex items-center gap-2.5 shrink-0 rounded-md px-3 py-2.5',
                            'font-label font-semibold text-[13px] leading-none no-underline',
                            'transition-colors duration-150 ease-solkey',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                            active
                                ? 'bg-primary-soft text-on-primary-soft'
                                : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
                        ].join(' ')}>
                        <Icon name={item.icon} size={16} />
                        {item.label}
                    </Link>
                )
            })}
        </nav>
    )

    return (
        <div className="min-h-dvh md:flex">
            <aside className="md:w-56 md:shrink-0 md:min-h-dvh md:sticky md:top-0 bg-surface-container-low/85 backdrop-blur-xl">
                <div className="flex md:flex-col items-center md:items-stretch gap-3 md:gap-6 px-4 py-3 md:px-4 md:py-6 md:h-full">
                    <Link href="/" className="no-underline inline-flex items-baseline gap-2 px-1 md:px-3">
                        <Wordmark size={22} />
                        <Eyebrow className="text-secondary">Admin</Eyebrow>
                    </Link>
                    <div className="flex-1 min-w-0 md:flex-none">{nav}</div>
                    <button
                        type="button"
                        onClick={() => void signOut()}
                        className={[
                            'md:mt-auto inline-flex items-center gap-2.5 shrink-0 cursor-pointer rounded-md px-3 py-2.5 border-0 bg-transparent',
                            'font-label font-semibold text-[13px] leading-none text-on-surface-variant',
                            'hover:bg-surface-container-high hover:text-on-surface transition-colors duration-150 ease-solkey',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                        ].join(' ')}>
                        <Icon name="lock" size={16} />
                        <span className="hidden md:inline">Sign out</span>
                    </button>
                </div>
            </aside>
            <main className="flex-1 min-w-0">
                <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-8 md:py-10">{children}</div>
            </main>
        </div>
    )
}

/** Page heading block: eyebrow section label + title + optional side slot. */
export function PageHeading({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
    return (
        <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
            <div className="flex flex-col gap-2">
                <Eyebrow>{eyebrow}</Eyebrow>
                <h1 className="font-display font-bold text-[28px] sm:text-[34px] leading-none tracking-[-0.03em] text-on-surface m-0">
                    {title}
                </h1>
            </div>
            {children}
        </header>
    )
}
