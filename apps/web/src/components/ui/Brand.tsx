import type { ReactNode } from 'react'

interface WordmarkProps {
    size?: number
    className?: string
}

export function Wordmark({ size = 28, className }: WordmarkProps) {
    return (
        <span
            className={`font-display italic font-bold tracking-[-0.04em] leading-none text-on-surface ${className ?? ''}`}
            style={{ fontSize: size }}>
            Solkey
        </span>
    )
}

/** The small-caps label voice — shared by Eyebrow and the kit's field labels. */
export const EYEBROW_CLASS = 'font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant'

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
    return <span className={`${EYEBROW_CLASS} ${className ?? ''}`}>{children}</span>
}

// Space Grotesk by default; `italic` keeps Space Grotesk italic for in-app titles.
// Newsreader italic is reserved for marketing + auth surfaces — see DESIGN.md §Voice.
export function PageTitle({ children, italic = false }: { children: ReactNode; italic?: boolean }) {
    return (
        <h1
            className={`font-display font-bold text-[34px] sm:text-[48px] leading-none tracking-[-0.03em] text-on-surface m-0 ${italic ? 'italic' : ''}`}>
            {children}
        </h1>
    )
}

export function ModalTitle({ children, id }: { children: ReactNode; id?: string }) {
    return (
        <h2 id={id} className="font-display font-bold text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.03em] text-on-surface m-0">
            {children}
        </h2>
    )
}

export function SubHeadline({ children }: { children: ReactNode }) {
    return <p className="font-body font-normal text-[15px] leading-normal text-on-surface-variant m-0">{children}</p>
}

// Unused by the web app (so not in its barrel) but kept: the admin/eval kits use it,
// and this file is the copy the shared kit is extracted from.
interface PillProps {
    children: ReactNode
    tone?: 'neutral' | 'cyan' | 'magenta'
    className?: string
}

const PILL_TONES: Record<NonNullable<PillProps['tone']>, string> = {
    neutral: 'bg-surface-container text-on-surface',
    cyan: 'bg-primary-container text-on-primary-container',
    magenta: 'bg-secondary-container text-on-secondary-container',
}

export function Pill({ children, tone = 'neutral', className }: PillProps) {
    return (
        <span
            className={`rounded-full px-2.5 py-1 font-label font-semibold text-[11px] leading-none whitespace-nowrap ${PILL_TONES[tone]} ${className ?? ''}`}>
            {children}
        </span>
    )
}
