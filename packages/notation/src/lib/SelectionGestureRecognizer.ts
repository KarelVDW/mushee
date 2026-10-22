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
    /**
     * Whether an element is the whole selection (the one selected element). With menu gestures
     * active, a plain tap on it opens the menu — the second tap of "tap to select, tap again
     * for actions". A tap inside a larger selection still collapses onto the tapped element.
     */
    isOnlySelected?: (target: T) => boolean
    /** Begin a selection (plain press). */
    onSelectionStart?: (target: T) => void
    /** Extend the selection (shift-press, or a drag reaching another element). */
    onSelectionExtend?: (target: T) => void
    /**
     * A menu gesture completed. Touch and pen: long-press, double-tap, a tap on the only
     * selected element, or releasing a drag that extended the selection — the moments Android
     * surfaces its text-selection menu. Mouse: a right-click on an element, or releasing a
     * drag that extended the selection; a plain click or double-click never opens it. Omit to
     * disable menu gestures entirely (plain press/drag selection still works).
     */
    onSelectionMenu?: (gesture: SelectionMenuGesture<T>) => void
}

/** The parts of a pointer event the recognizer reads — React's synthetic events and DOM events both fit. */
export interface GesturePointer {
    clientX: number
    clientY: number
    shiftKey: boolean
    /** 'mouse' switches to the desktop grammar; anything else (touch, pen, unknown) is touch. */
    pointerType?: string
    /** The pressed button: 2 is the secondary (right) button. */
    button?: number
}

/** What {@link SelectionGestures.contextMenu} reads of a contextmenu event. */
export interface GestureContextMenu {
    preventDefault: () => void
    /** Set where the browser reports it (contextmenu as a PointerEvent); otherwise the last press decides. */
    pointerType?: string
}

/** The recognizer's outward face: element handlers to wire up, and press-state queries. */
export interface SelectionGestures<T> {
    /** Feed a pointerdown that hit `target` (don't call for presses on dead space). */
    pointerDown: (e: GesturePointer, target: T) => void
    /** Feed every pointermove with the element under the pointer (null over dead space). */
    pointerMove: (e: GesturePointer, target: T | null) => void
    /**
     * Wire to `onContextMenu`, with the element under the pointer (null over dead space). While
     * menu gestures are active, a mouse right-click on an element opens the menu over it (the
     * browser's own menu stays for dead space); on touch it suppresses the browser's long-press
     * menu, since the long-press opens ours.
     */
    contextMenu: (e: GestureContextMenu, target?: T | null) => void
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
    /** The pressed element was the only selected one: a plain tap on it opens the menu. */
    reopensMenu: boolean
    /** A mouse press: no long-press, no double-tap, no deferred collapse. */
    mouse: boolean
}

/**
 * Pointer-gesture recognizer for selectable elements — the interaction grammar of Android's
 * text selection, applied to anything with an id: press starts a selection, dragging across
 * elements extends it, and (when a menu callback is given) long-press, double-tap, a tap on
 * the only selected element, and drag-release ask for a selection menu. A mouse keeps the
 * desktop grammar instead: clicks stay clicks, and the menu comes from a right-click or a
 * drag-release.
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
    /** The pointer type of the latest press — a contextmenu event that doesn't carry one is judged by it. */
    private lastPointerType: string | undefined
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
        const { targetId, isSelected, isOnlySelected, onSelectionStart, onSelectionExtend, onSelectionMenu } = this.options
        const mouse = e.pointerType === 'mouse'
        this.lastPointerType = e.pointerType
        if (mouse && e.button === 2) {
            // A right-button press only readies the context menu: it starts no press or drag, keeps
            // a selection it lands in (the menu acts on all of it), and selects a note outside one.
            if (!isSelected?.(target)) onSelectionStart?.(target)
            return
        }
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
            reopensMenu: false,
            mouse,
        }
        this.press = press
        this.lastPress = press
        if (e.shiftKey) {
            onSelectionExtend?.(target)
        } else if (onSelectionMenu && !mouse && isSelected?.(target)) {
            // Keep the existing selection alive: a long-press wants the menu over it, a tap on
            // the only selected element wants it too, and only a plain tap inside a larger
            // selection (resolved on release) collapses onto this element.
            press.deferredCollapse = true
            press.reopensMenu = isOnlySelected?.(target) ?? false
        } else {
            onSelectionStart?.(target)
        }
        if (onSelectionMenu && !mouse) {
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

    contextMenu = (e: GestureContextMenu, target: T | null = null): void => {
        const { onSelectionMenu } = this.options
        if (!onSelectionMenu) return
        if ((e.pointerType || this.lastPointerType) === 'mouse') {
            // A right-click opens our menu over the element it lands on (selected by the press);
            // over dead space the browser's own menu stays.
            if (!target) return
            e.preventDefault()
            onSelectionMenu({ target })
            return
        }
        // Android surfaces its own context menu on long-press; ours replaces it.
        e.preventDefault()
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
        // A mouse click is a plain click: double-clicks and click-to-pitch never open the menu.
        if (press.mouse) return
        const now = performance.now()
        const lastTap = this.lastTap
        const doubleTap = lastTap !== null && lastTap.id === press.id && now - lastTap.time < DOUBLE_TAP_MS
        if (onSelectionMenu && (doubleTap || press.reopensMenu)) {
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
