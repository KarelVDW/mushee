import { makeScore } from '@mushee/notation/testing'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { INTERACTION_BLUE_BAND } from '../../src/components/constants'
import { Measure } from '../../src/components/Measure'
import { NoteGroup } from '../../src/components/NoteGroup'
import type { Score } from '../../src/model'

interface BandProps {
    'data-selection-band'?: boolean
    'data-export-exclude'?: boolean
    width: number
    rx: number
    fill: string
}

/** Measure is memo()ed and hook-free: render its inner function directly. */
const renderMeasure = (Measure as unknown as { type: (props: Parameters<typeof Measure>[0]) => ReactNode }).type

/** Every element under `node` (the renderer's own subcomponents are not expanded). */
function elements(node: ReactNode): ReactElement[] {
    if (Array.isArray(node)) return node.flatMap(elements)
    if (!isValidElement(node)) return []
    return [node, ...elements((node.props as { children?: ReactNode }).children)]
}

/** The selection bands measure `index` of `score` draws, with `selected` (note indices there) selected. */
function bands(score: Score, index: number, selected: number[]): BandProps[] {
    const measure = score.measures[index]
    const selectedNoteIds = new Set(selected.map((i) => measure.notes[i].id))
    const tree = renderMeasure({ measure, layout: score.layout.measureLayoutFor(measure), selectedNoteIds })
    return elements(tree)
        .map((el) => el.props as BandProps)
        .filter((props) => props['data-selection-band'])
}

describe('Measure selection bands', () => {
    it('draws one band per selected note, export-excluded, in the band blue', () => {
        const score = makeScore(1)
        const drawn = bands(score, 0, [0, 1, 2])
        expect(drawn).toHaveLength(3)
        for (const band of drawn) {
            expect(band['data-export-exclude']).toBe(true)
            expect(band.fill).toBe(INTERACTION_BLUE_BAND)
        }
    })

    it('spans each note’s slot, so neighbouring bands meet edge to edge, never overlapping', () => {
        const score = makeScore(1)
        const measure = score.measures[0]
        const layout = score.layout.measureLayoutFor(measure)
        const drawn = bands(score, 0, [0, 1, 2, 3])
        drawn.forEach((band, i) => expect(band.width).toBe(layout.getAllottedWidth(measure.notes[i])))
        // Each band ends exactly where the next note's band begins: the translucent fill would
        // paint a darker hairline wherever two overlapped.
        for (let i = 0; i < 3; i++) {
            const end = layout.getXForElement(measure.notes[i]) + drawn[i].width
            expect(end).toBe(layout.getXForElement(measure.notes[i + 1]))
        }
    })

    it('squares every band of a run, ends included, and rounds only a lone selected note', () => {
        const score = makeScore(1)
        expect(bands(score, 0, [1, 2, 3]).map((band) => band.rx)).toEqual([0, 0, 0])
        expect(bands(score, 0, [0, 2]).map((band) => band.rx)).toEqual([3, 3])
        expect(bands(score, 0, [2]).map((band) => band.rx)).toEqual([3])
    })

    it('judges neighbours within the measure: a run’s note at a barline is lone on its own side', () => {
        const score = makeScore(2)
        // The last note of bar 1 with nothing else selected in it stays round, even when the
        // run carries on into bar 2 (the barline draws over the meeting).
        expect(bands(score, 0, [3]).map((band) => band.rx)).toEqual([3])
        expect(bands(score, 1, [0, 1]).map((band) => band.rx)).toEqual([0, 0])
    })

    it('takes a run that carries on into the next bar through the barline, and stops a run that ends there', () => {
        const score = makeScore(2)
        const [first, second] = score.measures
        const layout = score.layout.measureLayoutFor(first)
        const last = first.notes[3]
        const bandsOf = (selected: string[]) =>
            elements(renderMeasure({ measure: first, layout, selectedNoteIds: new Set(selected) }))
                .map((el) => el.props as BandProps)
                .filter((props) => props['data-selection-band'])
        // Into bar 2: on through the barline (which stands between the last slot and the bar's
        // end, and draws over the band), to where bar 2's first band begins.
        const [across] = bandsOf([last.id, second.notes[0].id])
        expect(layout.getXForElement(last) + layout.getAllottedWidth(last)).toBeLessThan(layout.measureWidth)
        expect(layout.getXForElement(last) + across.width).toBe(layout.measureWidth)
        expect(score.layout.rows[0].getMeasureX(first) + layout.measureWidth).toBe(
            score.layout.rows[0].getMeasureX(second) + score.layout.measureLayoutFor(second).getXForElement(second.notes[0]),
        )
        // Ending at the barline: each band its own slot only.
        expect(bandsOf([first.notes[2].id, last.id]).map((band) => band.width)).toEqual([
            layout.getAllottedWidth(first.notes[2]),
            layout.getAllottedWidth(last),
        ])
        // The score's last note has no next bar to run on into.
        const lastLayout = score.layout.measureLayoutFor(second)
        const final = second.notes[3]
        const [end] = elements(renderMeasure({ measure: second, layout: lastLayout, selectedNoteIds: new Set([final.id]) }))
            .map((el) => el.props as BandProps)
            .filter((props) => props['data-selection-band'])
        expect(end.width).toBe(lastLayout.getAllottedWidth(final))
    })

    it('draws no band without a selection', () => {
        const score = makeScore(1)
        const measure = score.measures[0]
        const tree = renderMeasure({ measure, layout: score.layout.measureLayoutFor(measure) })
        expect(elements(tree).filter((el) => (el.props as BandProps)['data-selection-band'])).toHaveLength(0)
    })
})

describe('Measure landing notes', () => {
    /** The `landing` prop of each NoteGroup measure 0 draws. */
    function landingFlags(score: Score, landingNoteIds?: ReadonlySet<string>): Array<boolean | undefined> {
        const measure = score.measures[0]
        const tree = renderMeasure({ measure, layout: score.layout.measureLayoutFor(measure), landingNoteIds })
        return elements(tree)
            .filter((el) => el.type === NoteGroup)
            .map((el) => (el.props as { landing?: boolean }).landing)
    }

    it('fades in only the notes a take just wrote', () => {
        const score = makeScore(1)
        const [, second] = score.measures[0].notes
        expect(landingFlags(score, new Set([second.id]))).toEqual([false, true, false, false])
    })

    it('fades in nothing without landing notes', () => {
        expect(landingFlags(makeScore(1))).toEqual([undefined, undefined, undefined, undefined])
    })
})
