import type { Metadata } from 'next'

import { SharedScorePage } from './SharedScorePage'

/**
 * Public read-only view of a shared score. Shared scores are user content behind
 * a secret link: never indexed, generic metadata (the title only renders
 * client-side, after the token resolves).
 */
export const metadata: Metadata = {
    title: 'Shared score',
    description: 'A score shared from Solkey — view, play back and download it.',
    robots: { index: false, follow: false },
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params
    return <SharedScorePage token={token} />
}
