'use client'

import { useCallback, useEffect } from 'react'

import type { Note, Score } from '../model'

/** Breathing room kept between the followed row and the scroll viewport's edges. */
const FOLLOW_SCROLL_MARGIN = 16

/**
 * How the follow scrolls: smoothly, unless the viewer asked for reduced motion — a smooth
 * follow through a whole piece is continuous motion, so then it jumps.
 */
export function followScrollBehavior(): ScrollBehavior {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/** The nearest ancestor that scrolls vertically — where selection/cursor following happens. */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY
        if (overflowY === 'auto' || overflowY === 'scroll') return node
    }
    return null
}

interface ScrollFollowOptions {
    /** The rendered score svg, in layout coordinates scaled to its on-screen width. */
    svgRef: React.RefObject<SVGSVGElement | null>
    /** The score's container — the scroll parent is looked up from here. */
    containerRef: React.RefObject<HTMLElement | null>
    score: Score
    /** The note whose row stays in view as the selection moves. */
    selectedNote?: Note | null
    /** The playback cursor rect the host's transport moves; its row stays in view while it is shown. */
    playbackCursorRef?: React.RefObject<SVGRectElement | null>
    /** Whether the svg (and with it the cursor rect) is rendered — the cursor can only be observed once it is. */
    mounted: boolean
}

/**
 * Keep the score's active row on screen: scroll the nearest scrollable ancestor so the
 * selected note's row, and the playback/recording cursor's row while it plays, sit inside
 * the viewport (no-op when they already do) — how both stay in view on small screens.
 */
export function useScrollFollow({ svgRef, containerRef, score, selectedNote, playbackCursorRef, mounted }: ScrollFollowOptions) {
    // Scroll so the row at `layoutY` (its top, in layout coordinates) fits the viewport.
    const scrollRowIntoView = useCallback(
        (layoutY: number) => {
            const svg = svgRef.current
            const scroller = findScrollParent(containerRef.current)
            if (!svg || !scroller) return
            const scale = svg.getBoundingClientRect().width / score.layout.scoreWidth
            const svgTop = svg.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
            const rowTop = svgTop + layoutY * scale
            const rowBottom = rowTop + score.layout.rowHeight * scale
            if (rowTop < scroller.scrollTop + FOLLOW_SCROLL_MARGIN) {
                scroller.scrollTo({ top: Math.max(0, rowTop - FOLLOW_SCROLL_MARGIN), behavior: followScrollBehavior() })
            } else if (rowBottom > scroller.scrollTop + scroller.clientHeight - FOLLOW_SCROLL_MARGIN) {
                scroller.scrollTo({ top: rowBottom - scroller.clientHeight + FOLLOW_SCROLL_MARGIN, behavior: followScrollBehavior() })
            }
        },
        [svgRef, containerRef, score],
    )

    // Keep the selected note's row visible whenever the selection moves (taps,
    // arrow keys, the mobile note navigator).
    useEffect(() => {
        if (!selectedNote) return
        try {
            const row = score.layout.rowFor(selectedNote.measure)
            scrollRowIntoView(score.layout.getYForRow(row))
        } catch {
            // A selection can briefly reference a measure detached by an in-flight edit.
        }
    }, [selectedNote, score, scrollRowIntoView])

    // Follow playback/recording: the engines drive the cursor rect's transform
    // directly, so a row change surfaces here as an attribute mutation.
    useEffect(() => {
        const cursor = playbackCursorRef?.current
        if (!cursor || !mounted) return
        const observer = new MutationObserver(() => {
            if (cursor.getAttribute('display') === 'none') return
            const match = /translate\(\s*0\s*[,\s]\s*([\d.]+)\s*\)/.exec(cursor.getAttribute('transform') ?? '')
            if (match) scrollRowIntoView(Number(match[1]))
        })
        observer.observe(cursor, { attributes: true, attributeFilter: ['transform', 'display'] })
        return () => observer.disconnect()
    }, [playbackCursorRef, mounted, scrollRowIntoView])
}
