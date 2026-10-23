import { INTERACTION_BLUE } from '@mushee/notation/components'
import { cursorRowY } from '@mushee/notation/lib/useScrollFollow'
import { makeScore } from '@mushee/notation/testing'
import { describe, expect, it, vi } from 'vitest'

import { PlaybackCursor } from '@/lib/PlaybackCursor'

/** The playhead ScoreView draws: a group whose parts (line and head) inherit its paint. */
function svgPlayhead(): SVGGElement {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.append(
        document.createElementNS('http://www.w3.org/2000/svg', 'rect'),
        document.createElementNS('http://www.w3.org/2000/svg', 'circle'),
    )
    return g
}

/** Fake scheduler: a fixed position (or none) and a fixed finished verdict. */
function fakeScheduler(position: { measureIndex: number; beat: number } | null, finished = false) {
    return { positionAt: vi.fn(() => position), hasFinishedAt: vi.fn(() => finished) }
}

function fakePlayer(currentTime = 0) {
    return { currentTime }
}

/** The transform moveTo writes for `beat` of measure `index`, straight from the layout. */
function expectedAt(score: ReturnType<typeof makeScore>, index: number, beat: number) {
    const { x, rowY } = score.layout.pointAtBeat(score.measures[index], beat)
    return { transform: `translate(${x}, ${rowY})`, rowY }
}

describe('PlaybackCursor', () => {
    it('moveTo puts the playhead on the beat’s layout point through one transform', () => {
        const score = makeScore(6)
        const playhead = svgPlayhead()
        const cursor = new PlaybackCursor(fakePlayer(), fakeScheduler(null))
        cursor.attach(playhead)

        cursor.moveTo(score, 5, 1.5)

        const expected = expectedAt(score, 5, 1.5)
        expect(playhead.getAttribute('transform')).toBe(expected.transform)
        // No x: a group has none — the playhead is drawn centred on its own origin.
        expect(playhead.hasAttribute('x')).toBe(false)
        expect(playhead.getAttribute('display')).toBe('')
        // Written in the form the scroll-follow reads its row from.
        expect(cursorRowY(playhead)).toBe(expected.rowY)
    })

    it('moveTo hides the cursor for a measure the score does not have', () => {
        const score = makeScore(1)
        const playhead = svgPlayhead()
        const cursor = new PlaybackCursor(fakePlayer(), fakeScheduler(null))
        cursor.attach(playhead)
        cursor.moveTo(score, 0, 0)

        cursor.moveTo(score, 5, 0)
        expect(playhead.getAttribute('display')).toBe('none')
        expect(cursorRowY(playhead)).toBeNull()
    })

    it('setTone paints the group — playback in the interaction blue, recording in red — and leaves its parts to inherit', () => {
        const playhead = svgPlayhead()
        const cursor = new PlaybackCursor(fakePlayer(), fakeScheduler(null))
        cursor.attach(playhead)

        cursor.setTone('recording')
        expect(playhead.getAttribute('fill')).toBe('#ef4444')
        cursor.setTone('playback')
        expect(playhead.getAttribute('fill')).toBe(INTERACTION_BLUE)
        for (const part of playhead.children) expect(part.hasAttribute('fill')).toBe(false)
    })

    it('setOpacity writes the group’s fill opacity and null clears it', () => {
        const playhead = svgPlayhead()
        const cursor = new PlaybackCursor(fakePlayer(), fakeScheduler(null))
        cursor.attach(playhead)

        cursor.setOpacity(0.4312)
        expect(playhead.getAttribute('fill-opacity')).toBe('0.431')
        cursor.setOpacity(null)
        expect(playhead.hasAttribute('fill-opacity')).toBe(false)
    })

    it('every write is a no-op while detached', () => {
        const score = makeScore(1)
        const playhead = svgPlayhead()
        const cursor = new PlaybackCursor(fakePlayer(), fakeScheduler(null))
        cursor.attach(playhead)
        cursor.attach(null)

        expect(() => {
            cursor.moveTo(score, 0, 0)
            cursor.hide()
            cursor.setTone('recording')
            cursor.setOpacity(0.5)
        }).not.toThrow()
        expect(playhead.getAttributeNames()).toEqual([])
    })

    it('tick follows the scheduler position at the clock time', () => {
        const score = makeScore(2)
        const playhead = svgPlayhead()
        const scheduler = fakeScheduler({ measureIndex: 1, beat: 2 })
        const cursor = new PlaybackCursor(fakePlayer(1.25), scheduler)
        cursor.attach(playhead)
        cursor.follow(score)

        expect(cursor.tick()).toBe(false)

        expect(scheduler.positionAt).toHaveBeenCalledWith(1.25)
        expect(playhead.getAttribute('transform')).toBe(expectedAt(score, 1, 2).transform)
        expect(playhead.getAttribute('display')).toBe('')
    })

    it('tick leaves the cursor alone while the scheduler has no position yet', () => {
        const playhead = svgPlayhead()
        const cursor = new PlaybackCursor(fakePlayer(-1), fakeScheduler(null))
        cursor.attach(playhead)
        cursor.follow(makeScore(1))

        expect(cursor.tick()).toBe(false)
        expect(playhead.getAttribute('transform')).toBeNull()
    })

    it('tick does not move the cursor before a pass is followed', () => {
        const playhead = svgPlayhead()
        const cursor = new PlaybackCursor(fakePlayer(0), fakeScheduler({ measureIndex: 0, beat: 0 }))
        cursor.attach(playhead)

        expect(cursor.tick()).toBe(false)
        expect(playhead.getAttribute('transform')).toBeNull()
    })

    it('tick hides the cursor and reports done once the scheduler has finished', () => {
        const playhead = svgPlayhead()
        const scheduler = fakeScheduler({ measureIndex: 0, beat: 4 }, true)
        const cursor = new PlaybackCursor(fakePlayer(10), scheduler)
        cursor.attach(playhead)
        cursor.follow(makeScore(1))

        expect(cursor.tick()).toBe(true)
        expect(scheduler.hasFinishedAt).toHaveBeenCalledWith(10)
        expect(playhead.getAttribute('display')).toBe('none')
    })
})
