import type { Measure, Note, Score } from '../model'

/**
 * Which notes land while a take records: a note that appears during the recording fades in
 * once (NoteGroup's `landing`: the `note-land` keyframe, opacity only), and nothing that was
 * already on screen replays.
 *
 * New is judged by content, not by id — the measure's index, the note's onset beat, its pitch
 * and its duration — because every transcription update rebuilds a measure's notes from
 * scratch (RecordingTake.applyUpdate → Score.replace), so ids change each time the server
 * refines a measure. A re-sent measure whose notes are unchanged doesn't replay; a note whose
 * pitch, onset or length changed lands as new. The note object that first showed a key keeps
 * its mark for as long as it stays on screen, so a later render can't cut its fade short — and
 * a render repeated with the same score (React may render twice) answers the same.
 *
 * The notes already on screen when the recording starts are taken as shown; everything is
 * forgotten once it ends.
 */
export class NoteLanding {
    private recording = false
    /** Content keys shown during this recording. */
    private readonly shown = new Set<string>()
    /** Ids of the notes whose key first showed with them: the ones that fade in. */
    private landing = new Set<string>()
    /**
     * Per measure, the landing ids last handed out: the same Set for as long as they don't
     * change, so a memoised measure that has nothing new keeps its memo.
     */
    private byMeasure = new Map<Measure, { signature: string; ids: ReadonlySet<string> }>()

    /** Take in a render of `score`, with `recording` saying whether a take is live. */
    update(score: Score, recording: boolean): void {
        if (!recording) {
            if (this.recording) this.reset()
            return
        }
        const seeding = !this.recording
        this.recording = true
        const landing = new Set<string>()
        const byMeasure = new Map<Measure, { signature: string; ids: ReadonlySet<string> }>()
        score.measures.forEach((measure, index) => {
            const ids: string[] = []
            for (const note of measure.notes) {
                const key = NoteLanding.keyOf(note, measure, index)
                if (this.landing.has(note.id) || (!seeding && !this.shown.has(key))) ids.push(note.id)
                this.shown.add(key)
            }
            if (ids.length === 0) return
            for (const id of ids) landing.add(id)
            const signature = ids.join(',')
            const previous = this.byMeasure.get(measure)
            byMeasure.set(measure, previous?.signature === signature ? previous : { signature, ids: new Set(ids) })
        })
        this.landing = landing
        this.byMeasure = byMeasure
    }

    /** The ids of `measure`'s notes that land in the render last taken in; undefined when none do. */
    landingIn(measure: Measure): ReadonlySet<string> | undefined {
        return this.byMeasure.get(measure)?.ids
    }

    private reset(): void {
        this.recording = false
        this.shown.clear()
        this.landing = new Set()
        this.byMeasure = new Map()
    }

    /** What a note is, for telling a new one from a re-sent one: where it starts, what it sounds, how long. */
    private static keyOf(note: Note, measure: Measure, index: number): string {
        const { pitch, duration } = note
        const sound = pitch ? `${pitch.name}${pitch.alter}/${pitch.octave}` : 'rest'
        const length = `${duration.type}.${duration.dots}.${duration.ratio.actualNotes}:${duration.ratio.normalNotes}`
        return `${index}@${measure.beatOffsetOf(note)}:${sound}:${length}`
    }
}
