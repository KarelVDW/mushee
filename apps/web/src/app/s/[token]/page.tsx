import type { Metadata } from 'next'

import { SharedScorePage } from './SharedScorePage'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4200'
if (!process.env.NEXT_PUBLIC_API_URL && process.env.NODE_ENV === 'production') {
    // Module scope: logged once per server, not per request. Without the URL every shared page
    // pays a failed fetch and falls back to the generic title, with nothing else to diagnose it.
    console.warn('NEXT_PUBLIC_API_URL is not set: shared-page titles and Open Graph cards fall back to the generic text.')
}

/** Metadata for a link that doesn't resolve (or before we know): generic, and never indexed. */
const FALLBACK: Metadata = {
    title: { absolute: 'Shared score — Solkey' },
    description: 'A score shared from Solkey — view, play back and download it.',
    robots: { index: false, follow: false },
}

/**
 * Public read-only view of a shared score. Shared scores are user content behind
 * a secret link: never indexed. The title and Open Graph card come from the
 * public GET /shared/:token (no session needed) so a pasted link unfurls with
 * the score's own name; any failure — 404, API down, slow — falls back to the
 * generic metadata rather than breaking the page.
 */
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
    const { token } = await params
    try {
        // Cached per token for a minute: link previews and repeat views of one link cost the API
        // one call, and the server's egress address stays well under the route's per-IP limit.
        const res = await fetch(`${API_URL}/shared/${encodeURIComponent(token)}`, {
            next: { revalidate: 60 },
            signal: AbortSignal.timeout(1500),
        })
        if (!res.ok) return FALLBACK
        const shared = (await res.json()) as { title?: unknown }
        const title = typeof shared.title === 'string' && shared.title.trim() ? shared.title.trim() : null
        if (!title) return FALLBACK
        const description = `"${title}" — a score shared from Solkey. View it, play it back and download it as PDF, MusicXML or MIDI.`
        return {
            title: { absolute: `${title} — Solkey` },
            description,
            robots: { index: false, follow: false },
            openGraph: { type: 'website', siteName: 'Solkey', title: `${title} — Solkey`, description },
            twitter: { card: 'summary', title: `${title} — Solkey`, description },
        }
    } catch {
        return FALLBACK
    }
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    return <SharedScorePage token={token} />
}
