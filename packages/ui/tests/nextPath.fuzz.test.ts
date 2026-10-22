import { describe, expect, it } from 'vitest'

import { safeNextPath } from '../src/nextPath'
import { fuzzedNextValues } from '../src/testing/nextPathFuzz'

/**
 * `?next=` is attacker-controlled (it arrives in a link). Whatever it holds,
 * the path we redirect to must resolve on our own origin — checked with the
 * platform URL parser, which is what the browser will do with it (including
 * its backslash-as-slash normalisation).
 */
describe('safeNextPath — same-origin invariant (fuzz)', () => {
    it('never yields a path that resolves off-origin, over 3000 seeded values', () => {
        const origin = 'https://solkey.io'
        const fallback = '/scores'
        for (const { seed, next } of fuzzedNextValues()) {
            const result = safeNextPath(next, fallback)
            const resolved = new URL(result, `${origin}/login`)
            expect(resolved.origin, `seed ${seed}: next=${JSON.stringify(next)} → ${result}`).toBe(origin)
            expect(result.startsWith('/')).toBe(true)
            // and an accepted value survives the round trip through a `?next=` link unchanged
            const query = new URLSearchParams(`next=${encodeURIComponent(result)}`)
            if (result !== fallback) expect(safeNextPath(query.get('next'), fallback)).toBe(result)
        }
    })
})
