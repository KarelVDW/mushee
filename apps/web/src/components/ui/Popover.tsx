'use client'

import { Icon, SelectedMark, TertiaryButton } from '@mushee/ui'
import {
    Children,
    createContext,
    type CSSProperties,
    type ReactNode,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react'
import { createPortal } from 'react-dom'

import { FOCUSABLE_SELECTOR, useScrollEdges } from './Dialog'
import { focusWithoutTooltip, Tooltip } from './Tooltip'

/** How long a phone sheet shows the picked cell's active fill before it closes. */
export const SHEET_PICK_CONFIRM_MS = 150

/**
 * Where phone sheets render: one fixed frame between the measured header and dock
 * (`--app-header-h`, `--dock-h`, set by the editor page), outside every backdrop-filter
 * subtree so a sheet is never clipped by, or stacked under, the chrome it was opened from.
 * The frame only positions — it lets taps through; the sheet inside takes them.
 */
const SHEET_FRAME_CLASS =
    'fixed inset-x-2 top-[calc(var(--app-header-h,0px)+0.5rem)] bottom-[calc(var(--dock-h,0px)+0.5rem)] z-(--z-popover) flex flex-col justify-end pointer-events-none'

/**
 * The strip a `leaveRoomAbove` sheet keeps clear at the top of its frame: about one staff
 * system (140px; the frame itself starts 8px under the header), where the editor scrolls the
 * selected note's row while the sheet is open.
 */
export const SHEET_SYSTEM_ROOM = { px: 140, maxHeight: 'max-h-[calc(100%-8.75rem)]' } as const

/**
 * A phone header menu's card (Popover variant `header-sheet`): full width between 8px gutters,
 * 8px under the measured header, as tall as the viewport allows below it (its body scrolls).
 */
const HEADER_SHEET_CLASS =
    'popover-enter fixed inset-x-2 top-[calc(var(--app-header-h,0px)+0.5rem)] z-(--z-popover) flex flex-col min-h-0 max-h-[calc(100dvh-var(--app-header-h,0px)-1rem)] rounded-xl bg-surface-container-lowest shadow-overlay'
/** It arrives the way an anchored panel does from the header: dropping the last 6px. */
const HEADER_SHEET_ENTRANCE = { '--pop-from': '-6px' } as CSSProperties

/** The host element; `null` while a host is mounting, `undefined` when there is no host above. */
const SheetHostContext = createContext<HTMLElement | null | undefined>(undefined)

/**
 * The single host every phone sheet in its subtree portals into (contract C3). Mount it at
 * the editor root, outside the header's and dock's blurred subtrees; it renders its children
 * plus the empty sheet frame. Without a host, sheets portal into <body> in the same frame.
 */
export function PopoverSheetHost({ children }: { children: ReactNode }) {
    const [host, setHost] = useState<HTMLElement | null>(null)
    return (
        <SheetHostContext.Provider value={host}>
            {children}
            <div ref={setHost} data-popover-sheet-host="" className={SHEET_FRAME_CLASS} />
        </SheetHostContext.Provider>
    )
}

/**
 * `dismiss` delayed by {@link SHEET_PICK_CONFIRM_MS}, so a phone sheet shows what was picked
 * before it closes — immediate when `enabled` is false (anchored popovers) or under reduced motion.
 */
export function usePickConfirmation(dismiss: () => void, enabled: boolean): () => void {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current)
        },
        [],
    )
    return useCallback(() => {
        if (!enabled || prefersReducedMotion()) {
            dismiss()
            return
        }
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(dismiss, SHEET_PICK_CONFIRM_MS)
    }, [dismiss, enabled])
}

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

