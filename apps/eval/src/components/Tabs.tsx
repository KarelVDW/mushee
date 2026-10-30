import Link from 'next/link'

/** Page-level tabs as links (each tab is an address); the picked one wears the sanctioned 3px cyan underline. */
export function Tabs({
    tabs,
    active,
    label,
}: {
    tabs: Array<{ key: string; label: string; href: string; count?: number }>
    active: string
    label: string
}) {
    return (
        <nav aria-label={label} className="flex gap-6 mb-6 overflow-x-auto">
            {tabs.map((tab) => {
                const on = tab.key === active
                return (
                    <Link
                        key={tab.key}
                        href={tab.href}
                        aria-current={on ? 'page' : undefined}
                        className={[
                            'inline-flex items-center gap-2 min-h-10 pb-1.5 -mb-px no-underline whitespace-nowrap focus-ring rounded-sm',
                            'font-label font-semibold text-[14px] leading-none border-b-[3px]',
                            on
                                ? 'text-on-surface border-primary-container'
                                : 'text-on-surface-variant border-transparent hover:text-on-surface',
                        ].join(' ')}>
                        {tab.label}
                        {tab.count !== undefined && (
                            <span className="font-mono text-[12px] font-normal text-on-surface-variant">{tab.count}</span>
                        )}
                    </Link>
                )
            })}
        </nav>
    )
}
