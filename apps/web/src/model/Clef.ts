import { CLEF_LINE_OFFSET } from '@/components/notation/constants'
import type { ClefType } from '@/components/notation/types'

import { ClefLayout } from './layout/ClefLayout'
import type { Measure } from './Measure'
import { Pitch } from './Pitch'
import { ClefWidth } from './width/ClefWidth'

export class Clef {
    readonly id = crypto.randomUUID()
    private _layout: ClefLayout | null = null
    private _width: ClefWidth | null = null

    constructor(
        readonly measure: Measure,
        readonly beatPosition: number,
        readonly type: ClefType,
    ) {}

    get width() {
        if (!this._width) this._width = new ClefWidth(this)
        return this._width
    }

    get layout() {
        if (!this._layout) this._layout = new ClefLayout(this)
        return this._layout
    }

    lineFor(pitch: Pitch): number {
        return pitch.line + CLEF_LINE_OFFSET[this.type]
    }

    pitchForLine(line: number): Pitch {
        return Pitch.fromLine(line - CLEF_LINE_OFFSET[this.type])
    }

    invalidateLayout() {
        this._layout = null
    }
}