interface PopoverProps {
    /** Accessible dialog name, e.g. "Select clef". */
    ariaLabel: string
    /** The heading, in sentence case: a 15px title on an anchored popover, the 20px sheet title on a sheet. */
    title: ReactNode
    /** One plain line under the heading that explains the notation term ("How many beats in each bar."). */
    hint?: ReactNode
    onDismiss: () => void
    /**
     * Handles keys beyond Escape (which always dismisses) — the only way popover content sees
     * keydown (see the listener below). Keep referentially stable — it re-binds the window listener.
     */
    onKeyDown?: (e: KeyboardEvent) => void
    /**
     * Anchored: width/gap plus positioning classes (e.g. `w-max gap-2 right-0 top-full`); the gap
     * spaces the content, which starts 12px under the heading.
     * Sheet: layout classes for the scrolling body (e.g. `gap-2`); the host positions the sheet.
     */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
    /** Rendered on the far side of the heading, on the title's first baseline, e.g. a live readout. */
    headerRight?: ReactNode
    /**
     * A way back (the More sheet's "‹ Back"): a sheet puts it at the very top, above its title
     * and level with Close, where people look for it; an anchored popover leads its content with it.
     */
    lead?: ReactNode
    /**
     * Move focus to the panel's first control on open, and back to the trigger (the first
     * control in `anchorRef`) on close when focus was still inside — for menus opened from a
     * chip (HeaderMenu). Off for the editor's attribute popovers, which leave focus on the score.
     */
    manageFocus?: boolean
    /**
     * `anchored` (default) sits next to its trigger. `sheet` is the phone form: portalled into
     * the {@link PopoverSheetHost}, as tall as the room between header and dock allows (its body
     * scrolls, with a fade at the clipped edge), headed by a title, the hint and a 40px Close.
     * `header-sheet` is a phone header menu's form: the same full-width floating card, hanging
     * 8px under the measured header (`--app-header-h`) instead of standing on the dock, portalled
     * into <body> and arriving downward like an anchored panel from the header.
     */
    variant?: 'anchored' | 'sheet' | 'header-sheet'
    /** Anchored only: keep the panel this many px inside the viewport's left and right edges. */
    viewportGutter?: number
    /**
     * Sheet only: stop about one staff system ({@link SHEET_SYSTEM_ROOM}) short of the frame's
     * top, so the note being fixed stays in view above the sheet while its tools are toggled.
     */
    leaveRoomAbove?: boolean
    /**
     * The panel's closing row (Transpose's "More options" + Apply). A sheet pins it under its
     * scrolling body, so the commit button stays in view however long the body grows; an
     * anchored popover renders it last, inline.
     */
    footer?: ReactNode
    children: ReactNode
}

/**
 * Anchored transient panel: dialog role + a plain sentence-case heading on an opaque card,
 * dismissed by Escape or clicking outside. The chrome mirror of `DialogPanel` for non-modal
 * surfaces. Opaque (surface-container-lowest + the overlay shadow, whose hairline edge keeps the
 * panel distinct over the white canvas), never glass: it opens inside blurred chrome, where a
 * glass panel would show the staff lines straight through its text.
 *
 * An anchored panel arrives from its anchor — a 150ms fade and a short travel away from the
 * trigger (up out of the dock, down out of the header) — and goes at once. A sheet rises in, and
 * on a full close leaves an inert copy behind that fades down and away; swapping one sheet for
 * another in the same commit (More → a picker, Back) shows no exit. Under reduced motion both
 * appear and go at once.
 */
