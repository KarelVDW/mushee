'use client'

import { Score as NotationScore } from '@mushee/notation/components'
import type { Score } from '@mushee/notation/model/Score'
import { Component, type ReactNode } from 'react'

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
                <NotationScore score={score} layoutId={score.layout.id} />
            </div>
        </RenderBoundary>
    )
}

class RenderBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state = { failed: false }

    static getDerivedStateFromError() {
        return { failed: true }
    }

    render() {
        return this.state.failed ? this.props.fallback : this.props.children
    }
}
