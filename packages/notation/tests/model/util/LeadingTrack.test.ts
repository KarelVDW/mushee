import { LeadingTrack } from '@mushee/notation/model/util/LeadingTrack'
import { describe, expect, it } from 'vitest'

interface Item {
    readonly beatPosition: number
    readonly label: string
}

const item = (beatPosition: number, label: string): Item => ({ beatPosition, label })
const labels = (track: LeadingTrack<Item>) => track.items.map((i) => `${i.beatPosition}:${i.label}`)
/** The inherited leading item a carry-forward would put in. */
const inherited = () => item(0, 'inherited')

describe('LeadingTrack', () => {
    it('starts with its leading item and the given explicit state', () => {
        const track = new LeadingTrack(item(0, 'lead'), true)
        expect(labels(track)).toEqual(['0:lead'])
        expect(track.leadingExplicit).toBe(true)
        expect(track.list.leading?.label).toBe('lead')
    })

    it('add stores an item as given', () => {
        const track = new LeadingTrack(item(0, 'lead'), false)
        track.add(item(2, 'mid'))
        expect(labels(track)).toEqual(['0:lead', '2:mid'])
        expect(track.leadingExplicit).toBe(false)
    })

    describe('set', () => {
        it('replaces the item at its beat; beat 0 marks the leading item explicit', () => {
            const track = new LeadingTrack(item(0, 'lead'), false)
            track.set(item(0, 'new lead'), true) // the leading item is never redundant
            expect(labels(track)).toEqual(['0:new lead'])
            expect(track.leadingExplicit).toBe(true)
        })

        it('drops a redundant mid-measure item together with the old item at that beat', () => {
            const track = new LeadingTrack(item(0, 'lead'), false)
            track.add(item(2, 'old'))
            track.set(item(2, 'same as before'), true)
            expect(labels(track)).toEqual(['0:lead'])
            expect(track.leadingExplicit).toBe(false)
        })

        it('keeps a mid-measure change, replacing the old item at that beat, without touching the leading state', () => {
            const track = new LeadingTrack(item(0, 'lead'), false)
            track.add(item(2, 'old'))
            track.set(item(2, 'change'), false)
            expect(labels(track)).toEqual(['0:lead', '2:change'])
            expect(track.leadingExplicit).toBe(false)
        })
    })

    describe('replaceLeadingInherited', () => {
        it('swaps in the inherited leading item, keeping mid-measure changes, and reports the change', () => {
            const track = new LeadingTrack(item(0, 'lead'), false)
            track.add(item(2, 'mid'))
            expect(track.replaceLeadingInherited(inherited, () => false)).toBe(true)
            expect(labels(track)).toEqual(['0:inherited', '2:mid'])
            expect(track.leadingExplicit).toBe(false)
        })

        it('changes nothing when the leading item already matches', () => {
            const track = new LeadingTrack(item(0, 'lead'), false)
            expect(track.replaceLeadingInherited(inherited, () => true)).toBe(false)
            expect(labels(track)).toEqual(['0:lead'])
        })

        it('never overrides an explicit leading item — nor asks whether it matches', () => {
            const track = new LeadingTrack(item(0, 'lead'), true)
            let asked = false
            const isCurrent = () => {
                asked = true
                return false
            }
            expect(track.replaceLeadingInherited(inherited, isCurrent)).toBe(false)
            expect(asked).toBe(false)
            expect(labels(track)).toEqual(['0:lead'])
        })

        it('applies again once the leading item is demoted', () => {
            const track = new LeadingTrack(item(0, 'lead'), true)
            track.demoteLeading()
            expect(track.leadingExplicit).toBe(false)
            expect(track.replaceLeadingInherited(inherited, () => false)).toBe(true)
        })
    })

    it('map rewrites every item and keeps the leading state', () => {
        const track = new LeadingTrack(item(0, 'a'), true)
        track.add(item(2, 'b'))
        track.map((i) => item(i.beatPosition, i.label.toUpperCase()))
        expect(labels(track)).toEqual(['0:A', '2:B'])
        expect(track.leadingExplicit).toBe(true)
    })

    it('every write replaces the items array, so a walk over a snapshot is never disturbed', () => {
        const track = new LeadingTrack(item(0, 'lead'), false)
        const writes: Array<() => void> = [
            () => track.add(item(1, 'added')),
            () => track.set(item(2, 'set'), false),
            () => track.set(item(1, 'redundant'), true),
            () => track.map((i) => i),
            () => track.replaceLeadingInherited(inherited, () => false),
        ]
        for (const write of writes) {
            const snapshot = track.items
            const copy = [...snapshot]
            write()
            expect(track.items).not.toBe(snapshot)
            expect(snapshot).toEqual(copy)
        }
    })
})
