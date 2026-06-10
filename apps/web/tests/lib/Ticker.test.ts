import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Tickable } from '@/lib/Ticker'
import { Ticker } from '@/lib/Ticker'

/** A controllable Tickable: returns whatever `done` says and records reset/tick calls. */
function makeTickable(done = false) {
    const t = {
        done,
        resetCount: 0,
        tickCount: 0,
        reset() {
            t.resetCount++
        },
        tick() {
            t.tickCount++
            return t.done
        },
    }
    return t as Tickable & { done: boolean; resetCount: number; tickCount: number }
}

describe('Ticker', () => {
    /** rAF callbacks captured so the test can fire frames deterministically. */
    let frames: Array<() => void>
    let nextId: number

    beforeEach(() => {
        frames = []
        nextId = 0
        vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
            frames.push(cb)
            return ++nextId
        })
        vi.stubGlobal('cancelAnimationFrame', vi.fn())
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    /** Fire the most recently scheduled frame. */
    function fireFrame() {
        const cb = frames.pop()
        if (!cb) throw new Error('no frame scheduled')
        cb()
    }

    it('starts not playing', () => {
        const ticker = new Ticker()
        expect(ticker.isPlaying).toBe(false)
    })

    it('play() resets all tickables and schedules a frame', () => {
        const ticker = new Ticker()
        const a = makeTickable()
        const b = makeTickable()
        ticker.addTickable(a)
        ticker.addTickable(b)

        ticker.play(() => {})

        expect(ticker.isPlaying).toBe(true)
        expect(a.resetCount).toBe(1)
        expect(b.resetCount).toBe(1)
        expect(frames).toHaveLength(1)
    })

    it('ticks all tickables each frame and keeps going while at least one is not done', () => {
        const ticker = new Ticker()
        const a = makeTickable(false)
        const b = makeTickable(false)
        ticker.addTickable(a)
        ticker.addTickable(b)

        ticker.play(() => {})
        fireFrame()

        expect(a.tickCount).toBe(1)
        expect(b.tickCount).toBe(1)
        // A new frame is scheduled because work remains.
        expect(frames).toHaveLength(1)
        expect(ticker.isPlaying).toBe(true)
    })

    it('calls onFinish and stops once every tickable reports done', () => {
        const ticker = new Ticker()
        const a = makeTickable(true)
        const b = makeTickable(true)
        ticker.addTickable(a)
        ticker.addTickable(b)
        const onFinish = vi.fn()

        ticker.play(onFinish)
        fireFrame()

        expect(onFinish).toHaveBeenCalledTimes(1)
        expect(ticker.isPlaying).toBe(false)
        // No follow-up frame is scheduled after finishing.
        expect(frames).toHaveLength(0)
    })

    it('does nothing inside a tick once stopped (guards against a late frame)', () => {
        const ticker = new Ticker()
        const a = makeTickable(false)
        ticker.addTickable(a)

        ticker.play(() => {})
        ticker.stop()
        expect(ticker.isPlaying).toBe(false)

        // Fire the frame captured by play() — it should bail immediately.
        fireFrame()
        expect(a.tickCount).toBe(0)
    })

    it('stop() cancels the pending animation frame', () => {
        const ticker = new Ticker()
        ticker.addTickable(makeTickable(false))
        ticker.play(() => {})

        ticker.stop()
        expect(cancelAnimationFrame).toHaveBeenCalledWith(1)
        expect(ticker.isPlaying).toBe(false)
    })

    it('stop() is a no-op when no frame is pending', () => {
        const ticker = new Ticker()
        ticker.stop()
        expect(cancelAnimationFrame).not.toHaveBeenCalled()
        expect(ticker.isPlaying).toBe(false)
    })

    it('resume() restarts the loop without resetting tickable state', () => {
        const ticker = new Ticker()
        const a = makeTickable(false)
        ticker.addTickable(a)

        ticker.play(() => {})
        expect(a.resetCount).toBe(1)
        ticker.stop()

        ticker.resume()
        expect(ticker.isPlaying).toBe(true)
        // resume must not call reset again.
        expect(a.resetCount).toBe(1)
        expect(frames).toHaveLength(2) // one from play, one from resume
    })

    it('resume() is a no-op while already playing', () => {
        const ticker = new Ticker()
        ticker.addTickable(makeTickable(false))
        ticker.play(() => {})
        const framesBefore = frames.length

        ticker.resume()
        expect(frames).toHaveLength(framesBefore)
    })

    it('play() while already playing stops the previous run first', () => {
        const ticker = new Ticker()
        const a = makeTickable(false)
        ticker.addTickable(a)

        ticker.play(() => {})
        ticker.play(() => {})

        // stop() was called internally, cancelling the first frame.
        expect(cancelAnimationFrame).toHaveBeenCalled()
        expect(a.resetCount).toBe(2)
        expect(ticker.isPlaying).toBe(true)
    })

    it('removeTickable() removes the tickable and resets it', () => {
        const ticker = new Ticker()
        const a = makeTickable(false)
        const b = makeTickable(false)
        ticker.addTickable(a)
        ticker.addTickable(b)

        ticker.removeTickable(a)
        expect(a.resetCount).toBe(1)

        ticker.play(() => {})
        fireFrame()
        // a was removed, so it never ticks.
        expect(a.tickCount).toBe(0)
        expect(b.tickCount).toBe(1)
    })

    it('an empty ticker finishes immediately on the first frame', () => {
        const ticker = new Ticker()
        const onFinish = vi.fn()
        ticker.play(onFinish)
        fireFrame()
        // allDone stays true with no tickables.
        expect(onFinish).toHaveBeenCalledTimes(1)
        expect(ticker.isPlaying).toBe(false)
    })
})
