import { describe, expect, it } from 'vitest'

import { BeatPositionedList } from '@/model/util/BeatPositionedList'

interface Item {
    readonly beatPosition: number
    readonly label: string
}

const item = (beatPosition: number, label: string): Item => ({ beatPosition, label })

function listOf(...items: Item[]) {
    const live = [...items]
    return { live, list: new BeatPositionedList<Item>(() => live) }
}

describe('BeatPositionedList', () => {
    describe('leading', () => {
        it('returns the item at beat 0', () => {
            const { list } = listOf(item(2, 'mid'), item(0, 'lead'))
            expect(list.leading?.label).toBe('lead')
        })

        it('falls back to the earliest stored item when nothing sits at beat 0', () => {
            const { list } = listOf(item(2, 'mid'), item(3, 'later'))
            expect(list.leading?.label).toBe('mid')
        })

        it('is undefined for an empty list', () => {
            const { list } = listOf()
            expect(list.leading).toBeUndefined()
        })
    })

    describe('last', () => {
        it('returns the highest-beat item even when stored out of order', () => {
            const { list } = listOf(item(3, 'c'), item(0, 'a'), item(1, 'b'))
            expect(list.last?.label).toBe('c')
        })

        it('is undefined for an empty list', () => {
            const { list } = listOf()
            expect(list.last).toBeUndefined()
        })
    })

    describe('at', () => {
        it('returns the item exactly at the beat, undefined otherwise', () => {
            const { list } = listOf(item(0, 'a'), item(2, 'b'))
            expect(list.at(2)?.label).toBe('b')
            expect(list.at(1)).toBeUndefined()
        })
    })

    describe('atOrBefore', () => {
        it('returns the latest item at or before the beat', () => {
            const { list } = listOf(item(0, 'a'), item(2, 'b'))
            expect(list.atOrBefore(0)?.label).toBe('a')
            expect(list.atOrBefore(1)?.label).toBe('a')
            expect(list.atOrBefore(2)?.label).toBe('b')
            expect(list.atOrBefore(5)?.label).toBe('b')
        })

        it('is undefined when every item is after the beat', () => {
            const { list } = listOf(item(2, 'b'))
            expect(list.atOrBefore(1)).toBeUndefined()
        })

        it('keeps the latest match when items are stored out of order', () => {
            const { list } = listOf(item(3, 'late'), item(1, 'early'))
            expect(list.atOrBefore(5)?.label).toBe('late')
        })
    })

    describe('before', () => {
        it('ignores an item exactly at the beat', () => {
            const { list } = listOf(item(0, 'a'), item(2, 'b'))
            expect(list.before(2)?.label).toBe('a')
            expect(list.before(3)?.label).toBe('b')
        })

        it('is undefined when nothing is strictly before the beat', () => {
            const { list } = listOf(item(0, 'a'))
            expect(list.before(0)).toBeUndefined()
        })

        it('keeps the latest match when items are stored out of order', () => {
            const { list } = listOf(item(2, 'late'), item(1, 'early'))
            expect(list.before(3)?.label).toBe('late')
        })
    })

    describe('midMeasureChanges', () => {
        it('excludes the leading item and a no-op change, keeps real changes sorted by beat', () => {
            const { list } = listOf(item(0, 'lead'), item(3, 'lead'), item(2, 'other'), item(1, 'lead'))
            // The beat-1 'lead' equals the active 'lead' before it → no-op, excluded.
            // The beat-2 'other' is a real change; the beat-3 'lead' changes back → real change too.
            const changes = list.midMeasureChanges((active, i) => active.label !== i.label)
            expect(changes.map((i) => [i.beatPosition, i.label])).toEqual([
                [2, 'other'],
                [3, 'lead'],
            ])
        })

        it('keeps a mid-measure item with nothing in effect before it', () => {
            const { list } = listOf(item(2, 'only'))
            const changes = list.midMeasureChanges(() => false) // even a "never changes" predicate keeps it
            expect(changes.map((i) => i.label)).toEqual(['only'])
        })

        it('reflects the live array (a wrapped accessor, not a snapshot)', () => {
            const { live, list } = listOf(item(0, 'a'))
            expect(list.last?.label).toBe('a')
            live.push(item(4, 'b'))
            expect(list.last?.label).toBe('b')
        })
    })
})
