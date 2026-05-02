import { describe, expect, it } from 'vitest'

import { makeScore, pitched } from '@test/helpers'

import { Tie } from '@/model/Tie'

describe('Tie', () => {
    it('stores note and nextNote', () => {
        const score = makeScore(1)
        const m = score.firstMeasure!
        const a = pitched('C', 4)
        const b = pitched('C', 4)
        m.replaceNotes(m.notes, [a, b])
        const tie = new Tie(a, b)
        expect(tie.note).toBe(a)
        expect(tie.nextNote).toBe(b)
    })

    it('invalidateLayout clears cached TieLayout', () => {
        const score = makeScore(1)
        const m = score.firstMeasure!
        const a = pitched('C', 4)
        const b = pitched('C', 4)
        m.replaceNotes(m.notes, [a, b])
        const tie = new Tie(a, b)
        const l1 = tie.layout
        tie.invalidateLayout()
        expect(tie.layout).not.toBe(l1)
    })
})

