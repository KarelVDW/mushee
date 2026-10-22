import { describe, expect, it, vi } from 'vitest'

import { CursorManager } from '@/lib/CursorManager'

function svgRect(): SVGRectElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'rect')
}

/** Fake scheduler: a fixed position (or none) and a fixed finished verdict. */
function fakeScheduler(position: { measureIndex: number; beat: number } | null, finished = false) {
    return { positionAt: vi.fn(() => position), hasFinishedAt: vi.fn(() => finished) }
}

function fakePlayer(currentTime = 0) {
    return { player: { currentTime } }
}

describe('CursorManager', () => {
    it('does nothing when there is no position and it is not bound', () => {
        const { player } = fakePlayer(0.5)
        const cm = new CursorManager(player, fakeScheduler(null))
        expect(cm.tick()).toBe(false)
    })

    it('asks the scheduler for the position at the clock time and draws the resolved point', () => {
        const { player } = fakePlayer(1.25)
        const rect = svgRect()
        const scheduler = fakeScheduler({ measureIndex: 1, beat: 2 })
        const cm = new CursorManager(player, scheduler)
        const resolve = vi.fn().mockReturnValue({ x: 100, rowY: 20 })
        cm.bind(rect, resolve)

        cm.tick()

        expect(scheduler.positionAt).toHaveBeenCalledWith(1.25)
        expect(resolve).toHaveBeenCalledWith({ measureIndex: 1, beat: 2 })
        // x = resolved.x - 1.5
        expect(rect.getAttribute('x')).toBe('98.5')
        expect(rect.getAttribute('transform')).toBe('translate(0, 20)')
        expect(rect.getAttribute('display')).toBe('')
    })

    it('leaves the cursor alone when the scheduler has no position yet', () => {
        const { player } = fakePlayer(-1)
        const rect = svgRect()
        const cm = new CursorManager(player, fakeScheduler(null))
        const resolve = vi.fn().mockReturnValue({ x: 5, rowY: 5 })
        cm.bind(rect, resolve)

        expect(cm.tick()).toBe(false)
        expect(resolve).not.toHaveBeenCalled()
        expect(rect.getAttribute('x')).toBeNull()
    })

    it('does not set attributes when resolvePosition returns null', () => {
        const { player } = fakePlayer(0)
        const rect = svgRect()
        const cm = new CursorManager(player, fakeScheduler({ measureIndex: 0, beat: 0 }))
        cm.bind(rect, () => null)

        cm.tick()
        expect(rect.getAttribute('x')).toBeNull()
        expect(rect.getAttribute('display')).toBeNull()
    })

    it('does not move the cursor when bound element/resolver is missing (not bound)', () => {
        const { player } = fakePlayer(0)
        const cm = new CursorManager(player, fakeScheduler({ measureIndex: 0, beat: 0 }))
        // No bind() call.
        expect(cm.tick()).toBe(false)
    })

    it('hides the cursor and reports done once the scheduler has finished', () => {
        const { player } = fakePlayer(10)
        const rect = svgRect()
        const scheduler = fakeScheduler({ measureIndex: 0, beat: 4 }, true)
        const cm = new CursorManager(player, scheduler)
        cm.bind(rect, () => ({ x: 1, rowY: 1 }))

        const done = cm.tick()
        expect(scheduler.hasFinishedAt).toHaveBeenCalledWith(10)
        expect(done).toBe(true)
        expect(rect.getAttribute('display')).toBe('none')
    })

    it('keeps ticking while the scheduler has not finished', () => {
        const { player } = fakePlayer(2)
        const rect = svgRect()
        const cm = new CursorManager(player, fakeScheduler({ measureIndex: 0, beat: 0 }, false))
        cm.bind(rect, () => ({ x: 1, rowY: 1 }))
        expect(cm.tick()).toBe(false)
    })

    it('hideCursor() sets display none, and is safe when unbound', () => {
        const { player } = fakePlayer()
        const rect = svgRect()
        const bound = new CursorManager(player, fakeScheduler(null))
        bound.bind(rect, () => null)
        bound.hideCursor()
        expect(rect.getAttribute('display')).toBe('none')

        const unbound = new CursorManager(player, fakeScheduler(null))
        expect(() => unbound.hideCursor()).not.toThrow()
    })
})
