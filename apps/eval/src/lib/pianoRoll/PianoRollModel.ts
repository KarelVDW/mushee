import { Pitch } from '@mushee/notation/model/Pitch'

import type { NoteDto } from '../dto'

/** A pitch contour sampled at a fixed hop, in fractional MIDI (null = unvoiced). */
export interface Contour {
    hopSec: number
    values: Array<number | null>
}

interface ModelInput {
    durationSec: number
    pxPerSec: number
    /** Notes of every layer, visible or not — the pitch range stays put when a layer toggles. */
    notes: NoteDto[][]
    contours: Contour[]
    /** Preferred plot height; rows shrink to fit a wide range and grow up to a readable size. */
    targetHeight: number
}

/**
 * The geometry of the clip's piano roll: time runs left to right at `pxPerSec`, one row per
 * semitone, integer MIDI on the row's centre line so a contour sitting on a note runs through
 * its middle. Pure and immutable — a zoom or a new layer makes a new model.
 */
export class PianoRollModel {
    static readonly AXIS_HEIGHT = 24
    static readonly MIN_ROW = 7
    static readonly MAX_ROW = 18
    /** Wider than this and the SVG gets heavy; the zoom stops here. */
    static readonly MAX_WIDTH = 60_000

    readonly minMidi: number
    readonly maxMidi: number
    readonly rowHeight: number
    readonly width: number
    readonly plotHeight: number
    readonly durationSec: number
    readonly pxPerSec: number

    constructor(input: ModelInput) {
        this.durationSec = Math.max(
            input.durationSec,
            ...input.notes.flat().map((n) => n.onsetSec + n.durSec),
            ...input.contours.map((c) => c.values.length * c.hopSec),
            1,
        )
        this.pxPerSec = Math.min(input.pxPerSec, PianoRollModel.MAX_WIDTH / this.durationSec)
        const [lo, hi] = PianoRollModel.range(input.notes, input.contours)
        this.minMidi = lo - 2
        this.maxMidi = hi + 2
        const rows = this.maxMidi - this.minMidi + 1
        this.rowHeight = Math.max(PianoRollModel.MIN_ROW, Math.min(PianoRollModel.MAX_ROW, Math.floor(input.targetHeight / rows)))
        this.plotHeight = rows * this.rowHeight
        this.width = Math.ceil(this.durationSec * this.pxPerSec)
    }

    get height(): number {
        return this.plotHeight + PianoRollModel.AXIS_HEIGHT
    }

    get rows(): number[] {
        return Array.from({ length: this.maxMidi - this.minMidi + 1 }, (_, i) => this.maxMidi - i)
    }

    x(sec: number): number {
        return sec * this.pxPerSec
    }

    secAt(x: number): number {
        return Math.max(0, Math.min(this.durationSec, x / this.pxPerSec))
    }

    /** Top of a semitone's row. */
    rowTop(midi: number): number {
        return (this.maxMidi - midi) * this.rowHeight
    }

    /** A fractional pitch's y: integer MIDI on its row's centre. */
    y(midi: number): number {
        return (this.maxMidi + 0.5 - midi) * this.rowHeight
    }

    /** Which rows carry a pitch label: every row when there is room, else C, E and G. */
    labelled(midi: number): boolean {
        return this.rowHeight >= 12 || [0, 4, 7].includes(midi % 12)
    }

    static label(midi: number): string {
        return Pitch.fromMidi(midi).label
    }

    /** Ticks at a round step that leaves at least ~70 px between labels. */
    ticks(): number[] {
        const step = [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * this.pxPerSec >= 70) ?? 120
        return Array.from({ length: Math.floor(this.durationSec / step) + 1 }, (_, i) => Number((i * step).toFixed(2)))
    }

    /** An SVG path through a contour, broken at every unvoiced frame and every jump over a fifth. */
    contourPath(contour: Contour): string {
        const parts: string[] = []
        let prev: number | null = null
        contour.values.forEach((v, i) => {
            if (v == null || v < this.minMidi - 1 || v > this.maxMidi + 1) {
                prev = null
                return
            }
            const cmd = prev === null || Math.abs(v - prev) > 7 ? 'M' : 'L'
            parts.push(`${cmd}${this.x(i * contour.hopSec).toFixed(1)} ${this.y(v).toFixed(1)}`)
            prev = v
        })
        return parts.join('')
    }

    /**
     * The pitch range worth showing: every note, plus the contours' bulk (2nd–98th percentile, so a
     * stray octave-jump frame doesn't squash the roll).
     */
    private static range(notes: NoteDto[][], contours: Contour[]): [number, number] {
        const midis = notes.flat().map((n) => n.midi)
        const voiced = contours
            .flatMap((c) => c.values)
            .filter((v): v is number => v != null)
            .sort((a, b) => a - b)
        if (voiced.length) {
            midis.push(Math.floor(voiced[Math.floor(voiced.length * 0.02)]), Math.ceil(voiced[Math.floor(voiced.length * 0.98)]))
        }
        if (!midis.length) return [57, 72]
        return [Math.min(...midis), Math.max(...midis)]
    }
}
