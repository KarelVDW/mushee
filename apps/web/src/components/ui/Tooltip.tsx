'use client'

import {
    type CSSProperties,
    type FocusEvent as ReactFocusEvent,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type ReactNode,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'

import type { Shortcut } from '@/lib/Keybindings'

/** Mouse hover this long before a tooltip opens. */
export const TOOLTIP_HOVER_DELAY_MS = 400
/** A touch press held this long names the control in a bubble. */
export const TOOLTIP_HOLD_DELAY_MS = 450
/** How long the touch bubble stays up after the finger lifts. */
export const TOOLTIP_HOLD_LINGER_MS = 1500
/** A held finger that slides further than this has changed its mind: no bubble, no action. */
export const TOOLTIP_SLIDE_CANCEL_PX = 10
/** Gap between the control and its tooltip, and the minimum distance from the viewport edge. */
const GAP_PX = 8

/** True on macOS/iOS — shortcuts render as ⇧⌘Z there and as Ctrl+Shift+Z elsewhere. False on the server. */
function isApplePlatform(): boolean {
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

const noSubscription = () => () => {}

/**
 * {@link isApplePlatform} for rendering: false on the server and through hydration, so the
 * server's markup and the client's first render name the key alike; the Apple form follows
 * straight after.
 */
function useIsApple(): boolean {
    return useSyncExternalStore(noSubscription, isApplePlatform, () => false)
}

/**
 * The key a tooltip names: a live binding from the editor's Keybindings (so a rebound command
 * shows its new key), or display tokens the caller already resolved (e.g. through the browser's
 * layout map). Null or omitted when the command is unbound — the tooltip then leaves the key out.
 */
export type TooltipShortcut = Shortcut | readonly string[] | null

type OpenedBy = 'hover' | 'focus' | 'hold'

interface TooltipProps {
    /** The control's name — the first part of "Name — hint · key". The trigger's aria-label stays its accessible name. */
    label?: string
    /** One plain line saying what the control does. */
    hint?: string
    /** Its shortcut; shown only to fine pointers and keyboards, never in the touch bubble. */
    shortcut?: TooltipShortcut
    /** Why the control can't be used right now. Replaces name, hint and key while set. */
    reason?: string
    /** Which side of the control the tooltip sits on: `top` for the dock, `bottom` for header chrome. */
    side?: 'top' | 'bottom'
    /** The control. Its first focusable element is described by the tooltip's hint, key or reason. */
    children: ReactNode
}

/**
 * Focus a control without opening its tooltip — for focus handed back by a closing popover,
 * menu or dialog, which the user didn't move there themselves.
 */
let suppressFocusTooltip = false
export function focusWithoutTooltip(el: HTMLElement | null | undefined): void {
    if (!el) return
    suppressFocusTooltip = true
    try {
        el.focus()
    } finally {
        suppressFocusTooltip = false
    }
}

/** The shortcut as the text a tooltip shows: ⇧⌘Z on Apple platforms, Ctrl+Shift+Z elsewhere. */
export function shortcutText(shortcut: TooltipShortcut | undefined, isApple: boolean = isApplePlatform()): string | null {
    if (!shortcut) return null
    const parts = isShortcutParts(shortcut) ? shortcut : shortcut.displayParts(null, isApple)
    if (parts.length === 0) return null
    return parts.join(isApple ? '' : '+')
}

function isShortcutParts(shortcut: Shortcut | readonly string[]): shortcut is readonly string[] {
    return Array.isArray(shortcut)
}

/**
 * The visible name of an icon-only control: "Name — hint · key" (contract C2).
 *
 * - Fine pointers: opens after {@link TOOLTIP_HOVER_DELAY_MS} of mouse hover, or at once on
 *   keyboard focus (`:focus-visible` only — focus a popover or dialog hands back doesn't count,
 *   see {@link focusWithoutTooltip}). Closes on pointer-leave, blur, a press (mouse, Enter or
 *   Space), or Escape, which it consumes so the editor's own Escape binding doesn't also fire —
 *   except inside a modal dialog, where the same Escape closes the dialog as well.
 * - Coarse pointers: never on hover. Holding a finger on the control for
 *   {@link TOOLTIP_HOLD_DELAY_MS} names it in a bubble above it, kept while held and for
 *   {@link TOOLTIP_HOLD_LINGER_MS} after release. Releasing on the control still acts; sliding
 *   off first cancels both.
 * - Never over the panel its control opened: while the trigger has aria-expanded="true" (a
 *   popover chip, a menu) the tooltip closes and stays shut, the touch bubble included.
 *
 * The trigger keeps its aria-label as its name; the hint, key or reason reach assistive tech
 * through aria-describedby on a hidden role=tooltip element that is always mounted, so the
 * description is there the moment focus lands. The wrapper span takes the pointer for a
 * natively disabled child, so a disabled control still shows its tooltip on hover.
 */
export function Tooltip({ label, hint, shortcut, reason, side = 'top', children }: TooltipProps) {
    const wrapperRef = useRef<HTMLSpanElement>(null)
    const descriptionId = useId()
    const [openedBy, setOpenedBy] = useState<OpenedBy | null>(null)
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const holdStart = useRef<{ x: number; y: number } | null>(null)
    /** Set when a held finger slid off: swallow the click its release would still fire. */
    const cancelNextClick = useRef(false)

    const isApple = useIsApple()
    const keys = reason ? null : shortcutText(shortcut, isApple)
    const description = reason ?? ([hint, keys].filter(Boolean).join(', ') || null)
    const empty = !label && !hint && !keys && !reason

    const clearTimers = useCallback(() => {
        for (const timer of [hoverTimer, holdTimer, lingerTimer]) {
            if (timer.current) clearTimeout(timer.current)
            timer.current = null
        }
    }, [])
    const close = useCallback(() => {
        clearTimers()
        holdStart.current = null
        setOpenedBy(null)
    }, [clearTimers])

    useEffect(() => clearTimers, [clearTimers])

    /** The control the tooltip names: the wrapped child's first focusable element. */
    const trigger = useCallback(() => wrapperRef.current?.querySelector<HTMLElement>(TRIGGER_SELECTOR) ?? null, [])
    /** Open, unless the control's own panel is showing — the tooltip would cover it. */
    const open = useCallback(
        (by: OpenedBy) => {
            if (trigger()?.getAttribute('aria-expanded') !== 'true') setOpenedBy(by)
        },
        [trigger],
    )

    // A control that opens a panel while its tooltip shows (a touch hold, a hover, or focus
    // kept on a chip) closes the tooltip, which would otherwise sit over that panel.
    useEffect(() => {
        const el = openedBy ? trigger() : null
        if (!el) return
        const observer = new MutationObserver(() => {
            if (el.getAttribute('aria-expanded') === 'true') close()
        })
        observer.observe(el, { attributes: true, attributeFilter: ['aria-expanded'] })
        return () => observer.disconnect()
    }, [openedBy, trigger, close])

    // Describe the trigger: its first focusable element points at the hidden tooltip text.
    useLayoutEffect(() => {
        const el = trigger()
        if (!el || !description) return
        const previous = el.getAttribute('aria-describedby')
        el.setAttribute('aria-describedby', previous ? `${previous} ${descriptionId}` : descriptionId)
        return () => {
            if (previous) el.setAttribute('aria-describedby', previous)
            else el.removeAttribute('aria-describedby')
        }
    }, [trigger, description, descriptionId])

    // Escape closes only the tooltip: consumed in the capture phase, before the editor's shortcuts.
    // Inside a modal dialog there are no editor shortcuts to shield, so the key goes on and the
    // same press closes the dialog too, as it did before the tooltip was there.
    useEffect(() => {
        if (!openedBy) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return
            close()
            if (wrapperRef.current?.closest('[aria-modal="true"]')) return
            e.preventDefault()
            e.stopPropagation()
        }
        const onScroll = () => close()
        window.addEventListener('keydown', onKey, { capture: true })
        window.addEventListener('scroll', onScroll, { capture: true, passive: true })
        return () => {
            window.removeEventListener('keydown', onKey, { capture: true })
            window.removeEventListener('scroll', onScroll, { capture: true })
        }
    }, [openedBy, close])

    if (empty) return <>{children}</>

    const onPointerEnter = (e: ReactPointerEvent) => {
        if (e.pointerType !== 'mouse' || openedBy) return
        clearTimers()
        hoverTimer.current = setTimeout(() => open('hover'), TOOLTIP_HOVER_DELAY_MS)
    }
    const onPointerLeave = (e: ReactPointerEvent) => {
        if (e.pointerType === 'mouse' && openedBy !== 'hold') close()
    }
    const onPointerDown = (e: ReactPointerEvent) => {
        cancelNextClick.current = false
        if (e.pointerType === 'mouse') {
            close()
            return
        }
        clearTimers()
        holdStart.current = { x: e.clientX, y: e.clientY }
        holdTimer.current = setTimeout(() => open('hold'), TOOLTIP_HOLD_DELAY_MS)
    }
    const onPointerMove = (e: ReactPointerEvent) => {
        const start = holdStart.current
        if (!start || e.pointerType === 'mouse') return
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TOOLTIP_SLIDE_CANCEL_PX) {
            cancelNextClick.current = true
            close()
        }
    }
    const onPointerUp = (e: ReactPointerEvent) => {
        if (e.pointerType === 'mouse') return
        if (holdTimer.current) clearTimeout(holdTimer.current)
        holdTimer.current = null
        holdStart.current = null
        if (openedBy === 'hold') lingerTimer.current = setTimeout(() => setOpenedBy(null), TOOLTIP_HOLD_LINGER_MS)
    }
    const onPointerCancel = () => {
        holdStart.current = null
        close()
    }
    const onClickCapture = (e: ReactMouseEvent) => {
        if (!cancelNextClick.current) return
        cancelNextClick.current = false
        e.preventDefault()
        e.stopPropagation()
    }
    // The control was used — by Enter or Space too, not only a mouse press — so its name has
    // done its job. A touch hold's bubble keeps its linger (unless the press opened a panel).
    const onClick = () => {
        if (openedBy && openedBy !== 'hold') close()
    }
    const onContextMenu = (e: ReactMouseEvent) => {
        // A held finger raises the context menu on Android and the callout on iOS — never here.
        if (holdStart.current || openedBy === 'hold') e.preventDefault()
    }
    const onFocus = (e: ReactFocusEvent) => {
        if (suppressFocusTooltip || !(e.target instanceof HTMLElement) || !matchesFocusVisible(e.target)) return
        clearTimers()
        open('focus')
    }
    const onBlur = () => {
        if (openedBy !== 'hold') close()
    }

    return (
        <span
            ref={wrapperRef}
            className="relative inline-flex shrink-0 select-none [-webkit-touch-callout:none] [&_:disabled]:pointer-events-none has-[:disabled]:cursor-not-allowed"
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onClickCapture={onClickCapture}
            onClick={onClick}
            onContextMenu={onContextMenu}
            onFocus={onFocus}
            onBlur={onBlur}>
            {children}
            {description && (
                <span id={descriptionId} role="tooltip" hidden>
                    {description}
                </span>
            )}
            {openedBy && (
                <TooltipCard
                    anchor={wrapperRef}
                    side={openedBy === 'hold' ? 'top' : side}
                    touch={openedBy === 'hold'}
                    label={reason ? undefined : label}
                    hint={reason ?? hint}
                    keys={openedBy === 'hold' ? null : keys}
                />
            )}
        </span>
    )
}

