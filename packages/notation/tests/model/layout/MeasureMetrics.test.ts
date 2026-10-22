import { MAX_MEASURES_PER_ROW, SCORE_WIDTH } from '@mushee/notation/engraving/constants'
import { Duration } from '@mushee/notation/model/Duration'
import { BarlineLayout } from '@mushee/notation/model/layout/BarlineLayout'
import { MeasureMetrics } from '@mushee/notation/model/layout/MeasureMetrics'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { makeScore, rest } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

const NONE = { showsClef: false, showsKeySignature: false, showsTimeSignature: false }

describe('MeasureMetrics', () => {
    it('measures every note, carrying the accidental it draws in measure context', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const fSharp = () => new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'F', octave: 4, alter: 1 }) })
        score.replace(m.notes, [fSharp(), fSharp()])
        const metrics = new MeasureMetrics(m, undefined)
        expect(metrics.accidentals.get(m.notes[0])).toBe('accidentalSharp')
        expect(metrics.accidentals.get(m.notes[1])).toBeUndefined() // carried through the bar
        expect(metrics.noteWidthOf(m.notes[0]).accidentalGlyph).toBe('accidentalSharp')
        expect(metrics.noteWidthOf(m.notes[0]).total).toBeGreaterThan(metrics.noteWidthOf(m.notes[1]).total)
    })

    it('fixed width sums the notes and the end barline when nothing else is present', () => {
        const m = makeScore(1).measures[0]
        const metrics = new MeasureMetrics(m, undefined)
        const notes = m.notes.reduce((sum, note) => sum + metrics.noteWidthOf(note).total, 0)
        expect(metrics.fixedWidth).toBeCloseTo(notes + BarlineLayout.widthOf(m.endBarline))
    })

    it('the leading key carries its drawn accidentals, cancellation naturals included', () => {
        const score = makeScore(2)
        score.setKeySignature(score.measures[0].firstNote, 1) // G major
        score.setKeySignature(score.measures[1].firstNote, 0) // back to C: one natural
        const [m0, m1] = score.measures
        const metrics = new MeasureMetrics(m1, m0)
        expect(metrics.leadingKeyAccidentals.map((a) => a.glyphName)).toEqual(['accidentalNatural'])
        expect(metrics.keyWidthOf(m1.keySignature).drawnAccidentals).toBe(metrics.leadingKeyAccidentals)
    })

    describe('base flags (diff against the previous measure)', () => {
        it('the first measure shows everything', () => {
            const m = makeScore(1).measures[0]
            expect(new MeasureMetrics(m, undefined).baseFlags).toEqual({
                showsClef: true,
                showsKeySignature: true,
                showsTimeSignature: true,
            })
        })

        it('an unchanged measure shows nothing; a changed clef, key or meter shows', () => {
            const score = makeScore(2)
            const [m0, m1] = score.measures
            expect(new MeasureMetrics(m1, m0).baseFlags).toEqual(NONE)
            score.setTimeSignature(m1, new TimeSignature(3, 4))
            const changed = score.measures[1] // the rebar replaces m1
            score.setClef(changed.firstNote, 'bass')
            score.setKeySignature(changed.firstNote, 2)
            expect(new MeasureMetrics(changed, m0).baseFlags).toEqual({
                showsClef: true,
                showsKeySignature: true,
                showsTimeSignature: true,
            })
        })
    })

    describe('minimalWidth', () => {
        it('adds each flagged leading attribute to the fixed width', () => {
            const score = makeScore(1)
            score.setKeySignature(score.measures[0].firstNote, 2)
            const m = score.measures[0]
            const metrics = new MeasureMetrics(m, undefined)
            expect(metrics.minimalWidth(NONE, 0)).toBe(metrics.fixedWidth)
            expect(metrics.minimalWidth({ showsClef: true, showsKeySignature: true, showsTimeSignature: true }, 0)).toBeCloseTo(
                metrics.fixedWidth +
                    m.clef.layout.width.total +
                    metrics.keyWidthOf(m.keySignature).total +
                    m.timeSignature.layout.width.total,
            )
        })

        it('never returns less than the floor', () => {
            const metrics = new MeasureMetrics(makeScore(1).measures[0], undefined)
            const floor = MeasureMetrics.floorFor(SCORE_WIDTH)
            expect(floor).toBe(SCORE_WIDTH / (MAX_MEASURES_PER_ROW + 1))
            expect(metrics.minimalWidth(NONE, 10_000)).toBe(10_000)
        })
    })

    it('throws for a note or key it did not measure', () => {
        const score = makeScore(2)
        const metrics = new MeasureMetrics(score.measures[0], undefined)
        expect(() => metrics.noteWidthOf(rest('q'))).toThrow('Note width missing from measure metrics')
        expect(() => metrics.keyWidthOf(score.measures[1].keySignature)).toThrow('Key signature width missing from measure metrics')
    })
})
