import { CLEF_LINE_OFFSET } from './clefs'
import { ClefLayout } from './layout/ClefLayout'
import type { Measure } from './Measure'
import { Pitch } from './Pitch'
import { LINES_PER_OCTAVE, STAFF_MIDDLE_LINE } from './staffLines'
import type { ClefType } from './types'

/**
 * A clef anchored in a measure: the leading clef sits at beat 0, further ones
 * are mid-measure changes. Immutable after construction; its layout (with its
 * width) depends only on `type`, so it is the per-type shared ClefLayout
 * (context-free, see ARCHITECTURE.md).
 */
export class Clef {
    readonly id = crypto.randomUUID()

    constructor(
        readonly measure: Measure,
        readonly beatPosition: number,
        readonly type: ClefType,
    ) {}

    get layout(): ClefLayout {
        return ClefLayout.of(this.type)
    }

    lineFor(pitch: Pitch): number {
        return pitch.line + CLEF_LINE_OFFSET[this.type]
    }

    pitchForLine(line: number): Pitch {
        return Pitch.fromLine(line - CLEF_LINE_OFFSET[this.type])
    }

    /** The natural pitch on the staff's middle line — B4 in treble, D3 in bass: where a new note lands by default. */
    get middleLinePitch(): Pitch {
        return this.pitchForLine(STAFF_MIDDLE_LINE)
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
        return Math.round((STAFF_MIDDLE_LINE - median) / LINES_PER_OCTAVE)
    }
}
