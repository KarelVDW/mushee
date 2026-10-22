/**
 * A seeded corpus of attacker-shaped `?next=` values, for tests of the open-redirect guard
 * (`safeNextPath`) and of the apps' wrappers around it — shared so every layer is fuzzed over
 * the same inputs. Test-only: no app code imports it.
 */

/** Fragments that combine into the tricky shapes: protocol-relative, backslash, scheme, encoded slashes. */
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

/** mulberry32: a tiny deterministic PRNG, so a failing seed reproduces exactly. */
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

/** `count` values (seeds 1…count), each one to five {@link PIECES} long. */
export function fuzzedNextValues(count = 3000): { seed: number; next: string }[] {
    return Array.from({ length: count }, (_, i) => {
        const seed = i + 1
        const rng = mulberry32(seed)
        const next = Array.from({ length: 1 + Math.floor(rng() * 5) }, () => PIECES[Math.floor(rng() * PIECES.length)]).join('')
        return { seed, next }
    })
}
