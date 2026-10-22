import {
    type SelectionGestureOptions,
    SelectionGestureRecognizer,
    type SelectionMenuGesture,
} from '@mushee/notation/lib/SelectionGestureRecognizer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** A pointer at a client point; shift-held when asked. */
function at(clientX = 0, clientY = 0, shiftKey = false) {
    return { clientX, clientY, shiftKey }
}

/** A recognizer over string targets (the id is the string), attached to a stand-in window. */
function setup(overrides: Partial<SelectionGestureOptions<string>> = {}) {
    const window = new EventTarget()
    const onSelectionStart = vi.fn<(target: string) => void>()
    const onSelectionExtend = vi.fn<(target: string) => void>()
    const onSelectionMenu = vi.fn<(gesture: SelectionMenuGesture<string>) => void>()
    const recognizer = new SelectionGestureRecognizer<string>({
        targetId: (target) => target,
        onSelectionStart,
        onSelectionExtend,
        onSelectionMenu,
        ...overrides,
    })
    recognizer.attach(window)
    return {
        recognizer,
        window,
        onSelectionStart,
        onSelectionExtend,
        onSelectionMenu,
        up: () => window.dispatchEvent(new Event('pointerup')),
        cancel: () => window.dispatchEvent(new Event('pointercancel')),
    }
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
})

afterEach(() => {
    vi.useRealTimers()
})

