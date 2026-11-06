import { describe, expect, it } from 'vitest'

import type { MxmlMeasure } from '../../src/recordings/pipeline/mxml.types'
import type { NoteEventTime } from '../../src/recordings/pipeline/note-event'
import { type ExtractedNotes, NoteExtractor } from '../../src/recordings/pipeline/note-extractor'
import { RecordingPipeline } from '../../src/recordings/pipeline/recording-pipeline'

/**
 * When a streaming pass commits a note. A committed note is emitted once, keyed
 * on onset + pitch, and never revisited — so committing one while it still
 * sounds writes it short for good. The written length is floor-snapped to a
 * standard value, so the WRITTEN end clears the margin long before a held note
 * stops: a 3-beat note seen 2.9 beats in is written as a half note. The rule
 * these tests pin: a pass commits a note only once its PERFORMED end
 * (`performedEndSeconds`) is the margin (0.4 s) behind the audio.
 */

const BPM = 60 // one beat per second, so beats and seconds read the same

function pipeline(): { p: RecordingPipeline; emitted: () => { start: number; dur: number; midi: number }[] } {
    const p = new RecordingPipeline(
        null as unknown as ConstructorParameters<typeof RecordingPipeline>[0],
        null as unknown as ConstructorParameters<typeof RecordingPipeline>[1],
    )
    p.setMeta({ bpm: BPM, timeSignature: { beats: 4, beatType: 4 } })
    p.setOnUpdate((_: { measures: Record<number, MxmlMeasure> }) => undefined)
    const emitted = () =>
        (p as unknown as { emittedNotes: NoteEventTime[] }).emittedNotes.map((n) => ({
            start: n.startTimeSeconds,
            dur: n.durationSeconds,
            midi: n.pitchMidi,
        }))
    return { p, emitted }
}

/** One pass over `raw` (what the provider has decoded so far) at a buffer of `durationSec`. */
function pass(p: RecordingPipeline, raw: NoteEventTime[], durationSec: number, isFinal = false): void {
    const extracted = new NoteExtractor().extract(raw, { bpm: BPM })
    ;(p as unknown as { emitFromExtracted(e: ExtractedNotes, d: number, f: boolean): void }).emitFromExtracted(
        extracted,
        durationSec,
        isFinal,
    )
}

const note = (start: number, dur: number, midi: number): NoteEventTime => ({
    startTimeSeconds: start,
    durationSeconds: dur,
    pitchMidi: midi,
    amplitude: 0.8,
})

describe('NoteExtractor.quantize performed end', () => {
    it('records where the performed note ends beside the floor-snapped written length', () => {
        const [q] = new NoteExtractor().quantize([note(0.02, 2.9, 57)], BPM)
        expect(q.durationSeconds).toBe(2)
        expect(q.performedEndSeconds).toBeCloseTo(2.92, 9)
    })

    it('a coincident-slot collapse keeps the later performed end, whichever note wins the slot', () => {
        const a = { ...note(1, 0.25, 60), performedEndSeconds: 1.1 }
        const b = { ...note(1, 0.25, 62), amplitude: 0.1, performedEndSeconds: 1.3 }
        const [kept] = NoteExtractor.collapseCoincident([a, b])
        expect(kept.pitchMidi).toBe(60) // the more salient note keeps the slot…
        expect(kept.performedEndSeconds).toBe(1.3) // …but the slot settles when the loser ends
    })
})

describe('RecordingPipeline streaming commit', () => {
    it('does not commit a held note while it still sounds, and commits its full length once it ends', () => {
        const { p, emitted } = pipeline()
        // 3.0 s into the take the note has sounded 2.9 s: written as 2 beats, ending
        // 1 s before the cutoff — the old rule committed it here, a beat short.
        pass(p, [note(0, 2.9, 57)], 3.0)
        expect(emitted()).toEqual([])
        // It stopped at 3.0 s; one pass later that end is past the margin.
        pass(p, [note(0, 3.0, 57), note(3.5, 0.3, 60)], 4.0)
        expect(emitted()).toEqual([{ start: 0, dur: 3, midi: 57 }])
    })

    it('still commits a finished note on the first pass that clears the margin', () => {
        const { p, emitted } = pipeline()
        pass(p, [note(0, 1.0, 57), note(1.0, 0.9, 59)], 2.0)
        // 59 is still within the margin of the audio's end; 57 is not.
        expect(emitted().map((n) => n.midi)).toEqual([57])
    })

    it('commits everything on the final pass', () => {
        const { p, emitted } = pipeline()
        pass(p, [note(0, 2.9, 57)], 3.0, true)
        expect(emitted()).toEqual([{ start: 0, dur: 2, midi: 57 }])
    })
})