export function Popover({
    ariaLabel,
    title,
    hint,
    onDismiss,
    onKeyDown,
    className,
    anchorRef,
    headerRight,
    lead,
    manageFocus = false,
    variant = 'anchored',
    viewportGutter,
    leaveRoomAbove = false,
    footer,
    children,
}: PopoverProps) {
    const popRef = useRef<HTMLDivElement>(null)
    const sheet = variant === 'sheet'
    const host = useContext(SheetHostContext)
    // Where a sheet renders: its host, or <body> when there is none. Null while the host mounts.
    const sheetTarget = !sheet ? null : host === undefined ? (typeof document === 'undefined' ? null : document.body) : host

    // A layout effect, not a passive one: its cleanup runs while the panel is still in the
    // document, so it can tell whether focus was inside it when the popover closed.
    useLayoutEffect(() => {
        const panel = popRef.current
        if (!manageFocus || !panel) return
        const trigger = anchorRef?.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? null
        const body = panel.querySelector<HTMLElement>('[data-popover-body]') ?? panel
        ;(body.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus()
        return () => {
            // Only steal focus back when it is still inside the closing panel (not when the user clicked elsewhere).
            if (!panel.contains(document.activeElement)) return
            focusWithoutTooltip(trigger)
            // A trigger hidden while its sheet was open (the phone tool row) shows again in this same
            // commit: try once more on the next frame, once it can take focus.
            if (trigger && document.activeElement !== trigger) requestAnimationFrame(() => focusWithoutTooltip(trigger))
        }
        // sheetTarget: a sheet whose host mounts in the same commit renders one commit later.
    }, [manageFocus, anchorRef, sheetTarget])

    // A sheet clears any copy still leaving (the sheet it replaces in this same commit, so a swap
    // shows no exit) and, when it goes, leaves its own copy to fade out. Like the focus effect's,
    // the cleanup runs while the panel is still in the document.
    useLayoutEffect(() => {
        const panel = popRef.current
        if (!sheet || !panel) return
        clearLeavingSheets()
        return () => leaveSheet(panel)
    }, [sheet, sheetTarget])

    // An anchored panel travels in from its trigger — away from the anchor it opened from, 6px
    // (up out of the dock, down out of the header; an in-score picker, with no anchorRef, 4px by
    // its side) — with its transform origin on the anchor. Measured before paint, so the very first
    // frame already moves.
    useLayoutEffect(() => {
        const panel = popRef.current
        if (variant !== 'anchored' || !panel) return
        const anchor = (anchorRef?.current ?? (panel.offsetParent as HTMLElement | null))?.getBoundingClientRect()
        if (!anchor) return
        const rect = panel.getBoundingClientRect()
        const upward = rect.bottom <= anchor.top + 1
        const travel = anchorRef ? 6 : 4
        panel.style.setProperty('--pop-from', `${upward ? travel : -travel}px`)
        const originX = Math.min(Math.max(anchor.left + anchor.width / 2 - rect.left, 0), rect.width)
        panel.style.transformOrigin = `${Math.round(originX)}px ${upward ? '100%' : '0%'}`
    }, [variant, anchorRef])

    // While a popover is open no key reaches the editor shortcuts underneath. The listener
    // sits on window in the capture phase, so it runs before the editor container's own
    // keydown listener: Escape dismisses (and so no longer also collapses the selection);
    // every other key goes to `onKeyDown`, then stops here. Default actions still happen —
    // Tab moves focus, Enter/Space press the focused button, typing fills an input — but
    // React's handlers never see the event, so popover content handles keys through
    // `onKeyDown`, not a React onKeyDown. The one default blocked is Backspace outside a
    // text field: WebKit's is history-back, which the editor's own Backspace binding used
    // to absorb, and leaving the editor from inside a menu is never what the key meant.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
                e.preventDefault()
                onDismiss()
                return
            }
            if (e.key === 'Backspace' && !isTextEntry(e.target)) e.preventDefault()
            onKeyDown?.(e)
        }
        window.addEventListener('keydown', onKey, { capture: true })
        return () => window.removeEventListener('keydown', onKey, { capture: true })
    }, [onDismiss, onKeyDown])

    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node
            if (popRef.current && !popRef.current.contains(target) && !anchorRef?.current?.contains(target)) onDismiss()
        }
        // Deferred a tick so the click that opened the popover doesn't immediately dismiss it.
        const t = setTimeout(() => document.addEventListener('mousedown', onMouseDown), 0)
        return () => {
            clearTimeout(t)
            document.removeEventListener('mousedown', onMouseDown)
        }
    }, [onDismiss, anchorRef])

    const shift = useViewportClamp(popRef, variant === 'anchored' ? viewportGutter : undefined)

    if (variant === 'header-sheet') {
        if (typeof document === 'undefined') return null
        return createPortal(
            <div
                ref={popRef}
                role="dialog"
                aria-label={ariaLabel}
                style={HEADER_SHEET_ENTRANCE}
                className={HEADER_SHEET_CLASS}
                onMouseDown={(e) => e.stopPropagation()}>
                <PopoverHeader variant="sheet" title={title} hint={hint} headerRight={headerRight} lead={lead} onClose={onDismiss} />
                <SheetBody className={splitGapClasses(className).gap}>{children}</SheetBody>
                {footer && <div className="shrink-0 px-4 pt-2 pb-4">{footer}</div>}
            </div>,
            document.body,
        )
    }

    if (sheet) {
        const panel = (
            <div
                ref={popRef}
                role="dialog"
                aria-label={ariaLabel}
                className={`popover-sheet-enter pointer-events-auto flex flex-col min-h-0 ${leaveRoomAbove ? SHEET_SYSTEM_ROOM.maxHeight : 'max-h-full'} rounded-xl bg-surface-container-lowest shadow-overlay`}
                onMouseDown={(e) => e.stopPropagation()}>
                <PopoverHeader variant="sheet" title={title} hint={hint} headerRight={headerRight} lead={lead} onClose={onDismiss} />
                <SheetBody className={className}>{children}</SheetBody>
                {footer && <div className="shrink-0 px-4 pt-2 pb-4">{footer}</div>}
            </div>
        )
        if (!sheetTarget) return null
        if (host) return createPortal(panel, host)
        return createPortal(<div className={SHEET_FRAME_CLASS}>{panel}</div>, sheetTarget)
    }

    const { gap, rest } = splitGapClasses(className)
    return (
        <div
            ref={popRef}
            role="dialog"
            aria-label={ariaLabel}
            style={shift}
            className={`popover-enter bg-surface-container-lowest shadow-overlay absolute z-(--z-popover) flex flex-col p-4 pt-3.5 rounded-lg${rest ? ` ${rest}` : ''}`}
            onMouseDown={(e) => e.stopPropagation()}>
            <PopoverHeader title={title} hint={hint} headerRight={headerRight} className="mb-3" />
            <div className={`flex flex-col${gap ? ` ${gap}` : ''}`}>
                {lead}
                {children}
                {footer}
            </div>
        </div>
    )
}

