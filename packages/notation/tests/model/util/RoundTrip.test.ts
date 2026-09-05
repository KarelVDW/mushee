import type { ScorePartwise } from '@mushee/notation/components/types'
import { BEAT_EPSILON } from '@mushee/notation/model/Duration'
import { MidiExporter } from '@mushee/notation/model/util/MidiExporter'
import { MidiImporter } from '@mushee/notation/model/util/MidiImporter'
import { MusicXmlExporter } from '@mushee/notation/model/util/MusicXmlExporter'
import { MusicXmlImporter } from '@mushee/notation/model/util/MusicXmlImporter'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import { ScoreSerializer } from '@mushee/notation/model/util/ScoreSerializer'
import { describe, expect, it } from 'vitest'

import { generateScore, Rng } from './scoreGenerator'
import { describeScore, meter, soundingEvents, tempoMarks } from './scoreObservations'

/**
 * Generative round-trip properties. A seeded generator builds random but valid
 * scores — every meter, clef and key the model knows, dotted values, triplets,
 * ties, mid-bar clef/key changes, tempo marks, barlines, every selectable
 * instrument — and each persistence path must give the same score back:
 *
 *  - JSON (the shape the API stores) → exact.
 *  - MusicXML export → import: exact, and the importer must not need to warn about
 *    a document we wrote ourselves.
 *  - MIDI export → import: the *sounding* music (onset, release, sounding pitch,
 *    tempo, meter) — MIDI carries no spelling, written pitch or rests.
 *
 * Deterministic seeds make any failure reproducible: rerun the one seed.
 */

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1)

describe('round-trip properties', () => {
    describe('JSON save → load', () => {
        it.each(SEEDS)('preserves the score exactly (seed %i)', (seed) => {
            const score = generateScore(new Rng(seed), { tuplets: true, midBarTempos: true })
            const json = JSON.parse(JSON.stringify(new ScoreSerializer(score).toInput())) as ScorePartwise
            const restored = new ScoreDeserializer(json).toScore()
            expect(describeScore(restored)).toEqual(describeScore(score))
        })
    })

    describe('MusicXML export → import', () => {
        it.each(SEEDS)('preserves the score exactly and needs no warnings (seed %i)', (seed) => {
            const score = generateScore(new Rng(seed), { tuplets: true, midBarTempos: true })
            const imported = new MusicXmlImporter(new MusicXmlExporter(score).toXml('Round trip')).toScore()
            expect(imported.warnings).toEqual([])
            expect(imported.title).toBe('Round trip')
            expect(describeScore(imported.score)).toEqual(describeScore(score))
        })
    })

    describe('MIDI export → import', () => {
        it.each(SEEDS)('preserves the sounding music, meters and tempo marks (seed %i)', (seed) => {
            const score = generateScore(new Rng(seed), { tuplets: false, midBarTempos: false })
            const bytes = new MidiExporter(score).toBytes()
            if (!score.measures.some((measure) => measure.notes.some((note) => note.pitch))) {
                // Silence has no MIDI notes to import; the importer says so instead of producing an empty score.
                expect(() => new MidiImporter(bytes).toScore()).toThrow('contains no notes')
                return
            }
            const imported = new MidiImporter(bytes).toScore()
            expect(imported.warnings).toEqual([])
            expect(soundingEvents(imported.score)).toEqual(soundingEvents(score))

            // MIDI has no rests: bars after the last attack are not reconstructed, everything before is.
            const lastSounding = score.measures.findLastIndex((measure) => measure.notes.some((note) => note.pitch))
            expect(imported.score.measures.length).toBeGreaterThan(lastSounding)
            expect(imported.score.measures.length).toBeLessThanOrEqual(score.measures.length)
            expect(imported.score.measures.map(meter)).toEqual(score.measures.slice(0, imported.score.measures.length).map(meter))

            // Every mark within the reconstructed bars is back (the file may add the default opening tempo when we had none).
            const importedBeats = imported.score.measures.reduce((sum, measure) => sum + measure.maxBeats, 0)
            const marks = tempoMarks(imported.score)
            for (const mark of tempoMarks(score)) {
                if (Number(mark.split(':')[0]) < importedBeats - BEAT_EPSILON) expect(marks).toContain(mark)
            }
        })
    })
})
