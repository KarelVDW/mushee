'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Space kept between the bar and the score wrapper's side edges. */
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
 * selection-menu gestures (long-press / double-tap / drag-release); dismissed by tapping
 * anywhere else or Escape. Every selection-scoped action lives here — never as extra
 * buttons in the dock (see DESIGN.md).
 */
export function SelectionPopover({ x, y, canPaste, onCopy, onPaste, onDelete, onSelectAll, onDismiss }: SelectionPopoverProps) {
    const barRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

    // Center the bar on the anchor with its bottom at the anchor's height, clamped inside
    // the score wrapper's sides and allowed a small overhang past its top (first row).
    useLayoutEffect(() => {
        const bar = barRef.current
        const parent = bar?.offsetParent as HTMLElement | null
        if (!bar || !parent) return
        const left = Math.min(Math.max(x - bar.offsetWidth / 2, EDGE_MARGIN), Math.max(EDGE_MARGIN, parent.clientWidth - bar.offsetWidth - EDGE_MARGIN))
        setPos({ left, top: Math.max(y - bar.offsetHeight, MIN_TOP) })
    }, [x, y, canPaste])

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
            className="bg-surface-container-high/90 backdrop-blur-md editorial-shadow absolute z-50 flex items-center gap-0.5 rounded-full px-1.5 py-1">
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
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                destructive ? 'text-secondary' : 'text-on-surface',
            ].join(' ')}>
            {label}
        </button>
    )
}
