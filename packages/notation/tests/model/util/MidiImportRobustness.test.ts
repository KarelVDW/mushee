import { BEAT_EPSILON } from '@mushee/notation/model/Duration'
import { MidiExporter } from '@mushee/notation/model/util/MidiExporter'
import { MidiImporter } from '@mushee/notation/model/util/MidiImporter'
import { describe, expect, it } from 'vitest'

import { generateScore, Rng } from './scoreGenerator'

/**
 * The MIDI importer parses raw bytes; a corrupted or hostile file must never
 * escape as a RangeError or an infinite loop. Whatever bytes it gets, it either
 * imports a score whose bars add up or fails with one of its own messages.
 */

const FRIENDLY_ERRORS = [
    'The file is not a MIDI file.',
    'MIDI files with SMPTE timing are not supported.',
    'The MIDI file contains no tracks.',
    'The MIDI file contains no notes.',
    'The MIDI file is truncated or corrupt.',
    'The MIDI file is too long to import.',
]

function mutate(bytes: Uint8Array, rng: Rng): Uint8Array {
    const roll = rng.next()
    if (roll < 0.25) return bytes.slice(0, rng.int(0, bytes.length)) // truncated
    const out = new Uint8Array(bytes)
    if (roll < 0.7) {
        // Flip a handful of bytes: status bytes, lengths, VLQ continuation bits, tempo/meter payloads.
        for (let i = rng.int(1, 6); i > 0; i--) out[rng.int(0, out.length - 1)] = rng.int(0, 255)
        return out
    }
    if (roll < 0.85) {
        // Blow up one byte to a high value (0xff sets a VLQ continuation bit, 0x80+ is a status byte).
        out[rng.int(14, out.length - 1)] = rng.pick([0xff, 0x80, 0x7f, 0x00, 0x90, 0xf0])
        return out
    }
    // Splice a random chunk of itself into itself.
    const from = rng.int(0, bytes.length - 1)
    const chunk = bytes.slice(from, from + rng.int(1, 64))
    const at = rng.int(0, bytes.length)
    const spliced = new Uint8Array(bytes.length + chunk.length)
    spliced.set(bytes.subarray(0, at), 0)
    spliced.set(chunk, at)
    spliced.set(bytes.subarray(at), at + chunk.length)
    return spliced
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1)

describe('MIDI importer over mutated files', () => {
    it.each(SEEDS)('either imports a well-formed score or fails with a friendly message (seed %i)', (seed) => {
        const rng = new Rng(seed)
        let bytes = new MidiExporter(generateScore(rng, { tuplets: false, midBarTempos: true })).toBytes() as Uint8Array
        for (let i = rng.int(1, 3); i > 0; i--) bytes = mutate(bytes, rng)

        try {
            const { score } = new MidiImporter(bytes).toScore()
            expect(score.measures.length).toBeGreaterThan(0)
            for (const measure of score.measures) {
                expect(
                    Math.abs(measure.beats - measure.maxBeats),
                    `bar ${measure.index} holds ${measure.beats} of ${measure.maxBeats}`,
                ).toBeLessThan(BEAT_EPSILON)
            }
        } catch (err) {
            if (err instanceof Error && FRIENDLY_ERRORS.includes(err.message)) return
            throw err
        }
    })
})
