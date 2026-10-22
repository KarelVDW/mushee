'use client'

import { ScoreView as NotationScoreView } from '@mushee/notation/components'
import type { Score } from '@mushee/notation/model'
import { RenderBoundary } from '@mushee/ui'

/**
 * Read-only engraving of a Score with the product's renderer. A score this app
 * built that the renderer chokes on is a bug worth seeing, so the fallback
 * says so instead of blanking the page.
 */
export function ScoreView({ score }: { score: Score }) {
    return (
        <RenderBoundary
            fallback={<p className="font-body text-[13px] text-on-surface-variant m-0">The notation renderer failed on this score.</p>}>
            <div className="bg-white rounded-md p-4 overflow-x-auto">
                <NotationScoreView score={score} layoutId={score.layout.id} />
            </div>
        </RenderBoundary>
    )
}
