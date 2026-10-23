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

/**
 * How much of the scroller's viewport something else covers, top and bottom: its CSS
 * `scroll-padding` (the host sets it — a toast sitting over the foot of the score, say). The
 * followed row stays clear of it; `auto` and unset read as none.
 */
export function scrollPaddingOf(scroller: HTMLElement): { top: number; bottom: number } {
    const style = getComputedStyle(scroller)
    return { top: parseFloat(style.scrollPaddingTop) || 0, bottom: parseFloat(style.scrollPaddingBottom) || 0 }
}

/**
 * The layout y of the row the playback cursor is on, read off the attributes the host's
 * transport writes on it — `transform="translate(x, rowY)"` and `display` — or null while it
 * is hidden or not yet placed.
 */
export function cursorRowY(cursor: Element): number | null {
    if (cursor.getAttribute('display') === 'none') return null
    const match = /translate\(\s*[^,\s)]+\s*[,\s]\s*([\d.]+)\s*\)/.exec(cursor.getAttribute('transform') ?? '')
    return match ? Number(match[1]) : null
}

interface ScrollFollowOptions {
    /** The rendered score svg, in layout coordinates scaled to its on-screen width. */
    svgRef: React.RefObject<SVGSVGElement | null>
    /** The score's container — the scroll parent is looked up from here. */
    containerRef: React.RefObject<HTMLElement | null>
    score: Score
    /** The note whose row stays in view as the selection moves. */
    selectedNote?: Note | null
    /** The playback cursor group the host's transport moves; its row stays in view while it is shown. */
    playbackCursorRef?: React.RefObject<SVGGElement | null>
    /** Whether the svg (and with it the cursor) is rendered — the cursor can only be observed once it is. */
    mounted: boolean
}

/**
 * Keep the score's active row on screen: scroll the nearest scrollable ancestor so the
 * selected note's row, and the playback/recording cursor's row while it plays, sit inside
 * the viewport (no-op when they already do) — how both stay in view on small screens. The
 * scroller's scroll padding marks what is covered (see {@link scrollPaddingOf}): the row sits
 * inside the rest, and a row taller than that keeps its top in view.
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
            const padding = scrollPaddingOf(scroller)
            // The highest scroll that still shows the row's top below the covered top edge.
            const topInView = rowTop - padding.top - FOLLOW_SCROLL_MARGIN
            if (topInView < scroller.scrollTop) {
                scroller.scrollTo({ top: Math.max(0, topInView), behavior: followScrollBehavior() })
            } else if (rowBottom > scroller.scrollTop + scroller.clientHeight - padding.bottom - FOLLOW_SCROLL_MARGIN) {
                const bottomInView = rowBottom - scroller.clientHeight + padding.bottom + FOLLOW_SCROLL_MARGIN
                scroller.scrollTo({ top: Math.min(bottomInView, topInView), behavior: followScrollBehavior() })
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

    // Follow playback/recording: the engines drive the cursor's transform
    // directly, so a row change surfaces here as an attribute mutation.
    useEffect(() => {
        const cursor = playbackCursorRef?.current
        if (!cursor || !mounted) return
        const observer = new MutationObserver(() => {
            const rowY = cursorRowY(cursor)
            if (rowY !== null) scrollRowIntoView(rowY)
        })
        observer.observe(cursor, { attributes: true, attributeFilter: ['transform', 'display'] })
        return () => observer.disconnect()
    }, [playbackCursorRef, mounted, scrollRowIntoView])
}
