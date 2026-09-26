import { describe, expect, it } from 'vitest'

import type { MxmlMeasureEntry } from '../../src/recordings/pipeline/mxml.types'
import { MxmlBuilder, type PendingNote } from '../../src/recordings/pipeline/mxml-builder'

/**
 * These cover DURATION SPELLING — which written note values a span becomes, and
 * where it is tied.
 *
 * It is worth testing precisely because it is the part of the pipeline a musician
 * judges directly, and because the rule is easy to get subtly wrong: the previous
 * implementation picked the largest value that fit, ignoring metrical position, so
 * three beats starting on beat 2 of 4/4 came out as a dotted half straddling the
 * middle of the bar. Conventional engraving splits at the strongest boundary the
 * span crosses, and ties across it, so the bar's beat structure stays readable.
 */

function builder(beats = 4, beatType = 4): MxmlBuilder {
    return new MxmlBuilder({ bpm: 120, beats, beatType })
}

/** `type` plus dots, e.g. `half.` — the spelling, which is what these assert. */
function spell(b: MxmlBuilder, startBeat: number, beats: number): string {
    const spans = (
        b as unknown as {
            spellDuration(s: number, d: number): Array<{ type: string; dots: number }>
        }
    ).spellDuration(startBeat, beats)
    return spans.map((d) => `${d.type}${'.'.repeat(d.dots)}`).join(' + ')
}

function notesOf(entries: MxmlMeasureEntry[]): Array<Record<string, unknown>> {
    return entries.filter((e): e is MxmlMeasureEntry & Record<string, unknown> => e._type === 'note') as Array<Record<string, unknown>>
}

describe('MxmlBuilder duration spelling', () => {
    it('writes a span as one symbol when the bar position allows it', () => {
        const b = builder()
        expect(spell(b, 0, 4)).toBe('whole')
        expect(spell(b, 0, 3)).toBe('half.')
        expect(spell(b, 0, 2)).toBe('half')
        expect(spell(b, 0, 1.5)).toBe('quarter.')
        expect(spell(b, 0, 1)).toBe('quarter')
        // A half starting on beat 3 is legal: beat 3 is itself a half-note boundary.
        expect(spell(b, 2, 2)).toBe('half')
    })

    it('splits at the strongest boundary a span crosses, rather than hiding it', () => {
        const b = builder()
        // Three beats from beat 2 must NOT become a dotted half across the mid-bar line.
        expect(spell(b, 1, 3)).toBe('quarter + half')
        // Two beats from beat 2 must not hide the middle of the bar either.
        expect(spell(b, 1, 2)).toBe('quarter + quarter')
        // A dotted quarter from an off-beat is spelled as a tie across the next beat.
        expect(spell(b, 0.5, 1.5)).toBe('eighth + quarter')
    })

    it('keeps an off-beat span that crosses nothing as a single value', () => {
        const b = builder()
        expect(spell(b, 1.5, 0.5)).toBe('eighth')
        expect(spell(b, 3, 1)).toBe('quarter')
    })

    it('ties the split pieces together, opening and closing exactly once', () => {
        const b = builder()
        const notes: PendingNote[] = [
            // Three beats of C4 from beat 2 — the case that must tie.
            { startTimeSeconds: 0.5, durationSeconds: 1.5, pitchMidi: 60 },
        ]
        const measure = b.buildMeasure(0, notes)
        const sounded = notesOf(measure.entries).filter((n) => !n.rest)
        expect(sounded).toHaveLength(2)
        expect(sounded[0].tie).toEqual([{ type: 'start' }])
        expect(sounded[1].tie).toEqual([{ type: 'stop' }])
    })

    it('fills a measure exactly, whatever the spelling', () => {
        const b = builder()
        // A note from beat 2 to beat 3, so the bar needs a leading and a trailing rest.
        const measure = b.buildMeasure(0, [{ startTimeSeconds: 0.5, durationSeconds: 0.5, pitchMidi: 67 }])
        const total = notesOf(measure.entries).reduce((sum, n) => sum + (n.duration as number), 0)
        // 4 quarters at 12 divisions each.
        expect(total).toBe(48)
    })

    it('reports every measure a held note sounds through, not just its first', () => {
        // Regression: the pipeline derived its update set from the onset bar alone, so a
        // note longer than a bar was emitted as one bar and the rest of it vanished.
        const b = builder()
        // 10 s at 120 bpm 4/4 = 20 beats = five bars.
        expect(b.measureRangeFor(0, 10)).toEqual([0, 4])
        // Each spanned bar renders the continuation, tied.
        for (const i of [0, 1, 2, 3, 4]) {
            const sounded = notesOf(b.buildMeasure(i, [{ startTimeSeconds: 0, durationSeconds: 10, pitchMidi: 60 }]).entries).filter(
                (n) => !n.rest,
            )
            expect(sounded.length).toBeGreaterThan(0)
        }
    })

    it('does not claim the empty bar after a note that ends exactly on a barline', () => {
        const b = builder()
        // Exactly two bars long, ending on the barline into bar 2.
        expect(b.measureRangeFor(0, 4)).toEqual([0, 1])
    })

    it('renders a bar the performer rested through as a single whole rest', () => {
        // Regression: a fully silent bar has no onset to key off, so it was never
        // emitted and the score had a hole where a bar of rest belonged.
        const b = builder()
        const notes: PendingNote[] = [
            { startTimeSeconds: 0, durationSeconds: 1, pitchMidi: 60 },
            { startTimeSeconds: 4, durationSeconds: 1, pitchMidi: 64 },
        ]
        const silent = notesOf(b.buildMeasure(1, notes).entries)
        expect(silent).toHaveLength(1)
        expect(silent[0].rest).toBeDefined()
        expect(silent[0].type).toBe('whole')
    })

    it('respects a compound metre when choosing boundaries', () => {
        // 6/8: the bar divides 3+3 eighths, so the strong interior boundary is the
        // second group, not the middle of a beat.
        const b = builder(6, 8)
        // A whole bar of 6/8 is six eighths = three quarters = a dotted half.
        expect(spell(b, 0, 3)).toBe('half.')
    })
})

