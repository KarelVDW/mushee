import { Bravura } from '../../engraving/Bravura'
import { Clef } from '../Clef'
import { ClefLayout } from '../layout/ClefLayout'
import { PhysicalWidth } from './PhysicalWidth'

export class ClefWidth implements PhysicalWidth {
    readonly paddingLeft: number = 4
    readonly paddingRight: number = 4
    readonly content: number
    readonly total: number

    constructor(clef: Clef) {
        this.content = Bravura.width(ClefLayout.glyphFor(clef.type).glyphName)
        this.total = this.paddingLeft + this.content + this.paddingRight
    }
}
