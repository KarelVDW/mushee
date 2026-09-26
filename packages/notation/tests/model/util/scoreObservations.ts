import type { Measure } from '@mushee/notation/model/Measure'
import type { Note } from '@mushee/notation/model/Note'
import type { Score } from '@mushee/notation/model/Score'

/** Readable, comparable views of a score for property tests (what persists; what a listener hears). */

// --- Observations ---

export const round = (beats: number) => Math.round(beats * 1e6) / 1e6

export function describeNote(note: Note): string {
    const pitch = note.pitch ? `${note.pitch.name}${note.pitch.alter}/${note.pitch.octave}` : 'rest'
    const ratio = note.inTuplet ? `(${note.duration.ratio.actualNotes}:${note.duration.ratio.normalNotes})` : ''
    return `${pitch}:${note.duration.type}${'.'.repeat(note.duration.dots)}${ratio}${note.tiesForward ? '~' : ''}${note.tiesBack ? '_' : ''}`
}

/** Everything the notation persists, in a shape `toEqual` diffs readably. */
export function describeScore(score: Score) {
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
export function soundingEvents(score: Score): string[] {
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
                // A tie only sustains into the same pitch (Score.tiePartner); into anything else it is a dangling mark.
                if (!next?.pitch || next.pitch.toMidi() !== note.pitch.toMidi()) break
                end += next.duration.effectiveBeats
                current = next
            }
            events.push(`${round(start)}-${round(end)}:${note.pitch.toMidi() + score.instrument.chromaticTranspose}`)
        }
    }
    return events
}

/** Tempo marks as absolute beat → bpm. */
export function tempoMarks(score: Score): string[] {
    const marks: string[] = []
    let position = 0
    for (const measure of score.measures) {
        for (const tempo of measure.tempos) marks.push(`${round(position + tempo.beatPosition)}:${tempo.bpm}`)
        position += measure.maxBeats
    }
    return marks
}

export const meter = (measure: Measure) => `${measure.timeSignature.beatAmount}/${measure.timeSignature.beatType}`
