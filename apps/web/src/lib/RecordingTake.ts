import type { Clef, Measure, Note, Score } from '@mushee/notation/model'
import type { MxmlMeasure } from '@mushee/notation/model/io/MusicXml'
import { ScoreDeserializer } from '@mushee/notation/model/io/ScoreDeserializer'

/**
 * One take's write-back into the score: where it starts, the measures it adds as the cursor
 * runs, the transcription updates the server streams back (landed on those measures), and
 * what is left once it is over — the bar to carry on from, or nothing at all when the take
 * never got going. React-free, so the hook that drives a take (useRecording) only
 * orchestrates — state, toasts, autosave.
 */
export class RecordingTake {
    /**
     * The take Record starts. With a note selected it records into that note's measure and
     * clef (displacing the measure). With nothing selected it carries on after the music: it
     * starts at the bar after the last one that holds a pitched note — bar 1 of an empty score,
     * a fresh bar at the end when the last bar is written — in the clef in effect there. Null
     * only for a score without a single bar.
     */
    static startingAt(score: Score, note: Note | null): RecordingTake | null {
        if (note) return new RecordingTake(score, note.measure.index, note.clef)
        const last = score.lastMeasure
        if (!last) return null
        const index = score.measures.findLastIndex((measure) => RecordingTake.holdsPitchedNotes(measure)) + 1
        const clef = score.measures[index]?.clefAtOrBefore(0) ?? last.lastClef
        return new RecordingTake(score, index, clef)
    }

    private static holdsPitchedNotes(measure: Measure): boolean {
        return measure.notes.some((note) => !note.isRest)
    }

    /** Where the next measure the take needs goes. */
    private nextMeasureIndex: number
    /** The measures the take added, by identity — they stay the take's even if bars move around them. */
    private added: Measure[] = []
    /**
     * Octaves the take's transcribed notes are shifted by to sit on {@link clef}'s staff.
     * Decided once, from the first update that carries pitches, then locked for the take —
     * emitted measures are frozen, so re-deciding would leave earlier measures an octave apart.
     */
    private octaveShift: number | null = null

    /**
     * @param startIndex where the take's first measure goes (the cursor's measure, which it displaces)
     * @param clef the clef the take records into — transcribed notes are octave-normalized onto its staff
     */
    constructor(
        private readonly score: Score,
        readonly startIndex: number,
        private readonly clef: Clef,
    ) {
        this.nextMeasureIndex = startIndex
    }

    /**
     * Insert the take's first measure. It displaces the cursor's measure and adopts its tempo
     * marking, so the count-off and click run at the bpm the cursor sat in.
     */
    begin(): void {
        const measure = this.score.addMeasureAdoptingTempo(this.nextMeasureIndex++)
        measure.complete()
        this.added.push(measure)
    }

    /** Add the next measure as the cursor is about to run off the last one. */
    appendMeasure(): void {
        const measure = this.score.addMeasure(this.nextMeasureIndex++)
        measure.complete()
        this.added.push(measure)
    }

    /** The measures the take added that are still in the score, in order (empty before {@link begin}). */
    get measures(): Measure[] {
        return this.added.filter((measure) => this.score.measures.includes(measure))
    }

    /** Whether any of the take's measures holds a pitched note — false for a take that heard nothing. */
    get wrotePitchedNotes(): boolean {
        return this.measures.some((measure) => RecordingTake.holdsPitchedNotes(measure))
    }

    /**
     * The first note of the bar right after the take — where pressing Record again carries on,
     * since a take inserts before the bar it starts in. A take that started from a selection
     * displaced that bar, so it is always there; a take that ran off the end of the score gets
     * one empty bar added after it first (part of the take, so one Undo takes both away).
     */
    noteAfter(): Note | null {
        const last = this.measures.at(-1)
        if (!last) return null
        const index = last.index + 1
        if (!this.score.measures[index]) this.score.addMeasure(index).complete()
        return this.score.measures[index]?.firstNote ?? null
    }

    /**
     * Take the take back out when it never wrote a note — refused by the server, a microphone
     * that wouldn't open, a limit already spent — so a failed start leaves the score exactly
     * as it was (the displaced bar's tempo marking moves back onto it). A take that wrote any
     * pitched note is kept. Returns whether anything was removed.
     */
    discardIfEmpty(): boolean {
        const measures = this.measures
        if (measures.length === 0 || this.wrotePitchedNotes) return false
        this.score.removeMeasures(measures)
        this.added = []
        this.nextMeasureIndex = this.startIndex
        return true
    }

    /**
     * Write a transcription update into the take's measures. Keys are 0-based indices
     * relative to the take's first measure; an update for a measure that is gone, or that
     * carries no notes, is skipped. Returns, per written measure, how many beats from its
     * start the real notes now cover (up to the end of the last pitched note) — the stretch
     * whose live waveform bars have done their job.
     */
    applyUpdate(measures: Record<number, MxmlMeasure>): Array<{ measureIndex: number; coveredBeats: number }> {
        const covered: Array<{ measureIndex: number; coveredBeats: number }> = []
        for (const [key, mxmlMeasure] of Object.entries(measures)) {
            const measureIndex = this.startIndex + Number(key)
            const measure = this.score.measures[measureIndex]
            if (!measure?.firstNote) continue
            let notes = ScoreDeserializer.mxmlMeasureToNotes(mxmlMeasure)
            if (!notes.length) continue
            // Recorded audio's absolute octave is arbitrary relative to the staff (whistling
            // sits 1-2 octaves up); pull the take onto the clef the user is writing in.
            if (this.octaveShift === null) {
                const pitches = notes.flatMap((n) => (n.pitch ? [n.pitch] : []))
                if (pitches.length) this.octaveShift = this.clef.octavesToCenter(pitches)
            }
            if (this.octaveShift) {
                const shift = this.octaveShift
                notes = notes.map((n) => (n.pitch ? n.clone({ pitch: n.pitch.octaveShifted(shift) }) : n))
            }
            this.score.replace([measure.firstNote], notes)
            let beat = 0
            let coveredBeats = 0
            for (const note of notes) {
                const span = note.duration.effectiveBeats
                if (!note.isRest) coveredBeats = beat + span
                beat += span
            }
            if (coveredBeats > 0) covered.push({ measureIndex, coveredBeats })
        }
        return covered
    }
}
