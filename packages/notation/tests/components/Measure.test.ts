import { makeScore } from '@mushee/notation/testing'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { INTERACTION_BLUE_BAND } from '../../src/components/constants'
import { Measure } from '../../src/components/Measure'
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

    it('reaches half a unit past each note’s slot, so neighbouring bands overlap', () => {
        const score = makeScore(1)
        const measure = score.measures[0]
        const layout = score.layout.measureLayoutFor(measure)
        const drawn = bands(score, 0, [0, 1, 2, 3])
        drawn.forEach((band, i) => expect(band.width).toBe(layout.getAllottedWidth(measure.notes[i]) + 0.5))
        // Each band ends past where the next note's band begins.
        for (let i = 0; i < 3; i++) {
            const end = layout.getXForElement(measure.notes[i]) + drawn[i].width
            expect(end).toBeGreaterThan(layout.getXForElement(measure.notes[i + 1]))
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

    it('draws no band without a selection', () => {
        const score = makeScore(1)
        const measure = score.measures[0]
        const tree = renderMeasure({ measure, layout: score.layout.measureLayoutFor(measure) })
        expect(elements(tree).filter((el) => (el.props as BandProps)['data-selection-band'])).toHaveLength(0)
    })
})
