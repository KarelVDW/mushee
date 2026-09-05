import { describe, expect, it } from 'vitest'

import { ZipWriter } from '@/lib/AccountExport'
import { MxlArchive } from '@/lib/MxlArchive'

/**
 * A user's .mxl upload may be truncated or damaged; the zip reader must answer
 * with one of its own messages, never a RangeError from a DataView read past the
 * end or a TypeError from a missing header. Valid containers written by our own
 * ZipWriter are mutated (truncation, byte flips, spliced chunks) and read back.
 */

const FRIENDLY = [
    'The archive is not a valid zip file.',
    'The archive contains no MusicXML score.',
    'The archive uses an unsupported compression method.',
]

class Rng {
    private state: number
    constructor(seed: number) {
        this.state = seed >>> 0
    }
    next(): number {
        let t = (this.state += 0x6d2b79f5)
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    int(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1))
    }
}

function container(rng: Rng): Uint8Array {
    const zip = new ZipWriter(new Date(2026, 8, 5))
    if (rng.next() < 0.8)
        zip.add('META-INF/container.xml', '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>')
    zip.add('score.musicxml', `<score-partwise version="4.0">${'<part/>'.repeat(rng.int(0, 40))}</score-partwise>`)
    if (rng.next() < 0.3) zip.add('extra/notes.txt', 'x'.repeat(rng.int(0, 300)))
    return zip.toBytes()
}

function mutate(bytes: Uint8Array, rng: Rng): Uint8Array {
    const roll = rng.next()
    if (roll < 0.3) return bytes.slice(0, rng.int(4, bytes.length)) // truncated download (keeps the zip signature)
    const out = new Uint8Array(bytes)
    if (roll < 0.75) {
        for (let i = rng.int(1, 8); i > 0; i--) out[rng.int(4, out.length - 1)] = rng.int(0, 255) // corrupted sizes, offsets, names, methods
        return out
    }
    const at = rng.int(4, bytes.length)
    const chunk = bytes.slice(rng.int(0, bytes.length - 1), rng.int(0, bytes.length))
    const spliced = new Uint8Array(bytes.length + chunk.length)
    spliced.set(bytes.subarray(0, at), 0)
    spliced.set(chunk, at)
    spliced.set(bytes.subarray(at), at + chunk.length)
    return spliced
}

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1)

describe('MxlArchive over damaged containers', () => {
    it.each(SEEDS)('reads a score or fails with a friendly message (seed %i)', async (seed) => {
        const rng = new Rng(seed)
        let bytes = container(rng)
        for (let i = rng.int(1, 3); i > 0; i--) bytes = mutate(bytes, rng)
        if (!MxlArchive.isZip(bytes)) return // the importer never hands such bytes to the reader

        try {
            const xml = await new MxlArchive(bytes).rootFile()
            expect(typeof xml).toBe('string')
        } catch (err) {
            if (err instanceof Error && FRIENDLY.includes(err.message)) return
            throw err
        }
    })
})
