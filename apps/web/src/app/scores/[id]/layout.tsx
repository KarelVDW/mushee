import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

// The editor's tab and route-announcer name until the score loads ("Untitled score — Solkey", the name an untitled
// score keeps — UNTITLED_SCORE in EditorHeader, which a server layout can't import from a client module); then the page
// names the tab after the score (useDocumentTitle). Never the library's "Your scores".
export const metadata: Metadata = { title: 'Untitled score' }

// Edge to edge: the editor runs under the notch and the home indicator (an installed app no longer
// letterboxes the dock), its header and dock padding themselves by env(safe-area-inset-*). Only this
// route so far: the root layout's viewport says why. The root's theme colour still applies.
export const viewport: Viewport = { viewportFit: 'cover' }

export default function Layout({ children }: { children: ReactNode }) {
    return children
}
