'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Space kept between the bar and the score wrapper's side edges (and the visible area's top and bottom). */
const EDGE_MARGIN = 8
/** How far the bar may poke above the wrapper — the canvas padding above the first row absorbs it. */
const MIN_TOP = -20

/** The keys that move focus between the bar's actions (the ARIA toolbar pattern), from the focused one's index. */
const ROVING_KEYS: Record<string, (index: number, count: number) => number> = {
    ArrowRight: (index, count) => (index + 1) % count,
    ArrowLeft: (index, count) => (index - 1 + count) % count,
    Home: () => 0,
    End: (_index, count) => count - 1,
}

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
 *
 * With focus inside, it is a toolbar like any other: one tab stop, ← → (and Home / End) move
 * between the actions, and no keystroke reaches the editor's shortcuts — an arrow must not move
 * the selection out from under the bar, nor Backspace delete it. Opened by a pointer, focus
 * stays on the score and every key keeps its meaning: the bar is a hint, not a mode.
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
    // `flipped`: placed under the anchored row instead of above it (no room above in view).
    const [pos, setPos] = useState<{ left: number; top: number; flipped: boolean } | null>(null)
    // The action holding the toolbar's one tab stop (roving tabindex), by its place in the bar.
    const [current, setCurrent] = useState(0)
    const actions = [
        { label: 'Copy', onClick: onCopy },
        ...(canPaste ? [{ label: 'Paste', onClick: onPaste }] : []),
        { label: 'Delete', destructive: true, onClick: onDelete },
        { label: 'Select all', onClick: onSelectAll },
    ]
    const tabStop = Math.min(current, actions.length - 1)
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
    // inside the visible part of the viewport. It stays above the row; only when there is no
    // room for it above in view (the row scrolled up under the header) does it flip under the
    // row — under the selection bands on the anchored row — rather than pinning over the staff.
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
        const above = y - bar.offsetHeight
        const pinned = Math.min(Math.max(above, minTop), maxTop)
        // Pushed down by the top of the view, the bar may still clear the staff; once it would
        // sit over the row's bands instead, it goes under them.
        const row = above < minTop ? anchoredRow(parent, y) : null
        if (row && pinned + bar.offsetHeight > row.top + 1 && row.bottom + EDGE_MARGIN <= maxTop) {
            setPos({ left, top: Math.max(row.bottom + EDGE_MARGIN, minTop), flipped: true })
            return
        }
        setPos({ left, top: pinned, flipped: false })
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
    // handling); from the score, every other key keeps its meaning — the bar is a hint, not a mode.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            onDismiss()
        }
        window.addEventListener('keydown', onKey, { capture: true })
        return () => window.removeEventListener('keydown', onKey, { capture: true })
    }, [onDismiss])

    // Focus inside the bar: the arrows rove between the actions, and no key bubbles on to the
    // editor's shortcuts (Escape never gets here — the capture listener above takes it). A
    // native listener on the bar itself, since the editor's own is native on an ancestor and
    // would hear the key before a React handler could stop it.
    useEffect(() => {
        const bar = barRef.current
        if (!bar) return
        const onKey = (e: KeyboardEvent) => {
            e.stopPropagation()
            const move = ROVING_KEYS[e.key]
            if (!move) return
            e.preventDefault()
            const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')]
            const from = Math.max(
                0,
                buttons.findIndex((button) => button === document.activeElement),
            )
            buttons[move(from, buttons.length)]?.focus()
        }
        bar.addEventListener('keydown', onKey)
        return () => bar.removeEventListener('keydown', onKey)
    }, [])

    return (
        <div
            ref={barRef}
            role="toolbar"
            aria-label="Selection actions"
            style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? 'visible' : 'hidden' }}
            // Opaque tonal gray, never glass behind text: the bar floats over the pure-white score
            // canvas, and the surface shift plus the overlay edge is what separates it (no-line
            // rule). It grows in from the row it points at — from its bottom edge above the row,
            // its top edge when flipped under it.
            className={[
                'selection-bar-enter bg-surface-container-high shadow-overlay absolute z-(--z-popover) flex items-center gap-0.5 rounded-full px-1.5 py-1',
                pos?.flipped ? 'origin-top' : 'origin-bottom',
            ].join(' ')}>
            {actions.map(({ label, destructive, onClick }, index) => (
                <SelectionAction
                    key={label}
                    label={label}
                    destructive={destructive}
                    tabStop={index === tabStop}
                    onFocus={() => setCurrent(index)}
                    onClick={onClick}
                />
            ))}
        </div>
    )
}

/**
 * The vertical extent of the selection bands on the row the bar points at (the topmost selected
 * row: its bands are the first under the anchor `y`), in the score wrapper's pixels — the staff
 * the bar must not cover, and under which a flipped bar goes. Null when no band is drawn there.
 */
function anchoredRow(wrapper: HTMLElement, y: number): { top: number; bottom: number } | null {
    const origin = wrapper.getBoundingClientRect().top
    const bands = Array.from(wrapper.querySelectorAll('[data-selection-band]'), (band) => band.getBoundingClientRect())
        .map((rect) => ({ top: rect.top - origin, bottom: rect.bottom - origin }))
        .filter((band) => band.bottom > y)
    if (bands.length === 0) return null
    const top = Math.min(...bands.map((band) => band.top))
    // The bands of one row share their top; a lower row's start a row height further down.
    return { top, bottom: Math.max(...bands.filter((band) => band.top - top < 1).map((band) => band.bottom)) }
}

interface SelectionActionProps {
    label: string
    destructive?: boolean
    /** Holds the toolbar's one tab stop; the others are reached with the arrow keys. */
    tabStop: boolean
    onFocus: () => void
    onClick: () => void
}

function SelectionAction({ label, destructive = false, tabStop, onFocus, onClick }: SelectionActionProps) {
    return (
        <button
            type="button"
            tabIndex={tabStop ? 0 : -1}
            onFocus={onFocus}
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
