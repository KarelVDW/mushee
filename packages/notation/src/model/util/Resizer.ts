import { sum, sumBy } from 'lodash-es'

class ResizeError extends Error {
    constructor() {
        super('Container too small')
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
        if (typeof options?.width === 'number') totalWidth = options.width
        else if (typeof options?.maximumWidth === 'number')
            totalWidth = Math.min(Math.max(totalDefaults, totalMinimums), options.maximumWidth)
        else totalWidth = totalDefaults

        if (totalMinimums - 0.0001 > totalWidth) throw new ResizeError()

        const correction = this.elements.length > 0 ? (totalWidth - totalDefaults) / this.elements.length : 0
        for (const sizeable of this.elements) {
            const allotedWidth = sizeable.default + correction
            allotted.set(sizeable, allotedWidth)
            if (allotedWidth < sizeable.minimum) deficits.set(sizeable, sizeable.minimum - allotedWidth)
            if (allotedWidth > sizeable.minimum) reserves.set(sizeable, allotedWidth - sizeable.minimum)
        }

        if (deficits.size) {
            const totalDeficit = sum(Array.from(deficits.values()))
            const totalReserve = sum(Array.from(reserves.values()))
            for (const el of deficits.keys()) {
                allotted.set(el, el.minimum)
            }
            for (const [el, reserve] of reserves) {
                const take = (reserve / totalReserve) * totalDeficit
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                allotted.set(el, allotted.get(el)! - take)
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
