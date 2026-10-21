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
    private readonly sizes: Map<T, number>

    constructor(elements: T[], options?: { width?: number; maximumWidth?: number }) {
        const allotted: Map<T, number> = new Map()
        const deficits: Map<T, number> = new Map()
        const reserves: Map<T, number> = new Map()

        const totalDefaults = sumBy(elements, (el) => el.default)
        const totalMinimums = sumBy(elements, (el) => el.minimum)

        let totalWidth: number
        if (typeof options?.width === 'number') totalWidth = options.width
        else if (typeof options?.maximumWidth === 'number')
            totalWidth = Math.min(Math.max(totalDefaults, totalMinimums), options.maximumWidth)
        else totalWidth = totalDefaults

        if (totalMinimums - 0.0001 > totalWidth) throw new ResizeError()

        const correction = elements.length > 0 ? (totalWidth - totalDefaults) / elements.length : 0
        for (const sizeable of elements) {
            const allottedWidth = sizeable.default + correction
            allotted.set(sizeable, allottedWidth)
            if (allottedWidth < sizeable.minimum) deficits.set(sizeable, sizeable.minimum - allottedWidth)
            if (allottedWidth > sizeable.minimum) reserves.set(sizeable, allottedWidth - sizeable.minimum)
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
        this.sizes = allotted
    }

    getSize(element: T) {
        const size = this.sizes.get(element)
        if (typeof size !== 'number') throw new Error('Element not spaced in container')
        return size
    }
}
