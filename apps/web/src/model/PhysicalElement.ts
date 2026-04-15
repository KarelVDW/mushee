import { PhysicalWidth } from './width/PhysicalWidth'

export interface PhysicalElement {
    width: PhysicalWidth
    beatOffset?: number
    beats?: number
}
