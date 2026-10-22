import 'reflect-metadata'

import { describe, expect, it } from 'vitest'

import { DEMO_ACCOUNTS, DEMO_SCORES, EXAMPLE_SCORE_ID, EXAMPLE_SHARE_TOKEN } from '../../src/database/seed/demo-data'
import { ScoresService } from '../../src/scores/scores.service'

type Entry = { _type: string; duration?: number }
type Doc = { parts: { measures: { entries: Entry[] }[] }[]; partList: { scoreParts: { partName: string }[] } }

describe('demo data', () => {
    const shared = Object.entries(DEMO_SCORES).filter(([, score]) => score.shareToken)

    it('shares exactly one example, the one the publish script publishes, under a token the share route accepts', () => {
        expect(shared.map(([id, score]) => [id, score.shareToken])).toEqual([[EXAMPLE_SCORE_ID, EXAMPLE_SHARE_TOKEN]])
        expect(ScoresService.isShareToken(EXAMPLE_SHARE_TOKEN)).toBe(true)
    })

    it('keeps the example in Solkey’s own account', () => {
        const [id] = shared[0]
        const owners = DEMO_ACCOUNTS.filter((account) => account.scoreIds.includes(id))
        expect(owners.map((account) => account.name)).toEqual(['Solkey'])
    })

    it('seeds the whole Frère Jacques round for Voice, every bar a full 4/4', () => {
        const [, example] = shared[0]
        expect(example.title).toBe('Frère Jacques')
        const doc = example.document as unknown as Doc
        expect(doc.partList.scoreParts[0].partName).toBe('Voice')
        const bars = doc.parts[0].measures
        expect(bars).toHaveLength(8)
        // divisions 12 per quarter: a 4/4 bar holds 48.
        for (const bar of bars) {
            expect(bar.entries.filter((e) => e._type === 'note').reduce((sum, e) => sum + (e.duration ?? 0), 0)).toBe(48)
        }
    })

    it('references only scores it defines', () => {
        for (const account of DEMO_ACCOUNTS) for (const id of account.scoreIds) expect(DEMO_SCORES[id], id).toBeDefined()
    })
})