interface PopoverHeaderProps {
    /** The panel's title, in sentence case ('Share a read-only link', 'Clef'): an h2. */
    title: ReactNode
    /** One plain 13px line, 4px under the title. */
    hint?: ReactNode
    /** On the far side of the title, on its first baseline (Tempo's live readout). */
    headerRight?: ReactNode
    /**
     * `anchored`: a 15px label-face title in the panel's own padding. `sheet`: a 20px headline
     * title in the sheet's header band, a 40px Close at its top right and `lead` above the title,
     * level with Close.
     */
    variant?: 'anchored' | 'sheet'
    /** Sheet only: the way back (the More sheet's "‹ Back"), above the title, level with Close. */
    lead?: ReactNode
    /** Sheet only: what the 40px Close does; no Close without it. */
    onClose?: () => void
    className?: string
}

/**
 * Every popover's and sheet's heading: a plain title — never an eyebrow; eyebrows label sections
 * inside a panel, not the panel — with an optional hint under it and an optional readout on the
 * title's baseline. The content starts 12px below it.
 */
export function PopoverHeader({ title, hint, headerRight, variant = 'anchored', lead, onClose, className }: PopoverHeaderProps) {
    const titleRow = (
        <div className="flex items-baseline justify-between gap-3">
            <h2
                className={
                    variant === 'sheet'
                        ? 'm-0 font-headline font-semibold text-[20px] leading-[1.3] tracking-[-0.01em] text-on-surface'
                        : 'm-0 type-label text-on-surface'
                }>
                {title}
            </h2>
            {headerRight}
        </div>
    )
    if (variant === 'anchored') {
        return (
            <div data-popover-header="" className={`flex flex-col${className ? ` ${className}` : ''}`}>
                {titleRow}
                {hint && <PopoverHint className="mt-1">{hint}</PopoverHint>}
            </div>
        )
    }
    return (
        <div data-popover-header="" className={`shrink-0 flex items-start gap-3 pl-4 pr-1.5 pt-2 pb-3${className ? ` ${className}` : ''}`}>
            {/* Without a Back row the title's 26px line centres on the 40px Close. */}
            <div className={`flex-1 min-w-0 flex flex-col${lead ? '' : ' pt-1.75'}`}>
                {lead && <div className="flex items-center min-h-10">{lead}</div>}
                {titleRow}
                {hint && <PopoverHint className="mt-1">{hint}</PopoverHint>}
            </div>
            {onClose && (
                <Tooltip label="Close" side="bottom">
                    <button
                        type="button"
                        aria-label="Close"
                        onClick={onClose}
                        className="shrink-0 size-10 inline-flex items-center justify-center rounded-full border-0 bg-transparent cursor-pointer text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-150 ease-solkey focus-ring">
                        <Icon name="x" size={20} />
                    </button>
                </Tooltip>
            )}
        </div>
    )
}

