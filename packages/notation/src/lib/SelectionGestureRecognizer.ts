/** Press-and-hold duration that turns a touch into the selection-menu gesture. */
const LONG_PRESS_MS = 500
/** Two taps on the same element within this window form a double-tap. */
const DOUBLE_TAP_MS = 300
/** Pointer travel (client px) beyond which a press stops being a tap/long-press. */
const TAP_SLOP_PX = 10

/** A completed menu gesture: the element it targets (where the menu goes is the host's call). */
export interface SelectionMenuGesture<T> {
    target: T
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

/** The parts of a pointer event the recognizer reads — React's synthetic events and DOM events both fit. */
export interface GesturePointer {
    clientX: number
    clientY: number
    shiftKey: boolean
}

/** The recognizer's outward face: element handlers to wire up, and press-state queries. */
export interface SelectionGestures<T> {
    /** Feed a pointerdown that hit `target` (don't call for presses on dead space). */
    pointerDown: (e: GesturePointer, target: T) => void
    /** Feed every pointermove with the element under the pointer (null over dead space). */
    pointerMove: (e: GesturePointer, target: T | null) => void
    /** Wire to `onContextMenu`: suppresses the browser's long-press menu while menu gestures are active. */
    contextMenu: (e: Pick<Event, 'preventDefault'>) => void
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
 * can end anywhere, so the release is observed on the target passed to {@link attach} (the
 * window), and the trailing click of a drag or menu gesture is reported via
 * {@link clickSuppressed} so click-actions don't double-fire. The handlers are arrow-function
 * properties: stable identities that can be passed around unbound.
 */
export class SelectionGestureRecognizer<T> implements SelectionGestures<T> {
    /** Read on every event, so the host can swap callbacks without re-binding anything. */
    options: SelectionGestureOptions<T>

    private press: Press<T> | null = null
    /** The finished press, kept until the next one — the trailing click event consults it. */
    private lastPress: Press<T> | null = null
    private longPressTimer: ReturnType<typeof setTimeout> | null = null
    private lastTap: { id: string; time: number } | null = null
    private attachedTo: EventTarget | null = null

    constructor(options: SelectionGestureOptions<T>) {
        this.options = options
    }

    /**
     * Start observing where presses end — outside the element, off-screen, or stolen by a
     * scroll gesture (pointercancel) — on `target`, normally the window. Idempotent, and
     * re-attachable after {@link dispose} (React StrictMode runs effects twice).
     */
    attach(target: EventTarget): void {
        if (this.attachedTo === target) return
        this.dispose()
        target.addEventListener('pointerup', this.onPointerUp)
        target.addEventListener('pointercancel', this.onPointerCancel)
        this.attachedTo = target
    }

    /** Stop observing releases and drop a pending long-press. */
    dispose(): void {
        this.clearLongPress()
        if (!this.attachedTo) return
        this.attachedTo.removeEventListener('pointerup', this.onPointerUp)
        this.attachedTo.removeEventListener('pointercancel', this.onPointerCancel)
        this.attachedTo = null
    }

    pointerDown = (e: GesturePointer, target: T): void => {
        const { targetId, isSelected, onSelectionStart, onSelectionExtend, onSelectionMenu } = this.options
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
        this.press = press
        this.lastPress = press
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
            this.clearLongPress()
            this.longPressTimer = setTimeout(() => {
                this.longPressTimer = null
                if (this.press !== press || press.dragged) return
                press.menuFired = true
                this.options.onSelectionMenu?.({ target: press.target })
            }, LONG_PRESS_MS)
        }
    }

    pointerMove = (e: GesturePointer, target: T | null): void => {
        const press = this.press
        if (!press || press.menuFired) return
        if (Math.hypot(e.clientX - press.downX, e.clientY - press.downY) > TAP_SLOP_PX) this.clearLongPress()
        if (!target) return
        const id = this.options.targetId(target)
        if (id === press.lastId) return
        // Reached another element: it's a range drag from here on.
        this.clearLongPress()
        press.dragged = true
        press.lastTarget = target
        press.lastId = id
        this.options.onSelectionExtend?.(target)
    }

    contextMenu = (e: Pick<Event, 'preventDefault'>): void => {
        // Android surfaces its own context menu on long-press; ours replaces it.
        if (this.options.onSelectionMenu) e.preventDefault()
    }

    pressed = (): boolean => this.press !== null

    dragged = (): boolean => (this.press ?? this.lastPress)?.dragged ?? false

    clickSuppressed = (): boolean => {
        const press = this.press ?? this.lastPress
        return press ? press.dragged || press.menuFired : false
    }

    private readonly onPointerUp = (): void => this.release(false)
    private readonly onPointerCancel = (): void => this.release(true)

    private release(cancelled: boolean): void {
        this.clearLongPress()
        const press = this.press
        if (!press) return
        this.press = null
        this.lastPress = press
        if (cancelled || press.menuFired) return

        const { onSelectionStart, onSelectionMenu } = this.options
        if (press.dragged) {
            // Lifting a range drag is a completed selection gesture — surface the menu there.
            press.menuFired = true
            onSelectionMenu?.({ target: press.lastTarget })
            return
        }
        const now = performance.now()
        const lastTap = this.lastTap
        if (onSelectionMenu && lastTap && lastTap.id === press.id && now - lastTap.time < DOUBLE_TAP_MS) {
            this.lastTap = null
            press.menuFired = true
            onSelectionMenu({ target: press.target })
            return
        }
        if (press.deferredCollapse) onSelectionStart?.(press.target)
        this.lastTap = { id: press.id, time: now }
    }

    private clearLongPress(): void {
        if (this.longPressTimer !== null) clearTimeout(this.longPressTimer)
        this.longPressTimer = null
    }
}
