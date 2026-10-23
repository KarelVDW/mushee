import { fill, makeScore, pitched } from '@mushee/notation/testing'
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

/** The selection bands measure `index` of `score` draws, with the notes `selectedNoteIds` names selected (anywhere in the score). */
function bandsWith(score: Score, index: number, selectedNoteIds: ReadonlySet<string>): BandProps[] {
    const measure = score.measures[index]
    const tree = renderMeasure({ measure, layout: score.layout.measureLayoutFor(measure), selectedNoteIds })
    return elements(tree)
        .map((el) => el.props as BandProps)
        .filter((props) => props['data-selection-band'])
}

/** The selection bands measure `index` of `score` draws, with `selected` (note indices there) selected. */
function bands(score: Score, index: number, selected: number[]): BandProps[] {
    const measure = score.measures[index]
    return bandsWith(score, index, new Set(selected.map((i) => measure.notes[i].id)))
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

    it('judges neighbours in score order, so a run over a barline meets square there', () => {
        const score = makeScore(2)
        const [first, second] = score.measures
        // The last note of bar 1 and the first of bar 2: one run, a lone note on either side of
        // the barline — both bands square, or their rounded corners would nick the strip above
        // and below the staff, where the barline doesn't reach.
        const junction = new Set([first.notes[3].id, second.notes[0].id])
        expect(bandsWith(score, 0, junction).map((band) => band.rx)).toEqual([0])
        expect(bandsWith(score, 1, junction).map((band) => band.rx)).toEqual([0])
        // Without its neighbour across the barline, each is lone again.
        expect(bands(score, 0, [3]).map((band) => band.rx)).toEqual([3])
        expect(bands(score, 1, [0]).map((band) => band.rx)).toEqual([3])
    })

    it('squares every band of a select-all over one-note bars, each band running on to the next bar', () => {
        const score = makeScore(3)
        const wholes = [0, 1, 2].map((i) => fill(score, i, [pitched('G', 4, 'w')]).notes[0])
        const all = new Set(wholes.map((note) => note.id))
        const drawn = [0, 1, 2].map((i) => bandsWith(score, i, all))
        expect(drawn.map((measureBands) => measureBands.map((band) => band.rx))).toEqual([[0], [0], [0]])
        // On through each barline to the bar's end; the score's last note keeps its own slot.
        drawn.forEach(([band], i) => {
            const layout = score.layout.measureLayoutFor(score.measures[i])
            const note = wholes[i]
            const end = i < 2 ? layout.measureWidth - layout.getXForElement(note) : layout.getAllottedWidth(note)
            expect(band.width).toBe(end)
        })
        // The middle bar alone is a lone note.
        expect(bandsWith(score, 1, new Set([wholes[1].id])).map((band) => band.rx)).toEqual([3])
    })

    it('takes a run that carries on into the next bar through the barline, and stops a run that ends there', () => {
        const score = makeScore(2)
        const [first, second] = score.measures
        const layout = score.layout.measureLayoutFor(first)
        const last = first.notes[3]
        const bandsOf = (selected: string[]) => bandsWith(score, 0, new Set(selected))
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
        const [end] = bandsWith(score, 1, new Set([final.id]))
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
