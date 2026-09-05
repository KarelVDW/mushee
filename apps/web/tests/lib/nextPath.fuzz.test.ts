import { describe, expect, it } from 'vitest'

import { nextPathFrom, withNext } from '@/lib/nextPath'

/**
 * `?next=` is attacker-controlled (it arrives in a link). Whatever it holds,
 * the path we redirect to must resolve on our own origin — checked with the
 * platform URL parser, which is what the browser will do with it (including
 * its backslash-as-slash normalisation).
 */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const PIECES = [
    '/',
    '//',
    '\\',
    '/\\',
    'evil.example',
    'https:',
    'http:',
    'javascript:',
    '@',
    ':',
    '..',
    'scores',
    's/abc',
    '?x=1',
    '#f',
    '%2F',
    '%5C',
    ' ',
    'ftp:',
]

describe('nextPathFrom — same-origin invariant (fuzz)', () => {
    it('never yields a path that resolves off-origin, over 3000 seeded values', () => {
        const origin = 'https://solkey.io'
        for (let seed = 1; seed <= 3000; seed++) {
            const rng = mulberry32(seed)
            const next = Array.from({ length: 1 + Math.floor(rng() * 5) }, () => PIECES[Math.floor(rng() * PIECES.length)]).join('')
            const result = nextPathFrom(`?next=${encodeURIComponent(next)}`)
            const resolved = new URL(result, `${origin}/login`)
            expect(resolved.origin, `seed ${seed}: next=${JSON.stringify(next)} → ${result}`).toBe(origin)
            expect(result.startsWith('/')).toBe(true)
            // and the round trip through withNext keeps the accepted value
            if (result !== '/scores') expect(nextPathFrom(withNext('/signup', result).replace('/signup', ''))).toBe(result)
        }
    })
})
