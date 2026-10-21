import type { ReactNode } from 'react'

import { Wordmark } from '@/components/ui'

/** The card's vertical rhythm; each page keeps the spacing it was designed with. */
const GAPS = { 6: 'gap-6', 7: 'gap-7' } as const

/**
 * The frame of the signup funnel's own pages — onboarding and the beta waiting
 * room: the wordmark and one header action above a single elevated card.
 */
export function FunnelShell({ action, gap = 7, children }: { action?: ReactNode; gap?: keyof typeof GAPS; children: ReactNode }) {
    return (
        <main className="min-h-dvh bg-surface flex flex-col items-center px-6 py-8">
            <header className="w-full max-w-180 flex justify-between items-center">
                <Wordmark size={26} />
                {action}
            </header>

            <div
                className={`w-full max-w-180 mt-12 bg-surface-container-lowest rounded-xl editorial-shadow px-6 py-8 sm:px-12 sm:py-10 flex flex-col ${GAPS[gap]}`}>
                {children}
            </div>
        </main>
    )
}
