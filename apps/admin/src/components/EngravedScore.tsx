'use client'

import { Score as ScoreView } from '@mushee/notation/components'
import type { ScorePartwise } from '@mushee/notation/components/types'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import { Component, type ReactNode, useMemo } from 'react'

import type { ScoreDocument } from '@/lib/api'

import { ScorePreview } from './ScorePreview'

/**
 * The real engraving, read-only: the same semantic model + notation renderer
 * the editor uses (@mushee/notation, compiled with this app's code), just
 * without any of the editing callbacks, so measure buttons, ghost previews
 * and selection never activate. A document this renderer chokes on is exactly
 * what an admin comes to inspect, so failures fall back to the piano-roll
 * sketch instead of a broken page.
 */
export function EngravedScore({ document }: { document: ScoreDocument }) {
    const score = useMemo(() => {
        if (typeof document.raw === 'string') return null
        try {
            return new ScoreDeserializer(document as unknown as ScorePartwise).toScore()
        } catch {
            return null
        }
    }, [document])

    if (!score) return <Fallback document={document} reason="This document doesn't deserialize" />

    return (
        <RenderBoundary fallback={<Fallback document={document} reason="The notation renderer failed on this document" />}>
            <div className="bg-white rounded-md manuscript-canvas p-4 sm:p-8">
                <ScoreView score={score} layoutId={score.layout.id} />
            </div>
        </RenderBoundary>
    )
}

function Fallback({ document, reason }: { document: ScoreDocument; reason: string }) {
    return (
        <div className="flex flex-col gap-3">
            {typeof document.raw !== 'string' && (
                <p className="font-body text-[13px] leading-normal text-on-surface-variant m-0">
                    {reason} — showing the piano-roll sketch instead. The raw document below has the full content.
                </p>
            )}
            <ScorePreview document={document} />
        </div>
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
