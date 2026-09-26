import { BEAT_EPSILON } from '@mushee/notation/model/Duration'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { DurationSpeller } from '@mushee/notation/model/util/DurationSpeller'
import { describe, expect, it } from 'vitest'

import { Rng } from './scoreGenerator'

/**
 * The speller (imports, recording gaps) must write exactly the span it is given:
 * for any meter and any sixteenth-grid start and length inside the bar, the
 * written values sum to the span, never exceed it, and stay few — a span is at
 * most one value per metrical boundary it crosses plus a handful of grid pieces.
 */

const METERS: ReadonlyArray<[number, number]> = [
    [4, 4],
    [3, 4],
    [2, 4],
    [6, 8],
    [2, 2],
    [3, 8],
    [5, 4],
    [7, 8],
    [9, 8],
    [12, 8],
    [3, 2],
    [5, 8],
]

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1)

describe('DurationSpeller over every meter and grid position', () => {
    it.each(SEEDS)('spells the exact span in few values (seed %i)', (seed) => {
        const rng = new Rng(seed)
        const [beats, beatType] = rng.pick(METERS)
        const timeSignature = new TimeSignature(beats, beatType)
        const speller = new DurationSpeller(timeSignature)
        const units = Math.round(timeSignature.maxBeats * 4) // sixteenths in the bar
        const startUnits = rng.int(0, units - 1)
        const spanUnits = rng.int(1, units - startUnits)
        const start = startUnits / 4
        const span = spanUnits / 4

        const written = speller.spell(start, span)
        const total = written.reduce((sum, d) => sum + d.beats, 0)
        expect(Math.abs(total - span), `${beats}/${beatType} from ${start} for ${span}: wrote ${total}`).toBeLessThan(BEAT_EPSILON)
        for (const d of written) expect(d.ratio).toEqual({ actualNotes: 1, normalNotes: 1 })
        // Never absurdly fragmented: a sixteenth-grid span of n units needs at most ~log pieces per boundary crossed.
        expect(written.length, `${beats}/${beatType} from ${start} for ${span}: ${written.length} pieces`).toBeLessThanOrEqual(
            Math.min(spanUnits, 2 + 2 * Math.ceil(span)),
        )
    })

    it('spells nothing for a span below the grid, and a bar from its start as one symbol where a value exists', () => {
        const speller = new DurationSpeller(new TimeSignature(4, 4))
        expect(speller.spell(0, 0.1)).toEqual([])
        expect(speller.spell(0, 4).map((d) => d.type)).toEqual(['w'])
        expect(new DurationSpeller(new TimeSignature(6, 8)).spell(0, 3).map((d) => `${d.type}${'.'.repeat(d.dots)}`)).toEqual(['h.'])
    })
})
