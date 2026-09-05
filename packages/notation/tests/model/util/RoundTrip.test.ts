import type { ScorePartwise } from '@mushee/notation/components/types'
import { BEAT_EPSILON } from '@mushee/notation/model/Duration'
import type { Measure } from '@mushee/notation/model/Measure'
import type { Note } from '@mushee/notation/model/Note'
import type { Score } from '@mushee/notation/model/Score'
import { MidiExporter } from '@mushee/notation/model/util/MidiExporter'
import { MidiImporter } from '@mushee/notation/model/util/MidiImporter'
import { MusicXmlExporter } from '@mushee/notation/model/util/MusicXmlExporter'
import { MusicXmlImporter } from '@mushee/notation/model/util/MusicXmlImporter'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import { ScoreSerializer } from '@mushee/notation/model/util/ScoreSerializer'
import { describe, expect, it } from 'vitest'

import { generateScore, Rng } from './scoreGenerator'

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

// --- Observations ---

const round = (beats: number) => Math.round(beats * 1e6) / 1e6

function describeNote(note: Note): string {
    const pitch = note.pitch ? `${note.pitch.name}${note.pitch.alter}/${note.pitch.octave}` : 'rest'
    const ratio = note.inTuplet ? `(${note.duration.ratio.actualNotes}:${note.duration.ratio.normalNotes})` : ''
    return `${pitch}:${note.duration.type}${'.'.repeat(note.duration.dots)}${ratio}${note.tiesForward ? '~' : ''}${note.tiesBack ? '_' : ''}`
}

/** Everything the notation persists, in a shape `toEqual` diffs readably. */
function describeScore(score: Score) {
    return {
        instrument: score.instrument.id,
        measures: score.measures.map((measure, index) => ({
            time: `${measure.timeSignature.beatAmount}/${measure.timeSignature.beatType}`,
            // The opening bar's clef and key are always written out, so their "explicit boundary" flag is
            // moot there (nothing precedes it to carry forward from) and is only observed from bar two on.
            clef: `${measure.clef.type}${index > 0 && measure.leadingClefExplicit ? '!' : ''}`,
            key: `${measure.keySignature.fifths}${measure.keySignature.mode ?? ''}${index > 0 && measure.leadingKeyExplicit ? '!' : ''}`,
            midClefs: measure.midMeasureClefs.map((clef) => `${round(clef.beatPosition)}:${clef.type}`),
            midKeys: measure.midMeasureKeySignatures.map((key) => `${round(key.beatPosition)}:${key.fifths}${key.mode ?? ''}`),
            tempos: measure.tempos.map((tempo) => `${round(tempo.beatPosition)}:${tempo.bpm}`),
            barline: measure.endBarline,
            notes: measure.notes.map(describeNote),
        })),
    }
}

/** What a listener hears: one event per attack, ties merged, written pitch transposed to sounding. */
function soundingEvents(score: Score): string[] {
    const events: string[] = []
    let position = 0
    for (const measure of score.measures) {
        for (const note of measure.notes) {
            const start = position
            position += note.duration.effectiveBeats
            if (!note.pitch || note.tiesBack) continue
            let end = position
            let current = note
            while (current.tiesForward) {
                const next = current.getNext()
                if (!next) break
                end += next.duration.effectiveBeats
                current = next
            }
            events.push(`${round(start)}-${round(end)}:${note.pitch.toMidi() + score.instrument.chromaticTranspose}`)
        }
    }
    return events
}

/** Tempo marks as absolute beat → bpm. */
function tempoMarks(score: Score): string[] {
    const marks: string[] = []
    let position = 0
    for (const measure of score.measures) {
        for (const tempo of measure.tempos) marks.push(`${round(position + tempo.beatPosition)}:${tempo.bpm}`)
        position += measure.maxBeats
    }
    return marks
}

const meter = (measure: Measure) => `${measure.timeSignature.beatAmount}/${measure.timeSignature.beatType}`

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
