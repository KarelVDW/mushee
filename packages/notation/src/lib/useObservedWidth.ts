'use client'

import { useEffect } from 'react'

/**
 * Observe an element's content width, delivering each change on the next
 * animation frame. Deferring keeps handlers that resize the observed element
 * (state updates, layout reflows) out of the observation cycle — the feedback
 * the browser reports as "ResizeObserver loop completed with undelivered
 * notifications". Bursts (window drags) coalesce to the latest width.
 *
 * Re-observes when `onWidthChange` changes identity, re-delivering the current
 * width — memoize the callback against the state it closes over.
 */
export function useObservedWidth(ref: React.RefObject<HTMLElement | null>, onWidthChange: (width: number) => void) {
    useEffect(() => {
        const el = ref.current
        if (!el) return
        let frame = 0
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) return
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(() => onWidthChange(entry.contentRect.width))
        })
        observer.observe(el)
        return () => {
            cancelAnimationFrame(frame)
            observer.disconnect()
        }
    }, [ref, onWidthChange])
}