/** What the tooltip describes: the control itself, not a nested decoration. */
const TRIGGER_SELECTOR = 'button, [href], input, select, textarea, [tabindex]'

function matchesFocusVisible(el: HTMLElement): boolean {
    try {
        return el.matches(':focus-visible')
    } catch {
        // Engines without :focus-visible: treat any focus as keyboard focus.
        return true
    }
}

interface TooltipCardProps {
    anchor: { current: HTMLElement | null }
    side: 'top' | 'bottom'
    touch: boolean
    label?: string
    hint?: string
    keys: string | null
}

/**
 * The visible tooltip, portalled to <body> and fixed-positioned against its control so no
 * scrolling ancestor clips it and no blurred chrome shows through it. Clamped inside the
 * viewport, and flipped to the other side when its own side has no room. Decorative for
 * assistive tech — the hidden role=tooltip text carries the description.
 */
function TooltipCard({ anchor, side, touch, label, hint, keys }: TooltipCardProps) {
    const cardRef = useRef<HTMLSpanElement>(null)
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

    useLayoutEffect(() => {
        const trigger = anchor.current?.getBoundingClientRect()
        const card = cardRef.current?.getBoundingClientRect()
        if (!trigger || !card) return
        const maxLeft = window.innerWidth - GAP_PX - card.width
        const left = Math.max(GAP_PX, Math.min(trigger.left + trigger.width / 2 - card.width / 2, maxLeft))
        const above = trigger.top - GAP_PX - card.height
        const below = trigger.bottom + GAP_PX
        const fitsAbove = above >= GAP_PX
        const fitsBelow = below + card.height <= window.innerHeight - GAP_PX
        const top = side === 'top' ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above
        setPosition({ top, left })
    }, [anchor, side])

    const style: CSSProperties = position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: 'hidden' }
    const card = touch ? (
        <span
            ref={cardRef}
            aria-hidden="true"
            style={style}
            className="tooltip-enter fixed z-(--z-toast) pointer-events-none w-max max-w-[min(20rem,calc(100vw-1rem))] rounded-full bg-surface-container-high px-3 py-1.5 font-label font-semibold text-[13px] leading-[1.3] text-on-surface">
            {label}
            {label && hint && <span className="font-body font-normal text-on-surface-variant"> — {hint}</span>}
            {!label && hint}
        </span>
    ) : (
        <span
            ref={cardRef}
            aria-hidden="true"
            style={style}
            className="tooltip-enter fixed z-(--z-toast) pointer-events-none w-max max-w-60 rounded-md bg-surface-container-lowest editorial-shadow px-2.5 py-1.5 font-body text-[13px] leading-[1.35] text-on-surface">
            {label && <span className="font-label font-semibold">{label}</span>}
            {label && hint && <span className="text-on-surface-variant"> — </span>}
            {hint && <span className={label ? 'text-on-surface-variant' : undefined}>{hint}</span>}
            {keys && (
                <>
                    {(label || hint) && <span className="text-on-surface-variant"> · </span>}
                    <kbd className="font-label font-semibold text-[11px] leading-none text-on-surface bg-surface-container rounded-sm px-1.5 py-0.5">
                        {keys}
                    </kbd>
                </>
            )}
        </span>
    )
    return createPortal(card, document.body)
}
