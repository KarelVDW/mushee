import type { Measure } from '../Measure'
import type { Note } from '../Note'
import { Pitch } from '../Pitch'
import { CarriedAccidentals } from './CarriedAccidentals'

/**
 * Chooses enharmonic spellings for a set of notes so the fewest accidentals are drawn,
 * counting ink by the same {@link CarriedAccidentals} rule the engraver draws with — the
 * key signature's alteration is free, an accidental carries for the rest of the bar on its
 * (name, octave), a bar line or key change resets.
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
 * audition's score (lower is better). An audition passes `basis: 'sounding'` so the walk
 * ranks spellings on the notes' sounding pitch classes alone — the current spelling, which
 * the pass itself is about to rewrite, must not tip a key choice, or a second pass could
 * move a key signature again.
 */
export class AccidentalMinimizer {
    /** Accidentals the walked notes draw under the chosen spellings. */
    readonly drawnCount: number
    /** Chosen spelling per target note, only where it differs from the note's current one. */
    readonly respelled = new Map<Note, Pitch>()

    /** Chosen spelling for every walked pitched note — tie continuations look their predecessor up here. */
    private readonly chosen = new Map<Note, Pitch>()

    constructor(
        notes: Note[],
        targets: ReadonlySet<Note>,
        fifthsOf: (note: Note) => number,
        private readonly basis: 'spelling' | 'sounding' = 'spelling',
    ) {
        let carried = new CarriedAccidentals(0)
        let measure: Measure | null = null
        let count = 0

        for (const note of notes) {
            const pitch = note.pitch
            if (!pitch) continue
            const noteFifths = fifthsOf(note)
            if (note.measure !== measure) {
                measure = note.measure
                carried = new CarriedAccidentals(noteFifths) // bar line: carried accidentals expire
            } else if (noteFifths !== carried.fifths) {
                carried.reset(noteFifths) // a key change cancels carried accidentals
            }

            let best: Pitch | null = null
            let bestRank: number[] = []
            for (const candidate of this.candidatesFor(note, pitch, targets)) {
                const keepsCurrent = basis === 'spelling' && candidate.spelledLike(pitch)
                const withKey = noteFifths >= 0 ? candidate.alter >= 0 : candidate.alter <= 0
                const rank = [carried.draws(candidate) ? 1 : 0, keepsCurrent ? 0 : 1, Math.abs(candidate.alter), withKey ? 0 : 1]
                if (!best || AccidentalMinimizer.compareRanks(rank, bestRank) < 0) {
                    best = candidate
                    bestRank = rank
                }
            }
            /* v8 ignore next -- defensive: every MIDI pitch has at least one single-accidental spelling, so candidates is never empty */
            if (!best) continue

            count += bestRank[0]
            carried.record(best)
            this.chosen.set(note, best)
            if (targets.has(note) && !best.spelledLike(pitch)) {
                this.respelled.set(note, best)
            }
        }
        this.drawnCount = count
    }

    /** The spellings a note may take: its own (non-targets), its predecessor's (tie continuations), or any single-accidental spelling. */
    private candidatesFor(note: Note, pitch: Pitch, targets: ReadonlySet<Note>): Pitch[] {
        if (!targets.has(note)) return [pitch]
        if (note.tiesBack) {
            // A note ties back only behind a same-sounding partner (Score.tiePartner), so the
            // continuation simply takes the predecessor's spelling.
            const previous = note.getPrevious()
            /* v8 ignore next -- type narrowing only: tiesBack guarantees a pitched predecessor */
            if (previous?.pitch) {
                const forced = this.chosen.get(previous)
                if (forced) return [forced]
                // The predecessor lies outside the walk. A spelling respell honours what is written
                // there; an audition on sound must not, or the previous region's rewrite would feed
                // back into this one's key choice.
                if (this.basis === 'spelling') return [previous.pitch]
            }
        }
        return Pitch.spellingsOf(pitch.toMidi())
    }

    /**
     * The key (fifths, −7..7) a key-signature region's `notes` are best written in: whichever
     * draws the fewest accidentals over them. Every audition ranks on the notes' sounding pitch
     * classes, never on spellings the caller's pass is about to rewrite — otherwise a second
     * pass would see different counts and could move the key again. Ties go to the key already
     * in place (a region whose notes can't tell keys apart must not drift), then the lighter
     * signature, then the sharp side of an enharmonic pair.
     */
    static bestFifths(notes: Note[], currentFifths: number): number {
        const targets = new Set(notes)
        const rankOf = (fifths: number) => [
            new AccidentalMinimizer(notes, targets, () => fifths, 'sounding').drawnCount,
            fifths === currentFifths ? 0 : 1,
            Math.abs(fifths),
            fifths > 0 ? 0 : 1,
        ]
        let best = currentFifths
        let bestRank = rankOf(currentFifths)
        for (let fifths = -7; fifths <= 7; fifths++) {
            if (fifths === currentFifths) continue
            const rank = rankOf(fifths)
            if (AccidentalMinimizer.compareRanks(rank, bestRank) < 0) {
                best = fifths
                bestRank = rank
            }
        }
        return best
    }

    /** Lexicographic comparison of equal-length rank vectors (lower wins) — used by the spelling ranker and {@link bestFifths}. */
    static compareRanks(a: number[], b: number[]): number {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return a[i] - b[i]
        }
        return 0
    }
}
