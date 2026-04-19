import { sortBy, sumBy, takeWhile } from 'lodash-es'

import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from '@/components/notation/constants'
import type { LayoutBarline } from '@/components/notation/types'

import { Clef } from '../Clef'
import type { Measure } from '../Measure'
import { PhysicalElement } from '../PhysicalElement'
import { TimeSignature } from '../TimeSignature'
import { Resizer, type Sizeable } from '../util/Resizer'

export class MeasureLayout {
    readonly id = crypto.randomUUID()
    readonly measureX: number
    readonly measureWidth: number
    private _xMap: Map<PhysicalElement, { x: number; allottedWidth: number }> = new Map()
    constructor(readonly measure: Measure) {
        const row = measure.score.getRowForMeasure(measure)
        this.measureX = row.layout.getMeasureX(measure)
        this.measureWidth = row.layout.getMeasureWidth(measure)

        const sortedElements = sortBy(
            this.measure.physicalElements,
            (el) => this.measure.beatOffsetOf(el) ?? -1,
            (el) => !(el instanceof Clef),
            (el) => !(el instanceof TimeSignature),
        )
        const startOverhead = takeWhile(sortedElements, (el) => typeof el.beats !== 'number')

        const totalBeats = sumBy(this.measure.notes, (n) => n.duration.effectiveBeats)
        const contentWidth = this.measureWidth - this.measure.barlineWidth - sumBy(startOverhead, (el) => el.width.total)
        const widthByBeat = contentWidth / totalBeats

        const sizeableElements: Array<Sizeable & { element: PhysicalElement; children?: PhysicalElement[] }> = []
        for (const el of sortedElements.slice(startOverhead.length)) {
            if (typeof el.beats === 'number') {
                sizeableElements.push({ default: el.beats * widthByBeat, minimum: el.width.total, element: el })
            } else {
                const lastElement = sizeableElements[sizeableElements.length - 1]
                sizeableElements.splice(-1, 1, {
                    ...lastElement,
                    minimum: lastElement.minimum + el.width.total,
                    children: [...(lastElement.children || []), el],
                })
            }
        }
        const resizer = new Resizer(sizeableElements)

        let cursorX = 0
        const xMap = new Map<PhysicalElement, { x: number; allottedWidth: number }>()
        for (const el of startOverhead) {
            xMap.set(el, { x: cursorX, allottedWidth: el.width.total })
            cursorX += el.width.total
        }
        for (const el of sizeableElements) {
            const allottedWidth = resizer.getSize(el)
            xMap.set(el.element, { x: cursorX, allottedWidth })
            cursorX += allottedWidth
            if (el.children) {
                const totalChildWidth = sumBy(el.children, (el) => el.width.total)
                cursorX -= totalChildWidth
                for (const child of el.children) {
                    xMap.set(child, { x: cursorX, allottedWidth: 0 })
                    cursorX += child.width.total
                }
            }
        }
        this._xMap = xMap
    }

    getXForElement(el: PhysicalElement) {
        const spacing = this._xMap.get(el)
        if (!spacing) throw new Error('Element not spaced in measure')
        return spacing.x
    }

    getNoteForX(x: number) {
        for (const note of this.measure.notes) {
            const spacing = this._xMap.get(note)
            if (!spacing) continue
            if (x >= spacing.x && x < spacing.x + spacing.allottedWidth) return note
        }
        return null
    }

    getXForBeat(beat: number) {
        const overshootIndex = this.measure.notes.findIndex((el) => this.measure.beatOffsetOf(el) > beat)
        const note = overshootIndex === -1 ? this.measure.notes.at(-1) : this.measure.notes[overshootIndex - 1] || this.measure.firstNote
        if (!note) return 0
        const spacing = this._xMap.get(note)
        if (!spacing) throw new Error('Note not spaced in measure')
        return spacing.x + (spacing.allottedWidth * (beat - this.measure.beatOffsetOf(note))) / note.duration.effectiveBeats
    }

    get barline(): LayoutBarline | null {
        const type = this.measure.endBarline ?? 'single'
        if (type === 'none') return null
        const headroom = SPACE_ABOVE_STAFF * STAVE_LINE_DISTANCE
        const staffHeight = (NUM_STAFF_LINES - 1) * STAVE_LINE_DISTANCE
        return {
            x: this.measureWidth - this.measure.barlineWidth,
            y: headroom,
            height: staffHeight,
            type,
        }
    }
}
