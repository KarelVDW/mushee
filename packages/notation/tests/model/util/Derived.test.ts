import { Derived } from '@mushee/notation/model/util/Derived'
import { describe, expect, it } from 'vitest'

describe('Derived', () => {
    it('computes lazily on first read', () => {
        let computes = 0
        const derived = new Derived(
            () => 0,
            () => ++computes,
        )
        expect(computes).toBe(0) // nothing computed at construction
        expect(derived.value).toBe(1)
        expect(computes).toBe(1)
    })

    it('caches the value while the probed version is unchanged', () => {
        let computes = 0
        const derived = new Derived(
            () => 0,
            () => ({ computes: ++computes }),
        )
        const first = derived.value
        expect(derived.value).toBe(first) // same object, no recompute
        expect(computes).toBe(1)
    })

    it('recomputes exactly once when the version moves', () => {
        let version = 0
        let computes = 0
        const derived = new Derived(
            () => version,
            () => ({ computes: ++computes }),
        )
        const first = derived.value
        version++
        const second = derived.value
        expect(second).not.toBe(first)
        expect(derived.value).toBe(second) // cached again at the new version
        expect(computes).toBe(2)
    })
})
