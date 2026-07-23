import { CLEF_LINE_OFFSET } from '../components/constants'
import type { ClefType } from '../components/types'
import { ClefLayout } from './layout/ClefLayout'
import type { Measure } from './Measure'
import { Pitch } from './Pitch'
import { ClefWidth } from './width/ClefWidth'

/**
 * A clef anchored in a measure: the leading clef sits at beat 0, further ones
 * are mid-measure changes. Immutable after construction; its layout and width
 * depend only on `type`, so they are cached forever (context-free, see
 * ARCHITECTURE.md).
 */
export class Clef {
    readonly id = crypto.randomUUID()
    private _layout: ClefLayout | null = null
    private _width: ClefWidth | null = null

    constructor(
        readonly measure: Measure,
        readonly beatPosition: number,
        readonly type: ClefType,
    ) {}

    get width(): ClefWidth {
        this._width ||= new ClefWidth(this)
        return this._width
    }

    get layout(): ClefLayout {
        this._layout ||= new ClefLayout(this)
        return this._layout
    }

    lineFor(pitch: Pitch): number {
        return pitch.line + CLEF_LINE_OFFSET[this.type]
    }

    pitchForLine(line: number): Pitch {
        return Pitch.fromLine(line - CLEF_LINE_OFFSET[this.type])
    }

    /**
     * The whole-octave shift that brings `pitches` closest to this clef's staff:
     * their median lands as near the middle line as whole octaves allow. Used to
     * normalize recorded audio, whose absolute octave (whistling, humming) is
     * arbitrary relative to the staff the user is writing on. Returns 0 for an
     * empty list.
     */
    octavesToCenter(pitches: readonly Pitch[]): number {
        if (!pitches.length) return 0
        const lines = pitches.map((p) => this.lineFor(p)).sort((a, b) => a - b)
        const median = lines[Math.floor((lines.length - 1) / 2)]
        // The staff spans lines 1..5; one octave is 3.5 lines.
        return Math.round((STAFF_MIDDLE_LINE - median) / LINES_PER_OCTAVE)
    }
}

const STAFF_MIDDLE_LINE = 3
const LINES_PER_OCTAVE = 3.5
