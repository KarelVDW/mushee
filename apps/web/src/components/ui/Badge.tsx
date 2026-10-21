import type { ReactNode } from 'react'

const BADGE_TONES = {
    secondary: 'bg-secondary-soft text-on-secondary-soft',
    neutral: 'bg-surface-container-high text-on-surface',
} as const

/**
 * A small uppercase capsule that tags a card ("Best value", "Current").
 * Position it from the caller through `className` (e.g. pinned to a card's
 * corner). Web-only: no other app renders plan cards.
 */
export function Badge({ tone, className, children }: { tone: keyof typeof BADGE_TONES; className?: string; children: ReactNode }) {
    return (
        <span
            className={`font-label font-semibold text-[10px] leading-none tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-full ${BADGE_TONES[tone]} ${className ?? ''}`}>
            {children}
        </span>
    )
}
