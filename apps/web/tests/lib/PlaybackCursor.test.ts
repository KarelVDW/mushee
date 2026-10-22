import { INTERACTION_BLUE } from '@mushee/notation/components'
import { makeScore } from '@mushee/notation/testing'
import { describe, expect, it, vi } from 'vitest'

import { PlaybackCursor } from '@/lib/PlaybackCursor'

function svgRect(): SVGRectElement {
    return document.createElementNS('http://www.w3.org/2000/svg', 'rect')
}

/** Fake scheduler: a fixed position (or none) and a fixed finished verdict. */
function fakeScheduler(position: { measureIndex: number; beat: number } | null, finished = false) {
    return { positionAt: vi.fn(() => position), hasFinishedAt: vi.fn(() => finished) }
}

function fakePlayer(currentTime = 0) {
    return { currentTime }
}

/** The attributes moveTo writes for `beat` of measure `index`, straight from the layout. */
function expectedAt(score: ReturnType<typeof makeScore>, index: number, beat: number) {
    const { x, rowY } = score.layout.pointAtBeat(score.measures[index], beat)
    return { x: String(x - 1.5), transform: `translate(0, ${rowY})` }
}

describe('PlaybackCursor', () => {
    it('moveTo draws the cursor at the layout point of the beat', () => {
        const score = makeScore(3)
        const rect = svgRect()
        const cursor = new PlaybackCursor(fakePlayer(), fakeScheduler(null))
        cursor.attach(rect)

        cursor.moveTo(score, 2, 1.5)

        const expected = expectedAt(score, 2, 1.5)
        expect(rect.getAttribute('x')).toBe(expected.x)
        expect(rect.getAttribute('transform')).toBe(expected.transform)
        expect(rect.getAttribute('display')).toBe('')
    })

    it('moveTo hides the cursor for a measure the score does not have', () => {
        const score = makeScore(1)
        const rect = svgRect()
        const cursor = new PlaybackCursor(fakePlayer(), fakeScheduler(null))
        cursor.attach(rect)
        cursor.moveTo(score, 0, 0)

        cursor.moveTo(score, 5, 0)
        expect(rect.getAttribute('display')).toBe('none')
    })

    it('setTone paints playback in the interaction blue and recording in red', () => {
        const rect = svgRect()
        const cursor = new PlaybackCursor(fakePlayer(), fakeScheduler(null))
        cursor.attach(rect)

        cursor.setTone('recording')
        expect(rect.getAttribute('fill')).toBe('#ef4444')
        cursor.setTone('playback')
        expect(rect.getAttribute('fill')).toBe(INTERACTION_BLUE)
    })

    it('setOpacity writes the fill opacity and null clears it', () => {
        const rect = svgRect()
        const cursor = new PlaybackCursor(fakePlayer(), fakeScheduler(null))
        cursor.attach(rect)

        cursor.setOpacity(0.4312)
        expect(rect.getAttribute('fill-opacity')).toBe('0.431')
        cursor.setOpacity(null)
        expect(rect.hasAttribute('fill-opacity')).toBe(false)
    })

    it('every write is a no-op while detached', () => {
        const score = makeScore(1)
        const rect = svgRect()
        const cursor = new PlaybackCursor(fakePlayer(), fakeScheduler(null))
        cursor.attach(rect)
        cursor.attach(null)

        expect(() => {
            cursor.moveTo(score, 0, 0)
            cursor.hide()
            cursor.setTone('recording')
            cursor.setOpacity(0.5)
        }).not.toThrow()
        expect(rect.getAttributeNames()).toEqual([])
    })

    it('tick follows the scheduler position at the clock time', () => {
        const score = makeScore(2)
        const rect = svgRect()
        const scheduler = fakeScheduler({ measureIndex: 1, beat: 2 })
        const cursor = new PlaybackCursor(fakePlayer(1.25), scheduler)
        cursor.attach(rect)
        cursor.follow(score)

        expect(cursor.tick()).toBe(false)

        expect(scheduler.positionAt).toHaveBeenCalledWith(1.25)
        const expected = expectedAt(score, 1, 2)
        expect(rect.getAttribute('x')).toBe(expected.x)
        expect(rect.getAttribute('transform')).toBe(expected.transform)
        expect(rect.getAttribute('display')).toBe('')
    })

    it('tick leaves the cursor alone while the scheduler has no position yet', () => {
        const rect = svgRect()
        const cursor = new PlaybackCursor(fakePlayer(-1), fakeScheduler(null))
        cursor.attach(rect)
        cursor.follow(makeScore(1))

        expect(cursor.tick()).toBe(false)
        expect(rect.getAttribute('x')).toBeNull()
    })

    it('tick does not move the cursor before a pass is followed', () => {
        const rect = svgRect()
        const cursor = new PlaybackCursor(fakePlayer(0), fakeScheduler({ measureIndex: 0, beat: 0 }))
        cursor.attach(rect)

        expect(cursor.tick()).toBe(false)
        expect(rect.getAttribute('x')).toBeNull()
    })

    it('tick hides the cursor and reports done once the scheduler has finished', () => {
        const rect = svgRect()
        const scheduler = fakeScheduler({ measureIndex: 0, beat: 4 }, true)
        const cursor = new PlaybackCursor(fakePlayer(10), scheduler)
        cursor.attach(rect)
        cursor.follow(makeScore(1))

        expect(cursor.tick()).toBe(true)
        expect(scheduler.hasFinishedAt).toHaveBeenCalledWith(10)
        expect(rect.getAttribute('display')).toBe('none')
    })
})
