import { fuzzedNextValues } from '@mushee/ui/testing/nextPathFuzz'
import { describe, expect, it } from 'vitest'

import { LIBRARY_PATH, nextPathFrom, withNext } from '@/lib/nextPath'

/**
 * The web wrappers over the shared guard, fuzzed over the guard's own corpus: whatever a
 * `?next=` link holds, nextPathFrom lands on our origin, and every value it accepts survives
 * a round trip through withNext unchanged.
 */
describe('nextPathFrom / withNext — same-origin round trip (fuzz)', () => {
    it('never leaves the origin and keeps every accepted value, over 3000 seeded values', () => {
        const origin = 'https://solkey.io'
        for (const { seed, next } of fuzzedNextValues()) {
            const result = nextPathFrom(`?next=${encodeURIComponent(next)}`)
            const resolved = new URL(result, `${origin}/login`)
            expect(resolved.origin, `seed ${seed}: next=${JSON.stringify(next)} → ${result}`).toBe(origin)
            expect(result.startsWith('/')).toBe(true)
            if (result !== LIBRARY_PATH) expect(nextPathFrom(withNext('/signup', result).replace('/signup', ''))).toBe(result)
        }
    })
})
