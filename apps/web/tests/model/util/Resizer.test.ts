import { describe, expect, it } from 'vitest'

import { Resizer, type Sizeable } from '@/model/util/Resizer'

const sz = (def: number, min = 0): Sizeable => ({ default: def, minimum: min })

describe('Resizer', () => {
    describe('without options (uses sum of defaults as totalWidth)', () => {
        it('allots each element exactly its default when no resizing pressure', () => {
            const a = sz(100, 50)
            const b = sz(200, 50)
            const r = new Resizer([a, b])
            expect(r.getSize(a)).toBeCloseTo(100)
            expect(r.getSize(b)).toBeCloseTo(200)
        })

        it('handles an empty element list without throwing', () => {
            expect(() => new Resizer([])).not.toThrow()
        })

        it('throws "Element not spaced in container" for unknown element', () => {
            const a = sz(100, 50)
            const r = new Resizer([a])
            expect(() => r.getSize(sz(0))).toThrow('Element not spaced in container')
        })
    })

    describe('with explicit width', () => {
        it('distributes correction equally across elements', () => {
            const a = sz(100, 50)
            const b = sz(100, 50)
            const r = new Resizer([a, b], { width: 300 }) // 100 extra → 50 each
            expect(r.getSize(a)).toBeCloseTo(150)
            expect(r.getSize(b)).toBeCloseTo(150)
        })

        it('shrinks all elements equally when width is below total defaults but above minimums', () => {
            const a = sz(100, 50)
            const b = sz(100, 50)
            const r = new Resizer([a, b], { width: 150 }) // 50 less → -25 each
            expect(r.getSize(a)).toBeCloseTo(75)
            expect(r.getSize(b)).toBeCloseTo(75)
        })

        it('redistributes from reserves to deficits when uniform shrink would violate a minimum', () => {
            // a has tight minimum, b has slack. If we shrink uniformly to 80 each (total 160 from default 200),
            // a would go to 80 (< its 90 min). Reserve from b should top a up to its minimum.
            const a = sz(100, 90)
            const b = sz(100, 20)
            const r = new Resizer([a, b], { width: 160 })
            expect(r.getSize(a)).toBeCloseTo(90)
            expect(r.getSize(b)).toBeCloseTo(70)
        })

        it('throws ResizeError when total minimums exceed available width', () => {
            const a = sz(100, 100)
            const b = sz(100, 100)
            expect(() => new Resizer([a, b], { width: 150 })).toThrow('Container too small')
        })

        it('does NOT throw when totalMinimums equals totalWidth (boundary)', () => {
            const a = sz(50, 100)
            const b = sz(50, 100)
            // totalMinimums = 200, totalWidth = 200 → just allowed (uses 0.0001 tolerance)
            expect(() => new Resizer([a, b], { width: 200 })).not.toThrow()
        })

        it('every element ends at exactly its minimum when totalMinimums == totalWidth', () => {
            const a = sz(50, 100)
            const b = sz(150, 100)
            const r = new Resizer([a, b], { width: 200 })
            expect(r.getSize(a)).toBeCloseTo(100)
            expect(r.getSize(b)).toBeCloseTo(100)
        })
    })

    describe('with maximumWidth', () => {
        it('caps total at maximumWidth when defaults exceed it', () => {
            const a = sz(200, 50)
            const b = sz(200, 50)
            // max(totalDefaults=400, totalMinimums=100) = 400, capped to 300
            const r = new Resizer([a, b], { maximumWidth: 300 })
            expect(r.getSize(a) + r.getSize(b)).toBeCloseTo(300)
        })

        it('uses totalDefaults when defaults fit within maximum', () => {
            const a = sz(50, 10)
            const b = sz(50, 10)
            // max(100, 20) = 100, well under max → totalWidth = 100
            const r = new Resizer([a, b], { maximumWidth: 1000 })
            expect(r.getSize(a)).toBeCloseTo(50)
            expect(r.getSize(b)).toBeCloseTo(50)
        })

        it('uses totalMinimums when minimums exceed defaults', () => {
            const a = sz(10, 100)
            const b = sz(10, 100)
            // max(20, 200) = 200, under max → totalWidth = 200
            const r = new Resizer([a, b], { maximumWidth: 1000 })
            expect(r.getSize(a)).toBeCloseTo(100)
            expect(r.getSize(b)).toBeCloseTo(100)
        })

        it('throws ResizeError when minimums exceed maximumWidth', () => {
            const a = sz(10, 200)
            const b = sz(10, 200)
            expect(() => new Resizer([a, b], { maximumWidth: 300 })).toThrow('Container too small')
        })
    })

    describe('reserves do not drop below minimum after redistribution', () => {
        it('three elements: one large deficit, two reserves cover it proportionally', () => {
            const a = sz(20, 80) // big deficit
            const b = sz(100, 10) // big reserve
            const c = sz(80, 30) // medium reserve
            const r = new Resizer([a, b, c], { width: 200 })
            // each allotment must be >= minimum
            expect(r.getSize(a)).toBeGreaterThanOrEqual(80 - 1e-6)
            expect(r.getSize(b)).toBeGreaterThanOrEqual(10 - 1e-6)
            expect(r.getSize(c)).toBeGreaterThanOrEqual(30 - 1e-6)
            // total stays at width
            expect(r.getSize(a) + r.getSize(b) + r.getSize(c)).toBeCloseTo(200)
        })
    })
})
