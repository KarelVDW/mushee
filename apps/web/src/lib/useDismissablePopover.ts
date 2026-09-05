'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * State and dismissal for a header menu's anchored panel (Export, Share, Takes):
 * Escape closes it — and while it is open every keydown stops here, so the
 * editor's shortcuts don't fire behind it — and a mouse-down outside both the
 * panel and its trigger closes it. The outside listener attaches on the next
 * tick so the click that opened the panel can't also close it. Opening moves
 * focus to the panel's first control; closing returns it to the trigger, so
 * keyboard users are never left on a detached element.
 */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

export function useDismissablePopover<Anchor extends HTMLElement = HTMLDivElement, Panel extends HTMLElement = HTMLDivElement>() {
    const anchorRef = useRef<Anchor | null>(null)
    const popRef = useRef<Panel | null>(null)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        if (!open) return
        const trigger = anchorRef.current?.querySelector<HTMLElement>(FOCUSABLE) ?? null
        popRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                setOpen(false)
            }
            e.stopPropagation()
        }
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node
            if (popRef.current && !popRef.current.contains(target) && !anchorRef.current?.contains(target)) setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        const t = setTimeout(() => document.addEventListener('mousedown', onMouseDown), 0)
        return () => {
            window.removeEventListener('keydown', onKey)
            clearTimeout(t)
            document.removeEventListener('mousedown', onMouseDown)
            // Only steal focus back when it is still inside the closing panel (not when the user clicked elsewhere).
            if (popRef.current?.contains(document.activeElement)) trigger?.focus()
        }
    }, [open])

    return { open, setOpen, anchorRef, popRef }
}
