'use client'

import { Eyebrow, Icon, type IconName, Wordmark } from '@mushee/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

const NAV = [
    { href: '/', label: 'Overview', icon: 'grid' },
    { href: '/timeline', label: 'Timeline', icon: 'clock' },
    { href: '/runs', label: 'Runs', icon: 'list' },
    { href: '/datasets', label: 'Datasets', icon: 'folder' },
] as const satisfies readonly { href: string; label: string; icon: IconName }[]

function isActive(pathname: string, href: string): boolean {
    if (href === '/') return pathname === '/'
    // A comparison is two runs side by side — it belongs to Runs.
    if (href === '/runs') return pathname.startsWith('/runs') || pathname.startsWith('/compare')
    return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Workbench chrome, the admin console's shape: brand + nav as a side rail on desktop, a sticky
 * top bar with a scrolling tab row on phones.
 */
export function Shell({ children }: { children: ReactNode }) {
    const pathname = usePathname()
    return (
        <div className="min-h-dvh md:flex">
            <aside className="sticky top-0 z-(--z-sticky) md:w-52 md:shrink-0 md:h-dvh bg-surface-container-low/85 backdrop-blur-xl">
                <div className="flex md:flex-col items-center md:items-stretch gap-3 md:gap-6 px-4 py-3 md:px-4 md:py-6">
                    <Link href="/" className="no-underline inline-flex items-baseline gap-2 px-1 md:px-3 shrink-0">
                        <Wordmark size={22} />
                        <Eyebrow className="text-secondary">Eval</Eyebrow>
                    </Link>
                    <nav aria-label="Workbench sections" className="flex md:flex-col gap-1 overflow-x-auto min-w-0">
                        {NAV.map((item) => {
                            const active = isActive(pathname, item.href)
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    aria-current={active ? 'page' : undefined}
                                    className={[
                                        'inline-flex items-center gap-2.5 shrink-0 rounded-md px-3 py-2.5 min-h-10',
                                        'font-label font-semibold text-[13px] leading-none no-underline',
                                        'transition-colors duration-150 ease-solkey focus-ring',
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
                </div>
            </aside>
            <main className="flex-1 min-w-0">
                <div className="mx-auto max-w-[1280px] px-4 sm:px-8 py-6 md:py-10">{children}</div>
            </main>
        </div>
    )
}
