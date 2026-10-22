import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The library's tab and route-announcer name ("Your scores — Solkey"). The editor under /scores/[id] inherits it until it
// names its own tab after the score.
export const metadata: Metadata = { title: 'Your scores' }

export default function Layout({ children }: { children: ReactNode }) {
    return children
}
