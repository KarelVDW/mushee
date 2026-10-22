'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Space kept between the bar and the score wrapper's side edges (and the visible area's top and bottom). */
const EDGE_MARGIN = 8
/** How far the bar may poke above the wrapper — the canvas padding above the first row absorbs it. */
const MIN_TOP = -20

interface SelectionPopoverProps {
    /**
     * Anchor the bar hovers over, in pixels relative to its positioned ancestor (the score
     * wrapper): the bar is centered on `x` with its bottom at `y`. The editor derives it
     * from the selection (`ScoreLayout.selectionMenuAnchor`) — the center of the selected
     * span on the topmost selected row, at that row's tempo-marking height.
     */
    x: number
    y: number
    /**
     * The scrolling area the score is seen through. The bar stays inside its visible part —
     * after Select all, the topmost row may have scrolled away under the header, and the bar
     * waits at the top of what is on screen instead of following it out of sight.
     */
    viewport?: { current: HTMLElement | null }
    /** Opened from the keyboard (Shift+F10, the Menu key): focus moves to the first action. */
    autoFocus?: boolean
    /** Whether the clipboard holds anything — Paste is hidden (not disabled) when empty, like the OS menu. */
    canPaste: boolean
    onCopy: () => void
    onPaste: () => void
    onDelete: () => void
    onSelectAll: () => void
    onDismiss: () => void
}

/**
 * The floating selection-actions bar — deliberately OS-flavored rather than a `Popover`
 * panel: it mirrors Android's text-selection menu (a horizontal pill of plain text actions
 * hovering over the selection), because it *is* that menu, for notes. Opened by the score's
 * selection-menu gestures (touch: long-press, double-tap, a second tap on the selected note,
 * drag-release; mouse: right-click, drag-release) and by Shift+F10 / the Menu key; dismissed
 * by pressing anywhere else or Escape. Every selection-scoped action lives here — never as
 * extra buttons in the dock (see DESIGN.md).
 */
export function SelectionPopover({
    x,
    y,
    viewport,
    autoFocus = false,
    canPaste,
    onCopy,
    onPaste,
    onDelete,
    onSelectAll,
    onDismiss,
}: SelectionPopoverProps) {
    const barRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
    // Bumped on every scroll of the viewport, so the clamp below follows it.
    const [scrolled, setScrolled] = useState(0)

    useEffect(() => {
        const scroller = viewport?.current
        if (!scroller) return
        const onScroll = () => setScrolled((n) => n + 1)
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return () => scroller.removeEventListener('scroll', onScroll)
    }, [viewport])

    // Center the bar on the anchor with its bottom at the anchor's height, clamped inside
    // the score wrapper's sides (with a small overhang past its top, for the first row) and
    // inside the visible part of the viewport.
    useLayoutEffect(() => {
        const bar = barRef.current
        const parent = bar?.offsetParent as HTMLElement | null
        if (!bar || !parent) return
        const left = Math.min(
            Math.max(x - bar.offsetWidth / 2, EDGE_MARGIN),
            Math.max(EDGE_MARGIN, parent.clientWidth - bar.offsetWidth - EDGE_MARGIN),
        )
        let minTop = MIN_TOP
        let maxTop = Infinity
        const scroller = viewport?.current
        if (scroller) {
            const visible = scroller.getBoundingClientRect()
            const origin = parent.getBoundingClientRect()
            minTop = Math.max(minTop, visible.top - origin.top + EDGE_MARGIN)
            maxTop = Math.max(minTop, visible.bottom - origin.top - bar.offsetHeight - EDGE_MARGIN)
        }
        setPos({ left, top: Math.min(Math.max(y - bar.offsetHeight, minTop), maxTop) })
    }, [x, y, canPaste, viewport, scrolled])

    // Focus the first action once the bar is placed — a still-hidden bar can't take focus.
    const placed = pos !== null
    const focusedRef = useRef(false)
    useEffect(() => {
        if (!autoFocus || !placed || focusedRef.current) return
        focusedRef.current = true
        barRef.current?.querySelector<HTMLElement>('button')?.focus()
    }, [autoFocus, placed])

    // Tapping anywhere outside dismisses. Attached a tick late so the tail of the gesture
    // that opened the bar can't dismiss it, and on pointerdown so the very touch that
    // starts a new selection also clears the old bar.
    useEffect(() => {
        const onPointerDown = (e: PointerEvent) => {
            if (barRef.current && !barRef.current.contains(e.target as Node)) onDismiss()
        }
        const t = setTimeout(() => document.addEventListener('pointerdown', onPointerDown), 0)
        return () => {
            clearTimeout(t)
            document.removeEventListener('pointerdown', onPointerDown)
        }
    }, [onDismiss])

    // Escape dismisses the bar and stops there (capture beats the editor's own Escape
    // handling); every other key keeps its meaning — the bar is a hint, not a mode.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            onDismiss()
        }
        window.addEventListener('keydown', onKey, { capture: true })
        return () => window.removeEventListener('keydown', onKey, { capture: true })
    }, [onDismiss])

    return (
        <div
            ref={barRef}
            role="toolbar"
            aria-label="Selection actions"
            style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? 'visible' : 'hidden' }}
            // Tonal gray, not the white glass panel: the bar floats over the pure-white
            // score canvas, and the surface shift is what separates it (no-line rule).
            className="bg-surface-container-high/90 backdrop-blur-md editorial-shadow absolute z-(--z-popover) flex items-center gap-0.5 rounded-full px-1.5 py-1">
            <SelectionAction label="Copy" onClick={onCopy} />
            {canPaste && <SelectionAction label="Paste" onClick={onPaste} />}
            <SelectionAction label="Delete" destructive onClick={onDelete} />
            <SelectionAction label="Select all" onClick={onSelectAll} />
        </div>
    )
}

function SelectionAction({ label, destructive = false, onClick }: { label: string; destructive?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                'h-10 px-3 rounded-full border-0 bg-transparent cursor-pointer whitespace-nowrap',
                'font-label font-semibold text-[13px] leading-none',
                'transition-colors duration-150 ease-solkey',
                'hover:bg-surface-container-highest active:bg-surface-dim',
                'focus-ring',
                destructive ? 'text-secondary' : 'text-on-surface',
            ].join(' ')}>
            {label}
        </button>
    )
}
