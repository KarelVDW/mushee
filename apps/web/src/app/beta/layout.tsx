import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The tab and the route announcer name the page ("You're on the waitlist — Solkey"); the page itself is a client component.
export const metadata: Metadata = { title: "You're on the waitlist" }

export default function Layout({ children }: { children: ReactNode }) {
    return children
}