function PopoverHint({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <p className={`m-0 font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant${className ? ` ${className}` : ''}`}>
            {children}
        </p>
    )
}

/**
 * An anchored call site's className split in two: its gap utilities (`gap-2`, `sm:gap-x-3`), which
 * space the content column, and the rest (position, width), which stay on the panel — so the
 * content starts the same 12px under the heading whatever gap it asks for.
 */
function splitGapClasses(className: string | undefined): { gap: string; rest: string } {
    const gap: string[] = []
    const rest: string[] = []
    for (const token of (className ?? '').split(/\s+/).filter(Boolean)) {
        if (/^(?:[^:]+:)*gap(?:-[xy])?-/.test(token)) gap.push(token)
        else rest.push(token)
    }
    return { gap: gap.join(' '), rest: rest.join(' ') }
}

/** Marks a sheet's leaving copy (or its frame, without a host), so the next sheet to mount clears it. */
const LEAVING_ATTRIBUTE = 'data-popover-sheet-leaving'
/** A leaving copy is dropped after this even if its animationend never comes (a hidden tab). */
const LEAVE_FALLBACK_MS = 400

/** Remove every sheet copy still playing its exit — a new sheet took the frame in the same commit. */
function clearLeavingSheets() {
    for (const el of Array.from(document.querySelectorAll(`[${LEAVING_ATTRIBUTE}]`))) el.remove()
}

/**
 * Leave a copy of a closing sheet in its frame that plays `sheet-out` (fading as it drops 8px)
 * and then removes itself. The copy is inert and hidden from assistive tech, with no dialog role,
 * name or ids, so nothing reaches it and a `getByRole('dialog')` count stays exact. Without a
 * host the sheet's own frame went with it, so the copy gets a frame of its own in <body>.
 */
function leaveSheet(panel: HTMLElement) {
    const frame = panel.parentElement
    if (!frame || !panel.isConnected) return
    const ghost = panel.cloneNode(true) as HTMLElement
    ghost.removeAttribute('role')
    ghost.removeAttribute('aria-label')
    for (const el of [ghost, ...Array.from(ghost.querySelectorAll('[id]'))]) el.removeAttribute('id')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.setAttribute('inert', '')
    ghost.classList.remove('popover-sheet-enter', 'pointer-events-auto')
    ghost.classList.add('pointer-events-none', 'animate-sheet-out')
    let leaving = ghost
    if (frame.hasAttribute('data-popover-sheet-host')) {
        frame.appendChild(ghost)
    } else {
        leaving = frame.cloneNode(false) as HTMLElement
        leaving.appendChild(ghost)
        document.body.appendChild(leaving)
    }
    leaving.setAttribute(LEAVING_ATTRIBUTE, '')
    // The copy keeps the body's scroll position, so the content doesn't jump as it goes.
    const ghostBody = ghost.querySelector('[data-popover-body]')
    if (ghostBody) ghostBody.scrollTop = panel.querySelector('[data-popover-body]')?.scrollTop ?? 0
    const remove = () => leaving.remove()
    ghost.addEventListener('animationend', remove, { once: true })
    setTimeout(remove, LEAVE_FALLBACK_MS)
}

