import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Data tables on a white card: a tonal header row, no row dividers (the No-Line Rule), rows that
 * hover to surface_container_high. A row with `href` opens on a click anywhere in it — its first
 * cell holds the real link, stretched over the row.
 */
export function Table({ children, minWidth = 'min-w-180' }: { children: ReactNode; minWidth?: string }) {
    return (
        <div className="overflow-x-auto">
            <table className={`w-full border-collapse ${minWidth}`}>{children}</table>
        </div>
    )
}

export function Head({ columns }: { columns: Array<string | { label: string; align?: 'right' | 'left'; title?: string }> }) {
    return (
        <thead>
            <tr className="text-left">
                {columns.map((c) => {
                    const col = typeof c === 'string' ? { label: c } : c
                    return (
                        <th
                            key={col.label}
                            title={col.title}
                            scope="col"
                            className={`bg-surface-container-low font-label font-semibold text-[11px] leading-tight tracking-[0.12em] uppercase text-on-surface-variant px-4 py-3 whitespace-nowrap ${col.align === 'right' ? 'text-right' : ''}`}>
                            {col.label}
                        </th>
                    )
                })}
            </tr>
        </thead>
    )
}

export function Row({ children, muted }: { children: ReactNode; muted?: boolean }) {
    return (
        <tr
            className={`relative hover:bg-surface-container-high transition-colors duration-150 ease-solkey ${muted ? 'text-on-surface-variant' : ''}`}>
            {children}
        </tr>
    )
}

export function Cell({ children, align, mono, className }: { children?: ReactNode; align?: 'right'; mono?: boolean; className?: string }) {
    return (
        <td
            className={[
                'px-4 py-2.5 text-[13px] align-middle',
                mono ? 'font-mono tabular-nums whitespace-nowrap' : 'font-body',
                align === 'right' ? 'text-right' : '',
                className ?? '',
            ].join(' ')}>
            {children}
        </td>
    )
}

/** The row's primary link, stretched over the whole row so the row opens on any click. */
export function RowLink({ href, children, sub }: { href: string; children: ReactNode; sub?: ReactNode }) {
    return (
        <>
            <Link
                href={href}
                className="font-body font-semibold text-[14px] leading-tight text-on-surface no-underline hover:text-primary focus-ring rounded-sm after:absolute after:inset-0 after:content-['']">
                {children}
            </Link>
            {sub && <span className="block font-mono text-[11px] leading-tight text-on-surface-variant mt-0.5">{sub}</span>}
        </>
    )
}
