import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The editor's tab and route-announcer name until the score loads ("Untitled score — Solkey", the name an untitled
// score keeps — UNTITLED_SCORE in EditorHeader, which a server layout can't import from a client module); then the page
// names the tab after the score (useDocumentTitle). Never the library's "Your scores".
export const metadata: Metadata = { title: 'Untitled score' }

export default function Layout({ children }: { children: ReactNode }) {
    return children
}
