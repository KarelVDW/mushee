import { makeScore } from '@mushee/notation/testing'
import type { CSSProperties, ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { RecordingWaveform } from '../../src/components/RecordingWaveform'
import { RecordingWaveformStore } from '../../src/lib/RecordingWaveformStore'
import { Staff } from '../../src/model/layout/Staff'

// The component reads the store through useSyncExternalStore; outside a renderer, hand it the snapshot.
vi.mock('react', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}))

interface RectProps {
    className: string
    height: number
    style?: CSSProperties & { '--waveform-burst'?: number }
    onAnimationEnd?: () => void
}

/** The rects the layer draws for `store`'s bars. */
function rects(store: RecordingWaveformStore): RectProps[] {
    const layer = RecordingWaveform({ store, score: makeScore(2) }) as ReactElement<{
        children: Array<ReactElement<RectProps> | null>
    }> | null
    if (!layer) return []
    return layer.props.children.flatMap((rect) => (rect ? [rect.props] : []))
}

describe('RecordingWaveform', () => {
    it('draws nothing without bars', () => {
        expect(RecordingWaveform({ store: new RecordingWaveformStore(), score: makeScore(1) })).toBeNull()
    })

    it('sizes each bar by its loudness alone — no heartbeat floor for quiet samples', () => {
        const store = new RecordingWaveformStore()
        store.add({ id: 1, measureIndex: 0, beat: 0, amp: 1 })
        store.add({ id: 2, measureIndex: 0, beat: 1, amp: 0.05 })
        const [loud, quiet] = rects(store)
        expect(loud.height).toBeCloseTo(Staff.HEIGHT)
        expect(quiet.height).toBeCloseTo(Staff.HEIGHT * 0.05)
        expect(loud.className).toBe('waveform-bar')
        expect(loud.onAnimationEnd).toBeUndefined()
    })

    it('bursts an exiting bar to the full staff height and drops it when its exit ends', () => {
        const store = new RecordingWaveformStore()
        store.add({ id: 1, measureIndex: 0, beat: 0, amp: 0.25 })
        store.add({ id: 2, measureIndex: 0, beat: 1, amp: 0 })
        store.clearAll()
        const [quarter, silent] = rects(store)
        expect(quarter.className).toBe('waveform-bar waveform-bar-exit')
        expect(quarter.style?.['--waveform-burst']).toBeCloseTo(4)
        // A zero-height bar never divides by zero.
        expect(silent.style?.['--waveform-burst']).toBe(1)
        quarter.onAnimationEnd?.()
        expect(store.getSnapshot().map((bar) => bar.id)).toEqual([2])
    })

    it('skips bars whose measure is gone', () => {
        const store = new RecordingWaveformStore()
        store.add({ id: 1, measureIndex: 9, beat: 0, amp: 0.5 })
        expect(rects(store)).toEqual([])
    })
})
