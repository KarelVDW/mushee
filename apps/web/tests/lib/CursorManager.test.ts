import { describe, expect, it, vi } from 'vitest'

import { CursorManager } from '@/lib/CursorManager'
import type { MidiPlayer } from '@/lib/MidiPlayer'
import type { ScoreScheduler, TimelineEntry } from '@/lib/ScoreScheduler'

function svgRect(): SVGRectElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'rect')
}

/** Fake scheduler exposing the only members CursorManager touches. */
function fakeScheduler(entries: TimelineEntry[], endTime = -1) {
    return { entries, endTime } as unknown as ScoreScheduler
}

function fakePlayer(currentTime = 0) {
    const raw = { currentTime }
    return { player: raw as unknown as MidiPlayer, raw }
}

const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
    startTime: 0,
    duration: 1,
    beatSpan: 1,
    measureIndex: 0,
    beat: 0,
    ...over,
})

describe('CursorManager', () => {
    it('reset() is a no-op (no throw)', () => {
        const { player } = fakePlayer()
        const cm = new CursorManager(player, fakeScheduler([]))
        expect(() => cm.reset()).not.toThrow()
    })

    it('does nothing when no entries and not bound', () => {
        const { player } = fakePlayer(0.5)
        const cm = new CursorManager(player, fakeScheduler([]))
        expect(cm.tick()).toBe(false)
    })

    it('positions the cursor at the active timeline entry', () => {
        const { player } = fakePlayer(0)
        const rect = svgRect()
        const scheduler = fakeScheduler([entry({ startTime: 0, duration: 1, beat: 0, beatSpan: 1, measureIndex: 0 })])
        const cm = new CursorManager(player, scheduler)
        const resolve = vi.fn().mockReturnValue({ x: 100, rowY: 20 })
        cm.bind(rect, resolve)

        cm.tick()

        // x = resolved.x - 1.5
        expect(rect.getAttribute('x')).toBe('98.5')
        expect(rect.getAttribute('transform')).toBe('translate(0, 20)')
        expect(rect.getAttribute('display')).toBe('')
        // measureIndex 0, beat = 0 + 1*progress(0) = 0
        expect(resolve).toHaveBeenCalledWith({ measureIndex: 0, beat: 0 })
    })

    it('interpolates the beat by progress through the current entry', () => {
        const { player } = fakePlayer(0.5)
        const rect = svgRect()
        // entry of duration 1 starting at 0, beat 0, beatSpan 4: halfway => beat 2.
        const scheduler = fakeScheduler([entry({ startTime: 0, duration: 1, beat: 0, beatSpan: 4, measureIndex: 1 })])
        const cm = new CursorManager(player, scheduler)
        const resolve = vi.fn().mockReturnValue({ x: 10, rowY: 0 })
        cm.bind(rect, resolve)

        cm.tick()
        expect(resolve).toHaveBeenCalledWith({ measureIndex: 1, beat: 2 })
    })

    it('clamps progress to 1 when elapsed overshoots the entry duration', () => {
        const { player } = fakePlayer(5)
        const rect = svgRect()
        const scheduler = fakeScheduler([entry({ startTime: 0, duration: 1, beat: 0, beatSpan: 4, measureIndex: 0 })])
        const cm = new CursorManager(player, scheduler)
        const resolve = vi.fn().mockReturnValue({ x: 10, rowY: 0 })
        cm.bind(rect, resolve)

        cm.tick()
        // progress clamped to 1 => beat = 0 + 4*1 = 4.
        expect(resolve).toHaveBeenCalledWith({ measureIndex: 0, beat: 4 })
    })

    it('selects the latest entry whose startTime <= elapsed', () => {
        const { player } = fakePlayer(2.5)
        const rect = svgRect()
        const scheduler = fakeScheduler([
            entry({ startTime: 0, duration: 1, beat: 0, measureIndex: 0 }),
            entry({ startTime: 1, duration: 1, beat: 1, measureIndex: 0 }),
            entry({ startTime: 2, duration: 1, beat: 2, measureIndex: 0 }),
            entry({ startTime: 3, duration: 1, beat: 3, measureIndex: 0 }),
        ])
        const cm = new CursorManager(player, scheduler)
        const resolve = vi.fn().mockReturnValue({ x: 0, rowY: 0 })
        cm.bind(rect, resolve)

        cm.tick()
        // elapsed 2.5 => active entry is the one at startTime 2 (beat base 2), progress 0.5 => beat 2.5.
        expect(resolve).toHaveBeenCalledWith({ measureIndex: 0, beat: 2.5 })
    })

    it('returns null position (no cursor move) when elapsed is before the first entry', () => {
        const { player } = fakePlayer(-1)
        const rect = svgRect()
        const scheduler = fakeScheduler([entry({ startTime: 0 })])
        const cm = new CursorManager(player, scheduler)
        const resolve = vi.fn().mockReturnValue({ x: 5, rowY: 5 })
        cm.bind(rect, resolve)

        expect(cm.tick()).toBe(false)
        expect(resolve).not.toHaveBeenCalled()
        expect(rect.getAttribute('x')).toBeNull()
    })

    it('does not set attributes when resolvePosition returns null', () => {
        const { player } = fakePlayer(0)
        const rect = svgRect()
        const scheduler = fakeScheduler([entry({ startTime: 0 })])
        const cm = new CursorManager(player, scheduler)
        cm.bind(rect, () => null)

        cm.tick()
        expect(rect.getAttribute('x')).toBeNull()
        expect(rect.getAttribute('display')).toBeNull()
    })

    it('does not move the cursor when bound element/resolver is missing (not bound)', () => {
        const { player } = fakePlayer(0)
        const scheduler = fakeScheduler([entry({ startTime: 0 })])
        const cm = new CursorManager(player, scheduler)
        // No bind() call.
        expect(cm.tick()).toBe(false)
    })

    it('hides the cursor and reports done once playback passes endTime', () => {
        const { player } = fakePlayer(10)
        const rect = svgRect()
        const scheduler = fakeScheduler([entry({ startTime: 0, duration: 1, beat: 0, measureIndex: 0 })], 5)
        const cm = new CursorManager(player, scheduler)
        cm.bind(rect, () => ({ x: 1, rowY: 1 }))

        const done = cm.tick()
        expect(done).toBe(true)
        expect(rect.getAttribute('display')).toBe('none')
    })

    it('keeps ticking while elapsed < endTime', () => {
        const { player } = fakePlayer(2)
        const rect = svgRect()
        const scheduler = fakeScheduler([entry({ startTime: 0, duration: 1, beat: 0, measureIndex: 0 })], 5)
        const cm = new CursorManager(player, scheduler)
        cm.bind(rect, () => ({ x: 1, rowY: 1 }))
        expect(cm.tick()).toBe(false)
    })

    it('does not finish while endTime is still negative (scheduling in progress)', () => {
        const { player } = fakePlayer(1000)
        const rect = svgRect()
        const scheduler = fakeScheduler([entry({ startTime: 0, duration: 1, beat: 0, measureIndex: 0 })], -1)
        const cm = new CursorManager(player, scheduler)
        cm.bind(rect, () => ({ x: 1, rowY: 1 }))
        expect(cm.tick()).toBe(false)
    })

    it('hideCursor() sets display none, and is safe when unbound', () => {
        const { player } = fakePlayer()
        const rect = svgRect()
        const bound = new CursorManager(player, fakeScheduler([]))
        bound.bind(rect, () => null)
        bound.hideCursor()
        expect(rect.getAttribute('display')).toBe('none')

        const unbound = new CursorManager(player, fakeScheduler([]))
        expect(() => unbound.hideCursor()).not.toThrow()
    })
})