/**
 * A sheet's scrolling body. Where its content is clipped — below, or above once scrolled — a
 * 16px fade over the edge line says there is more that way. It re-measures whenever the body
 * or its content changes size (Transpose's "More options" growing the content, a sheet frame
 * shrinking), not only on scroll and window resize. The content keeps its natural height —
 * the body scrolls instead of squeezing a child (the transpose preview) to fit. The top fade
 * sits `--sheet-fade-top` down (0 by default), so content with a sticky label at its top can
 * keep that label clear of the fade.
 */
function SheetBody({ className, children }: { className?: string; children: ReactNode }) {
    const { ref, measure, scrolled, clipped } = useScrollEdges()
    return (
        <div className="relative flex-1 min-h-0 flex flex-col">
            <div ref={ref} data-popover-body="" onScroll={measure} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                <div className={`flex flex-col px-4 pb-4${className ? ` ${className}` : ''}`}>{children}</div>
            </div>
            {scrolled && (
                <div
                    aria-hidden="true"
                    data-sheet-fade="top"
                    className="pointer-events-none absolute inset-x-0 top-(--sheet-fade-top,0px) h-4 bg-linear-to-b from-surface-container-lowest to-transparent"
                />
            )}
            {clipped && (
                <div
                    aria-hidden="true"
                    data-sheet-fade="bottom"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-4 rounded-b-xl bg-linear-to-t from-surface-container-lowest to-transparent"
                />
            )}
        </div>
    )
}

/**
 * The horizontal shift that keeps an anchored panel `gutter` px inside the viewport — a
 * right-aligned menu under a chip near the left edge (the phone header's Share) would
 * otherwise spill off screen. Measured before paint, again on resize.
 *
 * Idempotent: a measure takes off the shift the DOM carries right now (`applied`, written in
 * the same commit as the style) and sets the one shift the untransformed panel needs. Two
 * measures before a re-render — StrictMode's doubled effect, a resize while opening — land
 * on the same value instead of shifting twice.
 */
function useViewportClamp(ref: { current: HTMLElement | null }, gutter: number | undefined): CSSProperties | undefined {
    const [dx, setDx] = useState(0)
    const applied = useRef(0)
    // Declared before the measuring effect, so a commit's own shift is on record before it measures.
    useLayoutEffect(() => {
        applied.current = dx
    }, [dx])
    useLayoutEffect(() => {
        if (gutter === undefined) return
        const measure = () => {
            const el = ref.current
            if (!el) return
            const rect = el.getBoundingClientRect()
            const left = rect.left - applied.current
            const right = rect.right - applied.current
            if (left < gutter || rect.width > window.innerWidth - 2 * gutter) setDx(gutter - left)
            else if (right > window.innerWidth - gutter) setDx(window.innerWidth - gutter - right)
            else setDx(0)
        }
        measure()
        window.addEventListener('resize', measure)
        return () => window.removeEventListener('resize', measure)
    }, [ref, gutter])
    return dx ? { transform: `translateX(${dx}px)` } : undefined
}

/**
 * A popover's labelled More ("More clefs", "More time signatures", Transpose's "More options"):
 * a tertiary button whose 12px chevron says it opens more — pointing up once it has, for a
 * toggle that reads "Fewer options" then.
 */
export function PopoverExpander({ expanded = false, onClick, children }: { expanded?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <TertiaryButton onClick={onClick}>
            <span className="inline-flex items-center gap-1">
                {children}
                <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} />
            </span>
        </TertiaryButton>
    )
}

/** Whether a key's default action edits text in `target` (an input, textarea or contenteditable). */
function isTextEntry(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
}

/**
 * Where a picked option's check sits. `row`: a SelectedMark trailing the row (the clef rows).
 * `tile`: a 14px SelectedMark in the top-right corner of a tile at least 64px wide (the further
 * clefs). `cell`: an inline 12px check beside the label of a small cell (keys, time signatures,
 * interval sizes and qualities) — ahead of the label under a glyph (a time signature's numerals
 * over its name), after a lone label — never over the glyph.
 */
