'use client'

import { useEffect, useMemo, useRef } from 'react'

/** Press-and-hold duration that turns a touch into the selection-menu gesture. */
const LONG_PRESS_MS = 500
/** Two taps on the same element within this window form a double-tap. */
const DOUBLE_TAP_MS = 300
/** Pointer travel (client px) beyond which a press stops being a tap/long-press. */
const TAP_SLOP_PX = 10

/** A completed menu gesture: the element it targets and the client point to anchor a menu at. */
export interface SelectionMenuGesture<T> {
    target: T
    clientX: number
    clientY: number
}

export interface SelectionGestureOptions<T> {
    /** Stable identity — how the recognizer tells "still on the same element" from "dragged onto another". */
    targetId: (target: T) => string
    /**
     * Whether an element is already part of the current selection. When menu gestures are
     * active, pressing a selected element defers the collapse to the release: a tap still
     * collapses onto it, but a long-press opens the menu over the *existing* selection.
     */
    isSelected?: (target: T) => boolean
    /** Begin a selection (plain press). */
    onSelectionStart?: (target: T) => void
    /** Extend the selection (shift-press, or a drag reaching another element). */
    onSelectionExtend?: (target: T) => void
    /**
     * A menu gesture completed: long-press, double-tap, or releasing a drag that extended the
     * selection — the moments Android surfaces its text-selection menu. Omit to disable menu
     * gestures entirely (plain press/drag selection still works).
     */
    onSelectionMenu?: (gesture: SelectionMenuGesture<T>) => void
}

/** The recognizer's outward face: element handlers to wire up, and press-state queries. */
export interface SelectionGestures<T> {
    /** Feed a pointerdown that hit `target` (don't call for presses on dead space). */
    pointerDown: (e: React.PointerEvent, target: T) => void
    /** Feed every pointermove with the element under the pointer (null over dead space). */
    pointerMove: (e: React.PointerEvent, target: T | null) => void
    /** Wire to `onContextMenu`: suppresses the browser's long-press menu while menu gestures are active. */
    contextMenu: (e: React.SyntheticEvent) => void
    /** True while a press is in progress (a drag may still develop). */
    pressed: () => boolean
    /** True when the press reached another element (a range drag) — lasts until the next press. */
    dragged: () => boolean
    /** True when the click event trailing the last press is gesture exhaust (drag or menu) and must be ignored. */
    clickSuppressed: () => boolean
}

/** The lifecycle of one press, from pointerdown to pointerup/cancel. */
interface Press<T> {
    target: T
    id: string
    downX: number
    downY: number
    /** Last element the drag extended to (starts at the pressed element). */
    lastTarget: T
    lastId: string
    dragged: boolean
    /** A menu gesture fired for this press — its release/click must not select or edit. */
    menuFired: boolean
    /** The pressed element was already selected: collapse on release instead of on press. */
    deferredCollapse: boolean
}

/**
 * Pointer-gesture recognizer for selectable elements — the interaction grammar of Android's
 * text selection, applied to anything with an id: press starts a selection, dragging across
 * elements extends it, and (when a menu callback is given) long-press, double-tap, and
 * drag-release ask for a selection menu.
 *
 * It is deliberately blind to what the elements are: callers resolve their own hit targets
 * and feed them in, so the same recognizer serves notes on a staff or anything else. Presses
 * can end anywhere (the recognizer listens for pointerup/cancel on the window), and the
 * trailing click of a drag or menu gesture is reported via {@link SelectionGestures.clickSuppressed}
 * so click-actions don't double-fire.
 */
