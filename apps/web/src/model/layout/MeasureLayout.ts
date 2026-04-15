import { sortBy, sum, sumBy, takeWhile, uniq } from 'lodash-es'

import { NUM_STAFF_LINES, SPACE_ABOVE_STAFF, STAVE_LINE_DISTANCE } from '@/components/notation/constants'
import type { LayoutBarline } from '@/components/notation/types'

import { Clef } from '../Clef'
import type { Measure } from '../Measure'
import { PhysicalElement } from '../PhysicalElement'
import { TimeSignature } from '../TimeSignature'

export class MeasureLayout {
    readonly id = crypto.randomUUID()
    readonly measureX: number
    readonly measureWidth: number
    private _xMap: Map<PhysicalElement, { x: number; allottedWidth: number }> = new Map()
    constructor(readonly measure: Measure) {
        this.measureX = this.measure.score.layout.getMeasureX(this.measure)
        this.measureWidth = this.measure.score.layout.getMeasureWidth(this.measure)

        const elements = this.measure.physicalElements
        const sortedElements = sortBy(
            elements,
            (el) => el.beatOffset ?? -1,
            (el) => !(el instanceof Clef),
            (el) => !(el instanceof TimeSignature),
        )
        const startOverhead = takeWhile(sortedElements, (el) => typeof el.beats !== 'number')

        const totalBeats = sumBy(this.measure.notes, (n) => n.duration.effectiveBeats)
        const contentWidth = this.measureWidth - this.measure.barlineWidth - sumBy(startOverhead, (el) => el.width.total)
        const widthByBeat = contentWidth / totalBeats
        let parent: PhysicalElement | undefined
        const allotted: Map<PhysicalElement, number> = new Map()
        const deficits: Map<PhysicalElement, number> = new Map()
        const reserves: Map<PhysicalElement, number> = new Map()
        const dependents: Map<PhysicalElement, PhysicalElement[]> = new Map()
        for (const el of sortedElements.slice(startOverhead.length)) {
            if (typeof el.beats === 'number') {
                const allotedWidth = el.beats * widthByBeat
                allotted.set(el, allotedWidth)
                if (allotedWidth < el.width.total) deficits.set(el, el.width.total - allotedWidth)
                if (allotedWidth > el.width.total) reserves.set(el, allotedWidth - el.width.total)
                parent = el
            } else if (parent) dependents.set(parent, [...(dependents.get(parent) || []), el])
        }
        for (const [parent, children] of dependents.entries()) {
            const parentReserve = reserves.get(parent) || 0
            const totalChildWidth = sumBy(children, (el) => el.width.total)
            if (totalChildWidth < parentReserve) {
                reserves.delete(parent)
                deficits.set(parent, (deficits.get(parent) || 0) + totalChildWidth - parentReserve)
            } else reserves.set(parent, parentReserve - totalChildWidth)
        }
        let totalReserve = sum(Array.from(reserves.values()))
        let totalDeficit = sum(Array.from(deficits.values()))
        if (totalDeficit > 0.001 && totalReserve < totalDeficit) throw new Error('Measure is too small')

        if (deficits.size) {
            const sortedReserves = sortBy(uniq(Array.from(reserves.values())))
            let currentLevel = 0
            for (const level of sortedReserves) {
                const levelDiff = level - currentLevel
                currentLevel = level
                const totalPossibleFillIn = levelDiff * reserves.size
                const actualFillIn = totalPossibleFillIn > totalDeficit ? totalDeficit : totalPossibleFillIn
                totalReserve -= actualFillIn
                totalDeficit -= actualFillIn
                const fillInIncrement = actualFillIn / deficits.size

                for (const [el, deficit] of Array.from(deficits)) {
                    if (deficit <= fillInIncrement) {
                        deficits.delete(el)
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        allotted.set(el, allotted.get(el)! + deficit)
                    } else {
                        deficits.set(el, deficit - fillInIncrement)
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        allotted.set(el, allotted.get(el)! + fillInIncrement)
                    }
                }
                for (const [el, reserve] of Array.from(reserves)) {
                    if (reserve <= fillInIncrement) {
                        reserves.delete(el)
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        allotted.set(el, allotted.get(el)! - reserve)
                    } else {
                        reserves.set(el, reserve - fillInIncrement)
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        allotted.set(el, allotted.get(el)! - fillInIncrement)
                    }
                }
                if (actualFillIn < totalPossibleFillIn) break
            }
        }
        let cursorX = 0
        const xMap = new Map<PhysicalElement, { x: number; allottedWidth: number }>()
        for (const el of startOverhead) {
            xMap.set(el, { x: cursorX, allottedWidth: el.width.total })
            cursorX += el.width.total
        }
        for (const el of sortedElements.slice(startOverhead.length)) {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const allottedWidth = allotted.get(el)!
            xMap.set(el, { x: cursorX, allottedWidth })
            cursorX += allottedWidth
        }
        for (const [parent, children] of dependents.entries()) {
            const totalChildWidth = sumBy(children, (el) => el.width.total)
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const { x: parentX, allottedWidth: parentAllottedWidth } = xMap.get(parent)!
            let internalCursorX = parentX + parentAllottedWidth - totalChildWidth
            for (const child of children) {
                xMap.set(child, { x: internalCursorX, allottedWidth: 0 })
                internalCursorX += child.width.total
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
            if (x>= spacing.x && x < spacing.x + spacing.allottedWidth) return note
        }
        return null
    }

    getX(beat: number) {
        const overshootIndex = this.measure.notes.findIndex((el) => el.beatOffset > beat)
        const note = this.measure.notes[overshootIndex - 1] || this.measure.firstNote
        if (!note) return 0
        const spacing = this._xMap.get(note)
        if (!spacing) throw new Error('Note not spaced in measure')
        return spacing.x + (spacing.allottedWidth * (beat - note.beatOffset)) / note.duration.effectiveBeats
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
