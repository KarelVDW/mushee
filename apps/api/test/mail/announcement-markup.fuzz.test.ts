import { describe, expect, it } from 'vitest'

import { MailService } from '../../src/mail/mail.service'

/**
 * The announcement body is written by an operator but rendered into an e-mail
 * that goes to every account, so the markup pass must never let HTML through:
 * the only tags allowed out are <strong> and <a href="http(s)://…">, whatever
 * the input contains. Seeded random paragraphs mix the markup syntax with
 * hostile fragments and assert that invariant.
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

const FRAGMENTS = [
    'plain words',
    '**bold**',
    '**',
    '*',
    '[label](https://solkey.io/pricing)',
    '[label](http://example.com/a?b=1&c=2)',
    '[x](javascript:alert(1))',
    '[x](data:text/html,hi)',
    '[x](https://evil.example/" onmouseover="alert(1))',
    '[x](https://ok.example/"><script>alert(1)</script>)',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"quoted" & \'single\'',
    '</a>',
    '<strong>',
    '[',
    ']',
    '(',
    ')',
    '{{name}}',
    '\n',
    'é ü 🎵',
    '<a href="https://spoof.example">not a link</a>',
]

const SANCTIONED = /<strong>|<\/strong>|<a href="https?:\/\/[^"\s<>]+">|<\/a>/g

function randomParagraph(rng: () => number): string {
    const n = 1 + Math.floor(rng() * 8)
    return Array.from({ length: n }, () => FRAGMENTS[Math.floor(rng() * FRAGMENTS.length)]).join(rng() < 0.5 ? ' ' : '')
}

describe('announcement markup — escaping invariants (fuzz)', () => {
    it('never emits any tag other than <strong> and http(s) <a>, over 2000 seeded paragraphs', () => {
        for (let seed = 1; seed <= 2000; seed++) {
            const input = randomParagraph(mulberry32(seed))
            const html = MailService.markupToHtml(input)
            const leftover = html.replace(SANCTIONED, '')
            expect(leftover, `seed ${seed}: ${input}`).not.toMatch(/[<>]/)
            for (const href of html.matchAll(/href="([^"]*)"/g)) {
                expect(href[1], `seed ${seed}: ${input}`).toMatch(/^https?:\/\//)
                expect(href[1]).not.toMatch(/["'<>]/)
            }
        }
    })

    it('renders a whole hostile body without a single unescaped tag outside the layout', () => {
        const rng = mulberry32(42)
        const body = Array.from({ length: 12 }, () => randomParagraph(rng)).join('\n\n')
        const rendered = MailService.renderAnnouncement('Subject <b>x</b> {{name}}', body)
        // Everything between the layout's opening and closing of the message area
        // must be either sanctioned tags or escaped text.
        for (const para of rendered.html.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
            const leftover = para[1].replace(SANCTIONED, '').replace(/<br\/>/g, '')
            expect(leftover).not.toMatch(/[<>]/)
        }
        expect(rendered.subject).toBe('Subject <b>x</b> -firstName-')
        expect(rendered.html).not.toContain('<b>x</b>')
    })

    it('firstName is never empty and never carries HTML-significant characters, over 2000 seeded names', () => {
        const PIECES = ['Ada', ' ', '  ', '<b>', '>', '&', '"', "'", 'Lovelace', '\t', '\n', '🎵', 'Ünïcödé', '']
        for (let seed = 1; seed <= 2000; seed++) {
            const rng = mulberry32(seed)
            const name = Array.from({ length: Math.floor(rng() * 6) }, () => PIECES[Math.floor(rng() * PIECES.length)]).join('')
            const first = MailService.firstName(name)
            expect(first.length, `seed ${seed}: ${JSON.stringify(name)}`).toBeGreaterThan(0)
            expect(first).not.toMatch(/[<>&"'\s]/)
        }
    })
})