export type PopoverOptionLayout = 'row' | 'tile' | 'cell'

interface PopoverOptionProps {
    active: boolean
    onClick: () => void
    ariaLabel: string
    title?: string
    /** Size/layout classes (e.g. `justify-center w-11 h-11`). */
    className?: string
    /** Where the picked check sits; inferred from `className` (see {@link inferOptionLayout}) when left out. */
    layout?: PopoverOptionLayout
    children: ReactNode
}

/**
 * A selectable option in a popover grid or list. At rest it sits on the tile fill, stepping a
 * tone on hover and press; picked, it takes the selected fill (primary-soft) and a check, so the
 * choice never rides on colour alone and the popover's one loud cyan stays its commit button.
 * Cells and tiles shrink a little when pressed (not full-width rows, not under reduced motion).
 */
export function PopoverOption({ active, onClick, ariaLabel, title, className, layout, children }: PopoverOptionProps) {
    const placement = layout ?? inferOptionLayout(className)
    return (
        <button
            type="button"
            aria-pressed={active}
            aria-label={ariaLabel}
            title={title}
            onClick={onClick}
            className={[
                'flex items-center rounded-md cursor-pointer border-0 shrink-0',
                'transition-[background-color,color,scale] duration-150 ease-solkey',
                'focus-ring',
                placement === 'tile' ? 'relative' : '',
                placement === 'row' ? '' : 'motion-safe:active:scale-[0.97]',
                active
                    ? 'bg-(--color-selected) text-(--color-on-selected)'
                    : 'bg-(--tile-fill) text-on-surface hover:bg-(--tile-fill-hover) active:bg-(--tile-fill-press)',
                className ?? '',
            ]
                .filter(Boolean)
                .join(' ')}>
            <PickedContent active={active} placement={placement} column={hasClass(className, 'flex-col')}>
                {children}
            </PickedContent>
        </button>
    )
}

/** An option's content plus, while picked, its check where {@link PopoverOptionLayout} puts it. */
function PickedContent({
    active,
    placement,
    column,
    children,
}: {
    active: boolean
    placement: PopoverOptionLayout
    column: boolean
    children: ReactNode
}) {
    if (placement === 'row') {
        return (
            <>
                {children}
                {active && <SelectedMark className="ml-auto" />}
            </>
        )
    }
    if (placement === 'tile') {
        return (
            <>
                {children}
                {active && <SelectedMark size="sm" className="absolute top-1 right-1" />}
            </>
        )
    }
    const check = active && (
        <span aria-hidden="true" className="inline-flex shrink-0 motion-safe:animate-pick-in">
            <Icon name="check" size={12} />
        </span>
    )
    if (!column) {
        return (
            <>
                {children}
                {check && <span className="ml-0.5 inline-flex">{check}</span>}
            </>
        )
    }
    // A glyph over its label: the check joins the label's line, ahead of it.
    const parts = Children.toArray(children)
    const label = parts.pop()
    return (
        <>
            {parts}
            <span className="inline-flex items-center gap-0.5">
                {check}
                {label}
            </span>
        </>
    )
}

/**
 * The layout an option's size classes imply: a fixed width of 64px or more is a `tile`, a
 * full-width row of content that isn't centred is a `row`, and everything else a `cell`.
 */
export function inferOptionLayout(className: string | undefined): PopoverOptionLayout {
    const tokens = (className ?? '').split(/\s+/)
    const width = tokens.map((token) => /^w-(\d+(?:\.\d+)?)$/.exec(token)).find(Boolean)
    if (width && Number(width[1]) * 4 >= 64) return 'tile'
    if (tokens.includes('w-full') && !tokens.includes('flex-col') && !tokens.includes('justify-center')) return 'row'
    return 'cell'
}

function hasClass(className: string | undefined, token: string): boolean {
    return (className ?? '').split(/\s+/).includes(token)
}
