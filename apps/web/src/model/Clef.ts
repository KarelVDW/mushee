import { CLEF_LINE_OFFSET } from '@/components/notation/constants'
import type { ClefType } from '@/components/notation/types'

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
}
