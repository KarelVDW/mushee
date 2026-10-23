'use client'

import { Eyebrow, Icon, TertiaryButton } from '@mushee/ui'
import {
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

import { FOCUSABLE_SELECTOR } from './Dialog'
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
    /** The heading: an eyebrow on an anchored popover, a sentence-case title on a sheet. */
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
     * Anchored: width/gap plus positioning classes (e.g. `w-max gap-2 right-0 top-full`).
     * Sheet: layout classes for the scrolling body (e.g. `gap-2`); the host positions the sheet.
     */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
    /** Rendered on the far side of the heading, e.g. a live readout. */
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
     */
    variant?: 'anchored' | 'sheet'
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
 * Anchored transient panel: dialog role + eyebrow heading on an opaque card, dismissed by
 * Escape or clicking outside. The chrome mirror of `DialogPanel` for non-modal surfaces.
 * Opaque (surface-container-lowest + the overlay shadow, whose hairline edge keeps the panel
 * distinct over the white canvas), never glass: it opens inside blurred chrome, where a glass
 * panel would show the staff lines straight through its text.
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

    const shift = useViewportClamp(popRef, sheet ? undefined : viewportGutter)

    if (sheet) {
        const panel = (
            <div
                ref={popRef}
                role="dialog"
                aria-label={ariaLabel}
                className={`popover-sheet-enter pointer-events-auto flex flex-col min-h-0 ${leaveRoomAbove ? SHEET_SYSTEM_ROOM.maxHeight : 'max-h-full'} rounded-xl bg-surface-container-lowest shadow-overlay`}
                onMouseDown={(e) => e.stopPropagation()}>
                <div className="shrink-0 flex items-start gap-3 pl-4 pr-1.5 pt-1.5 pb-2">
                    <div className={`flex-1 min-w-0 flex flex-col gap-1 ${lead ? '' : 'pt-2.5'}`}>
                        {lead}
                        <h2 className="m-0 font-label font-semibold text-[15px] leading-tight text-on-surface">{title}</h2>
                        {hint && <PopoverHint>{hint}</PopoverHint>}
                    </div>
                    {headerRight && <div className="shrink-0 pt-2.5">{headerRight}</div>}
                    <Tooltip label="Close" side="bottom">
                        <button
                            type="button"
                            aria-label="Close"
                            onClick={onDismiss}
                            className="shrink-0 size-10 inline-flex items-center justify-center rounded-full border-0 bg-transparent cursor-pointer text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-150 ease-solkey focus-ring">
                            <Icon name="x" size={20} />
                        </button>
                    </Tooltip>
                </div>
                <SheetBody className={className}>{children}</SheetBody>
                {footer && <div className="shrink-0 px-4 pt-2 pb-4">{footer}</div>}
            </div>
        )
        if (!sheetTarget) return null
        if (host) return createPortal(panel, host)
        return createPortal(<div className={SHEET_FRAME_CLASS}>{panel}</div>, sheetTarget)
    }

    return (
        <div
            ref={popRef}
            role="dialog"
            aria-label={ariaLabel}
            style={shift}
            className={`bg-surface-container-lowest shadow-overlay absolute z-(--z-popover) flex flex-col p-4 rounded-lg${className ? ` ${className}` : ''}`}
            onMouseDown={(e) => e.stopPropagation()}>
            {headerRight ? (
                <div className="flex justify-between items-center">
                    <Eyebrow>{title}</Eyebrow>
                    {headerRight}
                </div>
            ) : (
                <Eyebrow>{title}</Eyebrow>
            )}
            {hint && <PopoverHint>{hint}</PopoverHint>}
            {lead}
            {children}
            {footer}
        </div>
    )
}

function PopoverHint({ children }: { children: ReactNode }) {
    return <p className="m-0 font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">{children}</p>
}

/**
 * A sheet's scrolling body. Where its content is clipped — below, or above once scrolled — a
 * 16px fade over the edge line says there is more that way. It re-measures whenever the body
 * or its content changes size (Transpose's "More options" growing the content, a sheet frame
 * shrinking), not only on scroll and window resize. The content keeps its natural height —
 * the body scrolls instead of squeezing a child (the transpose preview) to fit.
 */
function SheetBody({ className, children }: { className?: string; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const [clipped, setClipped] = useState(false)
    const [scrolled, setScrolled] = useState(false)
    const measure = useCallback(() => {
        const el = ref.current
        if (!el) return
        setClipped(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
        setScrolled(el.scrollTop > 1)
    }, [])
    useLayoutEffect(() => {
        measure()
        window.addEventListener('resize', measure)
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
        for (const el of [ref.current, contentRef.current]) if (el) observer?.observe(el)
        return () => {
            window.removeEventListener('resize', measure)
            observer?.disconnect()
        }
    }, [measure])
    return (
        <div className="relative flex-1 min-h-0 flex flex-col">
            <div ref={ref} data-popover-body="" onScroll={measure} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                <div ref={contentRef} className={`flex flex-col px-4 pb-4${className ? ` ${className}` : ''}`}>
                    {children}
                </div>
            </div>
            {scrolled && (
                <div
                    aria-hidden="true"
                    data-sheet-fade="top"
                    className="pointer-events-none absolute inset-x-0 top-0 h-4 bg-linear-to-b from-surface-container-lowest to-transparent"
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

interface PopoverOptionProps {
    active: boolean
    onClick: () => void
    ariaLabel: string
    title?: string
    /** Size/layout classes (e.g. `justify-center w-11 h-11`). */
    className?: string
    children: ReactNode
}

/** A selectable cell in a popover option grid; `active` carries the loud primary fill. */
export function PopoverOption({ active, onClick, ariaLabel, title, className, children }: PopoverOptionProps) {
    return (
        <button
            type="button"
            aria-pressed={active}
            aria-label={ariaLabel}
            title={title}
            onClick={onClick}
            className={[
                'flex items-center rounded-md cursor-pointer border-0 shrink-0',
                'transition-[background-color,color] duration-150 ease-solkey',
                'focus-ring',
                active
                    ? 'bg-primary-container text-on-primary-container'
                    : 'bg-surface-container-low text-on-surface hover:bg-surface-container',
                className ?? '',
            ]
                .filter(Boolean)
                .join(' ')}>
            {children}
        </button>
    )
}