export function useSelectionGestures<T>(options: SelectionGestureOptions<T>): SelectionGestures<T> {
    // Handlers read the latest options through a ref, so their identities stay stable
    // and the window listeners never need re-binding.
    const optionsRef = useRef(options)
    optionsRef.current = options

    const pressRef = useRef<Press<T> | null>(null)
    /** The finished press, kept until the next one — the trailing click event consults it. */
    const lastPressRef = useRef<Press<T> | null>(null)
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const lastTapRef = useRef<{ id: string; time: number } | null>(null)

    // Presses end wherever the pointer is — outside the element, off-screen, or stolen by a
    // scroll gesture (pointercancel) — so the release is observed on the window.
    useEffect(() => {
        const clearLongPress = () => {
            if (longPressTimerRef.current !== null) clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
        }

        const release = (e: PointerEvent, cancelled: boolean) => {
            clearLongPress()
            const press = pressRef.current
            if (!press) return
            pressRef.current = null
            lastPressRef.current = press
            if (cancelled || press.menuFired) return

            const { onSelectionStart, onSelectionMenu } = optionsRef.current
            if (press.dragged) {
                // Lifting a range drag is a completed selection gesture — surface the menu there.
                press.menuFired = true
                onSelectionMenu?.({ target: press.lastTarget, clientX: e.clientX, clientY: e.clientY })
                return
            }
            const now = performance.now()
            const lastTap = lastTapRef.current
            if (onSelectionMenu && lastTap && lastTap.id === press.id && now - lastTap.time < DOUBLE_TAP_MS) {
                lastTapRef.current = null
                press.menuFired = true
                onSelectionMenu({ target: press.target, clientX: e.clientX, clientY: e.clientY })
                return
            }
            if (press.deferredCollapse) onSelectionStart?.(press.target)
            lastTapRef.current = { id: press.id, time: now }
        }

        const onUp = (e: PointerEvent) => release(e, false)
        const onCancel = (e: PointerEvent) => release(e, true)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onCancel)
        return () => {
            clearLongPress()
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onCancel)
        }
    }, [])

    return useMemo<SelectionGestures<T>>(() => {
        const cancelLongPress = () => {
            if (longPressTimerRef.current !== null) clearTimeout(longPressTimerRef.current)
            longPressTimerRef.current = null
        }

        return {
            pointerDown: (e, target) => {
                const { targetId, isSelected, onSelectionStart, onSelectionExtend, onSelectionMenu } = optionsRef.current
                const id = targetId(target)
                const press: Press<T> = {
                    target,
                    id,
                    downX: e.clientX,
                    downY: e.clientY,
                    lastTarget: target,
                    lastId: id,
                    dragged: false,
                    menuFired: false,
                    deferredCollapse: false,
                }
                pressRef.current = press
                lastPressRef.current = press
                if (e.shiftKey) {
                    onSelectionExtend?.(target)
                } else if (onSelectionMenu && isSelected?.(target)) {
                    // Keep the existing selection alive: a long-press wants the menu over it,
                    // and only a plain tap (resolved on release) collapses onto this element.
                    press.deferredCollapse = true
                } else {
                    onSelectionStart?.(target)
                }
                if (onSelectionMenu) {
                    cancelLongPress()
                    longPressTimerRef.current = setTimeout(() => {
                        longPressTimerRef.current = null
                        if (pressRef.current !== press || press.dragged) return
                        press.menuFired = true
                        optionsRef.current.onSelectionMenu?.({ target: press.target, clientX: press.downX, clientY: press.downY })
                    }, LONG_PRESS_MS)
                }
            },

            pointerMove: (e, target) => {
                const press = pressRef.current
                if (!press || press.menuFired) return
                if (Math.hypot(e.clientX - press.downX, e.clientY - press.downY) > TAP_SLOP_PX) cancelLongPress()
                if (!target) return
                const id = optionsRef.current.targetId(target)
                if (id === press.lastId) return
                // Reached another element: it's a range drag from here on.
                cancelLongPress()
                press.dragged = true
                press.lastTarget = target
                press.lastId = id
                optionsRef.current.onSelectionExtend?.(target)
            },

            contextMenu: (e) => {
                // Android surfaces its own context menu on long-press; ours replaces it.
                if (optionsRef.current.onSelectionMenu) e.preventDefault()
            },

            pressed: () => pressRef.current !== null,
            dragged: () => (pressRef.current ?? lastPressRef.current)?.dragged ?? false,
            clickSuppressed: () => {
                const press = pressRef.current ?? lastPressRef.current
                return press ? press.dragged || press.menuFired : false
            },
        }
    }, [])
}
