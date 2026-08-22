import { KeySignature } from '../KeySignature'
import type { Measure } from '../Measure'
import type { Note } from '../Note'
import { Pitch } from '../Pitch'

/**
 * Chooses enharmonic spellings for a set of notes so the fewest accidentals are drawn,
 * replaying the exact rules `DisplayedAccidentals` uses to decide what ink appears — the
 * key signature's alteration is free, an accidental carries for the rest of the bar on its
 * (name, octave), a bar line or key change resets — without reaching into the layout layer.
 *
 * Pure analysis over an ordered walk of notes: nothing is mutated, the caller applies
 * {@link respelled} through `Score.replace`. Notes outside `targets` keep their spelling
 * but still occupy the bar's carried-accidental slots; target notes greedily take the
 * cheapest single-accidental spelling of their pitch (ties break toward the current
 * spelling, then the plainer alteration, then the key's own direction). A tied
 * continuation is forced onto its predecessor's chosen spelling — a tie only exists
 * between identically-written notes.
 *
 * The `fifthsOf` hook names the key governing each note, letting a caller audition a
 * candidate key signature without touching the score; {@link drawnCount} is that
 * audition's score (lower is better).
 */
export class AccidentalMinimizer {
    /** Accidentals the walked notes draw under the chosen spellings. */
    readonly drawnCount: number
    /** Chosen spelling per target note, only where it differs from the note's current one. */
    readonly respelled = new Map<Note, Pitch>()

    /** Chosen spelling for every walked pitched note — tie continuations look their predecessor up here. */
    private readonly chosen = new Map<Note, Pitch>()

    constructor(notes: Note[], targets: ReadonlySet<Note>, fifthsOf: (note: Note) => number) {
        let inEffect = new Map<string, number>() // "name+octave" → alteration sounding in the bar
        let measure: Measure | null = null
        let fifths: number | null = null
        let count = 0

        for (const note of notes) {
            const pitch = note.pitch
            if (!pitch) continue
            if (note.measure !== measure) {
                measure = note.measure
                inEffect = new Map() // bar line: carried accidentals expire
            }
            const noteFifths = fifthsOf(note)
            if (noteFifths !== fifths) {
                inEffect = new Map() // a key change cancels carried accidentals
                fifths = noteFifths
            }

            let best: Pitch | null = null
            let bestRank: number[] = []
            for (const candidate of this.candidatesFor(note, pitch, targets)) {
                const slot = candidate.name + candidate.octave
                const prevailing = inEffect.get(slot) ?? KeySignature.alterInKey(noteFifths, candidate.name)
                const keepsCurrent = candidate.name === pitch.name && candidate.alter === pitch.alter && candidate.octave === pitch.octave
                const withKey = noteFifths >= 0 ? candidate.alter >= 0 : candidate.alter <= 0
                const rank = [candidate.alter === prevailing ? 0 : 1, keepsCurrent ? 0 : 1, Math.abs(candidate.alter), withKey ? 0 : 1]
                if (!best || AccidentalMinimizer.compareRanks(rank, bestRank) < 0) {
                    best = candidate
                    bestRank = rank
                }
            }
            /* v8 ignore next -- defensive: every MIDI pitch has at least one single-accidental spelling, so candidates is never empty */
            if (!best) continue

            count += bestRank[0]
            inEffect.set(best.name + best.octave, best.alter)
            this.chosen.set(note, best)
            if (targets.has(note) && (best.name !== pitch.name || best.alter !== pitch.alter || best.octave !== pitch.octave)) {
                this.respelled.set(note, best)
            }
        }
        this.drawnCount = count
    }

    /** The spellings a note may take: its own (non-targets), its predecessor's (tie continuations), or any single-accidental spelling. */
    private candidatesFor(note: Note, pitch: Pitch, targets: ReadonlySet<Note>): Pitch[] {
        if (!targets.has(note)) return [pitch]
        if (note.tiesBack) {
            const previous = note.getPrevious()
            // Guard the MIDI match: an imported tie between differently-sounding notes must not rewrite the pitch.
            if (previous?.pitch && previous.pitch.toMidi() === pitch.toMidi()) {
                return [this.chosen.get(previous) ?? previous.pitch]
            }
        }
        return Pitch.spellingsOf(pitch.toMidi())
    }

    /** Lexicographic comparison of equal-length rank vectors (lower wins) — shared with the key chooser in `Score.minimizeAccidentals`. */
    static compareRanks(a: number[], b: number[]): number {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return a[i] - b[i]
        }
        return 0
    }
}
