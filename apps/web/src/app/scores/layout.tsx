import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The library's tab and route-announcer name ("Your scores — Solkey"). The editor under /scores/[id] has its own
// ([id]/layout.tsx) until it names the tab after the score.
export const metadata: Metadata = { title: 'Your scores' }

export default function Layout({ children }: { children: ReactNode }) {
    return children
}