describe('SelectionGestureRecognizer', () => {
    it('starts a selection on a plain press; the tap opens no menu and leaves the click alone', () => {
        const { recognizer, onSelectionStart, onSelectionMenu, up } = setup()

        recognizer.pointerDown(at(), 'a')
        expect(onSelectionStart).toHaveBeenCalledWith('a')
        expect(recognizer.pressed()).toBe(true)

        up()
        expect(recognizer.pressed()).toBe(false)
        expect(onSelectionMenu).not.toHaveBeenCalled()
        expect(recognizer.dragged()).toBe(false)
        expect(recognizer.clickSuppressed()).toBe(false)
    })

    it('opens the menu on a long-press, and the release neither selects again nor lets the click through', () => {
        const { recognizer, onSelectionStart, onSelectionMenu, up } = setup()

        recognizer.pointerDown(at(), 'a')
        vi.advanceTimersByTime(499)
        expect(onSelectionMenu).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(onSelectionMenu).toHaveBeenCalledExactlyOnceWith({ target: 'a' })
        expect(recognizer.clickSuppressed()).toBe(true)

        up()
        expect(onSelectionStart).toHaveBeenCalledTimes(1)
        expect(onSelectionMenu).toHaveBeenCalledTimes(1)
        expect(recognizer.clickSuppressed()).toBe(true)
    })

    it('ignores moves once the long-press menu fired', () => {
        const { recognizer, onSelectionExtend } = setup()

        recognizer.pointerDown(at(), 'a')
        vi.advanceTimersByTime(500)
        recognizer.pointerMove(at(40, 0), 'b')

        expect(onSelectionExtend).not.toHaveBeenCalled()
        expect(recognizer.dragged()).toBe(false)
    })

    it('keeps the long-press within the tap slop and cancels it beyond', () => {
        const within = setup()
        within.recognizer.pointerDown(at(), 'a')
        within.recognizer.pointerMove(at(6, 6), 'a') // ~8.5px of travel
        vi.advanceTimersByTime(500)
        expect(within.onSelectionMenu).toHaveBeenCalledOnce()

        const beyond = setup()
        beyond.recognizer.pointerDown(at(), 'a')
        beyond.recognizer.pointerMove(at(11, 0), 'a')
        vi.advanceTimersByTime(500)
        expect(beyond.onSelectionMenu).not.toHaveBeenCalled()
        // Still a press on the same element: no drag, and its release is a plain tap.
        expect(beyond.recognizer.dragged()).toBe(false)
        beyond.up()
        expect(beyond.recognizer.clickSuppressed()).toBe(false)
    })

    it('opens the menu on a double-tap of the same element', () => {
        const { recognizer, onSelectionStart, onSelectionMenu, up } = setup()

        recognizer.pointerDown(at(), 'a')
        up()
        vi.advanceTimersByTime(299)
        recognizer.pointerDown(at(), 'a')
        up()

        expect(onSelectionStart).toHaveBeenCalledTimes(2)
        expect(onSelectionMenu).toHaveBeenCalledExactlyOnceWith({ target: 'a' })
        expect(recognizer.clickSuppressed()).toBe(true)
    })

    it('does not count taps too far apart, or on different elements, as a double-tap', () => {
        const slow = setup()
        slow.recognizer.pointerDown(at(), 'a')
        slow.up()
        vi.advanceTimersByTime(300)
        slow.recognizer.pointerDown(at(), 'a')
        slow.up()
        expect(slow.onSelectionMenu).not.toHaveBeenCalled()

        const apart = setup()
        apart.recognizer.pointerDown(at(), 'a')
        apart.up()
        apart.recognizer.pointerDown(at(), 'b')
        apart.up()
        expect(apart.onSelectionMenu).not.toHaveBeenCalled()
    })

    it('starts a fresh double-tap window after one completes', () => {
        const { recognizer, onSelectionMenu, up } = setup()

        for (let i = 0; i < 3; i++) {
            recognizer.pointerDown(at(), 'a')
            up()
        }

        // Taps 1+2 form a double-tap; tap 3 only starts the next window.
        expect(onSelectionMenu).toHaveBeenCalledOnce()
    })

    it('extends the selection while dragging across elements and opens the menu on release', () => {
        const { recognizer, onSelectionExtend, onSelectionMenu, up } = setup()

        recognizer.pointerDown(at(), 'a')
        recognizer.pointerMove(at(2, 0), 'a') // same element: nothing yet
        expect(onSelectionExtend).not.toHaveBeenCalled()

        recognizer.pointerMove(at(30, 0), 'b')
        recognizer.pointerMove(at(31, 0), 'b') // still on b: no repeat
        recognizer.pointerMove(at(40, 0), null) // dead space keeps the drag
        recognizer.pointerMove(at(60, 0), 'c')
        expect(onSelectionExtend.mock.calls).toEqual([['b'], ['c']])
        expect(recognizer.dragged()).toBe(true)

        // Reaching another element cancelled the long-press.
        vi.advanceTimersByTime(500)
        expect(onSelectionMenu).not.toHaveBeenCalled()

        up()
        expect(onSelectionMenu).toHaveBeenCalledExactlyOnceWith({ target: 'c' })
        expect(recognizer.clickSuppressed()).toBe(true)
        // The drag stays visible to the trailing click until the next press.
        expect(recognizer.dragged()).toBe(true)
        recognizer.pointerDown(at(), 'a')
        expect(recognizer.dragged()).toBe(false)
    })

    it('defers the collapse onto an already-selected element to the release', () => {
        const { recognizer, onSelectionStart, up } = setup({ isSelected: (target) => target === 'a' })

        recognizer.pointerDown(at(), 'a')
        expect(onSelectionStart).not.toHaveBeenCalled()
        up()
        expect(onSelectionStart).toHaveBeenCalledExactlyOnceWith('a')
    })

    it('opens the menu over the existing selection on a long-press of a selected element', () => {
        const { recognizer, onSelectionStart, onSelectionMenu, up } = setup({ isSelected: () => true })

        recognizer.pointerDown(at(), 'a')
        vi.advanceTimersByTime(500)
        up()

        expect(onSelectionMenu).toHaveBeenCalledExactlyOnceWith({ target: 'a' })
        expect(onSelectionStart).not.toHaveBeenCalled()
    })

    it('collapses on press when menu gestures are off, selected or not', () => {
        const { recognizer, onSelectionStart } = setup({ isSelected: () => true, onSelectionMenu: undefined })

        recognizer.pointerDown(at(), 'a')

        expect(onSelectionStart).toHaveBeenCalledExactlyOnceWith('a')
    })

    it('extends instead of starting on a shift-press', () => {
        const { recognizer, onSelectionStart, onSelectionExtend } = setup()

        recognizer.pointerDown(at(0, 0, true), 'b')

        expect(onSelectionExtend).toHaveBeenCalledExactlyOnceWith('b')
        expect(onSelectionStart).not.toHaveBeenCalled()
    })

    it('drops the gesture on pointercancel: no long-press, no drag-release menu', () => {
        const held = setup()
        held.recognizer.pointerDown(at(), 'a')
        held.cancel()
        vi.advanceTimersByTime(500)
        expect(held.onSelectionMenu).not.toHaveBeenCalled()
        expect(held.recognizer.pressed()).toBe(false)

        const dragging = setup()
        dragging.recognizer.pointerDown(at(), 'a')
        dragging.recognizer.pointerMove(at(30, 0), 'b')
        dragging.cancel()
        expect(dragging.onSelectionMenu).not.toHaveBeenCalled()
        // The cancelled drag still marks its trailing click as exhaust.
        expect(dragging.recognizer.clickSuppressed()).toBe(true)
    })

    it('does not count a cancelled tap toward a double-tap', () => {
        const { recognizer, onSelectionMenu, up, cancel } = setup()

        recognizer.pointerDown(at(), 'a')
        cancel()
        recognizer.pointerDown(at(), 'a')
        up()

        expect(onSelectionMenu).not.toHaveBeenCalled()
    })

    it('ignores releases and moves with no press in progress', () => {
        const { recognizer, onSelectionExtend, onSelectionMenu, up } = setup()

        up()
        recognizer.pointerMove(at(30, 0), 'b')

        expect(onSelectionExtend).not.toHaveBeenCalled()
        expect(onSelectionMenu).not.toHaveBeenCalled()
        expect(recognizer.pressed()).toBe(false)
        expect(recognizer.dragged()).toBe(false)
        expect(recognizer.clickSuppressed()).toBe(false)
    })

    it('has no menu gestures without a menu callback', () => {
        const { recognizer, onSelectionExtend, up } = setup({ onSelectionMenu: undefined })
        const contextMenu = { preventDefault: vi.fn() }

        recognizer.pointerDown(at(), 'a')
        vi.advanceTimersByTime(500)
        recognizer.pointerMove(at(30, 0), 'b')
        up()
        recognizer.contextMenu(contextMenu)

        // Plain drag selection still works; nothing asks for a menu.
        expect(onSelectionExtend).toHaveBeenCalledWith('b')
        expect(contextMenu.preventDefault).not.toHaveBeenCalled()
    })

    it("suppresses the browser's context menu while menu gestures are active", () => {
        const { recognizer } = setup()
        const contextMenu = { preventDefault: vi.fn() }

        recognizer.contextMenu(contextMenu)

        expect(contextMenu.preventDefault).toHaveBeenCalledOnce()
    })

    it('reads the latest options on every event', () => {
        const { recognizer, onSelectionStart } = setup()
        const replacement = vi.fn<(target: string) => void>()

        recognizer.options = { ...recognizer.options, onSelectionStart: replacement }
        recognizer.pointerDown(at(), 'a')

        expect(onSelectionStart).not.toHaveBeenCalled()
        expect(replacement).toHaveBeenCalledWith('a')
    })

    describe('attach / dispose', () => {
        it('attaches idempotently: one release per event', () => {
            const { recognizer, window, onSelectionMenu, up } = setup()
            recognizer.attach(window)

            recognizer.pointerDown(at(), 'a')
            recognizer.pointerMove(at(30, 0), 'b')
            up()

            expect(onSelectionMenu).toHaveBeenCalledOnce()
        })

        it('stops observing releases and drops a pending long-press on dispose', () => {
            const { recognizer, onSelectionMenu, up } = setup()

            recognizer.pointerDown(at(), 'a')
            recognizer.dispose()
            vi.advanceTimersByTime(500)
            up()

            expect(onSelectionMenu).not.toHaveBeenCalled()
            expect(recognizer.pressed()).toBe(true)
            recognizer.dispose() // a second dispose is a no-op
        })

        it('re-attaches after dispose (StrictMode mounts effects twice)', () => {
            const { recognizer, window, up } = setup()

            recognizer.dispose()
            recognizer.attach(window)
            recognizer.pointerDown(at(), 'a')
            up()

            expect(recognizer.pressed()).toBe(false)
        })

        it('moves its listeners when attached to another target', () => {
            const { recognizer, up } = setup()
            const other = new EventTarget()

            recognizer.attach(other)
            recognizer.pointerDown(at(), 'a')
            up() // the old target no longer reaches it
            expect(recognizer.pressed()).toBe(true)

            other.dispatchEvent(new Event('pointerup'))
            expect(recognizer.pressed()).toBe(false)
        })
    })
})
