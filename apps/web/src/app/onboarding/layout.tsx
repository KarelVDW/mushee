import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The tab and the route announcer name the page ("Welcome — Solkey"). No step count: the steps a visitor sees vary.
export const metadata: Metadata = { title: 'Welcome' }

export default function Layout({ children }: { children: ReactNode }) {
    return children
}
