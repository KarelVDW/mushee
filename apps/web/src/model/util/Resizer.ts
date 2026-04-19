import { sortBy, sum, sumBy, uniq } from 'lodash-es'

class ResizeError extends Error {
    constructor() {
        super('Container too small')

        //   JSON.stringify({
        //                         measureWidth: this.measureWidth,
        //                         minimalWidth: this.measure.minimalWidth,
        //                         physical: sumBy(this.measure.physicalElements, el => el.width.total),
        //                         totalReserve,
        //                         totalDeficit,
        //                     }),
    }
}

export type Sizeable = {
    minimum: number
    default: number
}

export class Resizer<T extends Sizeable> {
    private _sizeMap: Map<T, number> = new Map()
    constructor(
        private elements: T[],
        options?: { width?: number; maximumWidth?: number },
    ) {
        const allotted: Map<T, number> = new Map()
        const deficits: Map<T, number> = new Map()
        const reserves: Map<T, number> = new Map()

        const totalDefaults = sumBy(this.elements, (el) => el.default)
        const totalMinimums = sumBy(this.elements, (el) => el.minimum)

        let totalWidth: number
        if (typeof options?.width === 'number') {
            console.log('totalWidth from options')
            totalWidth = options.width
        } else if (typeof options?.maximumWidth === 'number') {
            console.log('totalWidth from maximumWidth')
            totalWidth = Math.min(Math.max(totalDefaults, totalMinimums), options.maximumWidth)
        } else {
            console.log('totalWidth from defaults')
            totalWidth = totalDefaults
        }

        if (totalMinimums - 0.0001 > totalWidth) {
            console.log('elements', this.elements)
            throw new ResizeError()
        }

        const correction = this.elements.length > 0 ? (totalWidth - totalDefaults) / this.elements.length : 0
        for (const sizeable of this.elements) {
            const allotedWidth = sizeable.default + correction
            allotted.set(sizeable, allotedWidth)
            if (allotedWidth < sizeable.minimum) deficits.set(sizeable, sizeable.minimum - allotedWidth)
            if (allotedWidth > sizeable.minimum) reserves.set(sizeable, allotedWidth - sizeable.minimum)
        }
        let totalDeficit = sum(Array.from(deficits.values()))

        if (deficits.size) {
            const sortedReserves = sortBy(uniq(Array.from(reserves.values())))
            let currentLevel = 0
            for (const level of sortedReserves) {
                const levelDiff = level - currentLevel
                currentLevel = level
                const totalPossibleFillIn = levelDiff * reserves.size
                const actualFillIn = totalPossibleFillIn > totalDeficit ? totalDeficit : totalPossibleFillIn
                totalDeficit -= actualFillIn
                let remaining = actualFillIn

                for (const [el, deficit] of Array.from(deficits)) {
                    const give = Math.min(deficit, remaining / deficits.size)
                    if (deficit <= give) {
                        deficits.delete(el)
                    } else {
                        deficits.set(el, deficit - give)
                    }
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    allotted.set(el, allotted.get(el)! + give)
                    remaining -= give
                }

                const reserveIncrement = actualFillIn / reserves.size
                for (const [el, reserve] of Array.from(reserves)) {
                    if (reserve <= reserveIncrement) {
                        reserves.delete(el)
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        allotted.set(el, allotted.get(el)! - reserve)
                    } else {
                        reserves.set(el, reserve - reserveIncrement)
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        allotted.set(el, allotted.get(el)! - reserveIncrement)
                    }
                }
                if (actualFillIn < totalPossibleFillIn) break
            }
        }
        this._sizeMap = allotted
    }

    getSize(element: T) {
        const size = this._sizeMap.get(element)
        if (typeof size !== 'number') throw new Error('Element not spaced in container')
        return size
    }
}
