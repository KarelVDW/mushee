import { describe, expect, it, vi } from 'vitest'

import { RecordingWaveformStore } from '@/lib/RecordingWaveformStore'

function bar(id: number, measureIndex = 0, beat = 0, amp = 0.5) {
    return { id, measureIndex, beat, amp }
}

describe('RecordingWaveformStore', () => {
    it('adds bars with a stable sequence number and notifies subscribers', () => {
        const store = new RecordingWaveformStore()
        const listener = vi.fn()
        store.subscribe(listener)

        store.add(bar(1))
        store.add(bar(2))

        expect(listener).toHaveBeenCalledTimes(2)
        const bars = store.getSnapshot()
        expect(bars.map((b) => b.seq)).toEqual([0, 1])
        expect(bars.every((b) => !b.exiting)).toBe(true)
    })

    it('returns a new snapshot reference per change (useSyncExternalStore contract)', () => {
        const store = new RecordingWaveformStore()
        const before = store.getSnapshot()
        store.add(bar(1))
        const after = store.getSnapshot()
        expect(after).not.toBe(before)
        expect(store.getSnapshot()).toBe(after) // stable between changes
    })

    it('clearCovered marks only bars before the covered beat in that measure', () => {
        const store = new RecordingWaveformStore()
        store.add(bar(1, 2, 0.5))
        store.add(bar(2, 2, 1.5))
        store.add(bar(3, 2, 2.5)) // beyond coverage
        store.add(bar(4, 3, 0.5)) // other measure

        store.clearCovered(2, 2)

        const exiting = store.getSnapshot().filter((b) => b.exiting)
        expect(exiting.map((b) => b.id)).toEqual([1, 2])
    })

    it('clearCovered is a no-op (no notification) when nothing matches', () => {
        const store = new RecordingWaveformStore()
        store.add(bar(1, 0, 3))
        const listener = vi.fn()
        store.subscribe(listener)

        store.clearCovered(0, 1)
        expect(listener).not.toHaveBeenCalled()
    })

    it('clearAll marks every remaining bar exactly once', () => {
        const store = new RecordingWaveformStore()
        store.add(bar(1))
        store.add(bar(2))
        store.clearCovered(0, 1)

        store.clearAll()
        expect(store.getSnapshot().every((b) => b.exiting)).toBe(true)

        const listener = vi.fn()
        store.subscribe(listener)
        store.clearAll() // everything already exiting => silent
        expect(listener).not.toHaveBeenCalled()
    })

    it('remove drops a bar by id and ignores unknown ids', () => {
        const store = new RecordingWaveformStore()
        store.add(bar(1))
        store.add(bar(2))

        store.remove(1)
        expect(store.getSnapshot().map((b) => b.id)).toEqual([2])

        const listener = vi.fn()
        store.subscribe(listener)
        store.remove(99)
        expect(listener).not.toHaveBeenCalled()
    })

    it('reset drops everything and restarts the color sequence', () => {
        const store = new RecordingWaveformStore()
        store.add(bar(1))
        store.add(bar(2))
        store.reset()
        expect(store.getSnapshot()).toEqual([])

        store.add(bar(3))
        expect(store.getSnapshot()[0].seq).toBe(0)

        store.reset() // already empty => no notification
        const listener = vi.fn()
        store.subscribe(listener)
        store.reset()
        expect(listener).not.toHaveBeenCalled()
    })

    it('unsubscribe stops notifications', () => {
        const store = new RecordingWaveformStore()
        const listener = vi.fn()
        const unsubscribe = store.subscribe(listener)
        unsubscribe()
        store.add(bar(1))
        expect(listener).not.toHaveBeenCalled()
    })
})