describe('MxmlBuilder bar arithmetic', () => {
    const divisionsOf = (b: MxmlBuilder, index: number, notes: PendingNote[]) =>
        notesOf(b.buildMeasure(index, notes).entries).reduce((sum, n) => sum + (n.duration as number), 0)

    it('measures a 6/8 bar as three quarter-beats, not six (bpm counts quarters)', () => {
        const b = builder(6, 8) // at 120 bpm a quarter is 0.5 s, so a 6/8 bar is 1.5 s
        expect(b.measureIndexFor(1.4)).toBe(0)
        expect(b.measureIndexFor(1.6)).toBe(1)
        expect(b.measureRangeFor(0, 3.1)).toEqual([0, 2])
        // A held note is written across the bars it sounds through, and every bar adds up to 36 divisions (3 quarters × 12).
        const held: PendingNote[] = [{ startTimeSeconds: 0, durationSeconds: 3, pitchMidi: 60 }]
        expect(divisionsOf(b, 0, held)).toBe(36)
        expect(divisionsOf(b, 1, held)).toBe(36)
    })

    it('measures a 2/2 bar as four quarter-beats', () => {
        const b = builder(2, 2)
        expect(b.measureIndexFor(1.9)).toBe(0)
        expect(b.measureIndexFor(2.1)).toBe(1)
        expect(divisionsOf(b, 0, [{ startTimeSeconds: 0, durationSeconds: 0.5, pitchMidi: 60 }])).toBe(48)
    })

    it('snaps onsets and releases to the sixteenth grid so bars never come out a sixteenth short', () => {
        const b = builder(3, 4)
        // Two notes with ragged timing (0.6 s = 1.2 beats): rounding each span alone used to leave a hole.
        const notes: PendingNote[] = [
            { startTimeSeconds: 0, durationSeconds: 1, pitchMidi: 60 },
            { startTimeSeconds: 1.2, durationSeconds: 0.6, pitchMidi: 62 },
        ]
        expect(divisionsOf(b, 0, notes)).toBe(36)
        expect(divisionsOf(b, 1, notes)).toBe(36)
    })

    it('keeps a note shorter than half a sixteenth as one sixteenth rather than losing it', () => {
        const b = builder(4, 4)
        const entries = notesOf(b.buildMeasure(0, [{ startTimeSeconds: 0.5, durationSeconds: 0.02, pitchMidi: 60 }]).entries)
        expect(entries.some((n) => n.pitch && n.type === '16th')).toBe(true)
        expect(entries.reduce((sum, n) => sum + (n.duration as number), 0)).toBe(48)
    })
})
