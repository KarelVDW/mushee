import { SCORE_WIDTH } from '@mushee/notation/components/constants'
import type { Score } from '@mushee/notation/model/Score'
import { describe, expect, it } from 'vitest'

import { generateScore, Rng } from '../util/scoreGenerator'

/**
 * Layout robustness: for any valid score, at every layout width the editor uses
 * (phone floor, tablet, print), the layout engine must complete and every
 * coordinate the renderer reads must be a finite number — no NaN from a divide
 * by an empty group, no Infinity from an unmatched tie, no throw from a clef
 * or key combination nobody drew by hand. Rows must also pack sanely: measures
 * in reading order, never wider than the row.
 */

/** Model references reachable from layout objects — recursing into them would walk the whole score. */
const MODEL_REFS = new Set(['measure', 'note', 'nextNote', 'notes', 'score', 'element', 'measures', 'tuplet', 'key', 'clef'])

function walk(value: unknown, path: string, seen: Set<object>, problems: string[]) {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) problems.push(`${path} = ${value}`)
        return
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (value instanceof Map) {
        for (const [key, entry] of value) walk(entry, `${path}[${String(typeof key === 'object' ? 'obj' : key)}]`, seen, problems)
        return
    }
    if (Array.isArray(value)) {
        value.forEach((entry, i) => walk(entry, `${path}[${i}]`, seen, problems))
        return
    }
    for (const [key, entry] of Object.entries(value)) {
        if (MODEL_REFS.has(key) || key.startsWith('_')) continue
        walk(entry, `${path}.${key}`, seen, problems)
    }
}

function checkLayout(score: Score, width: number): string[] {
    const problems: string[] = []
    score.setLayoutWidth(width)
    const layout = score.layout
    const seen = new Set<object>()
    walk(layout.rows, 'rows', seen, problems)
    walk(layout.ties, 'ties', seen, problems)
    if (!(layout.totalHeight > 0)) problems.push(`totalHeight = ${layout.totalHeight}`)

    for (const measure of score.measures) {
        const ml = layout.measureLayoutFor(measure)
        walk(ml, `measure[${measure.index}]`, seen, problems)
        if (ml.measureX < -1e-6 || ml.measureX + ml.measureWidth > layout.scoreWidth + 1e-6) {
            problems.push(
                `measure[${measure.index}] spans ${ml.measureX}..${ml.measureX + ml.measureWidth} outside row width ${layout.scoreWidth}`,
            )
        }
        for (const note of measure.notes) walk(ml.noteLayoutFor(note), `measure[${measure.index}].note`, seen, problems)
        for (const key of [measure.keySignature, ...measure.midMeasureKeySignatures])
            walk(ml.keyLayoutFor(key), `measure[${measure.index}].key`, seen, problems)
        for (const tuplet of measure.tuplets) walk(ml.tupletLayoutFor(tuplet), `measure[${measure.index}].tuplet`, seen, problems)
        walk(measure.clef.layout, `measure[${measure.index}].clef`, seen, problems)
        for (const tempo of measure.tempos) walk(tempo.layout, `measure[${measure.index}].tempo`, seen, problems)
    }
    // Reading order within each row: x strictly increases measure by measure.
    for (const row of layout.rows) {
        let lastX = -Infinity
        for (const measure of row.measures) {
            const x = layout.measureLayoutFor(measure).measureX
            if (!(x > lastX)) problems.push(`row ${row.index}: measure[${measure.index}] x=${x} does not follow ${lastX}`)
            lastX = x
        }
        if (row.width > layout.scoreWidth + 1e-6) problems.push(`row ${row.index} width ${row.width} > ${layout.scoreWidth}`)
    }
    return problems
}

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1)
const WIDTHS = [340, 600, SCORE_WIDTH]

describe('layout engine over generated scores', () => {
    it.each(SEEDS)('lays out seed %i at every width with finite geometry', (seed) => {
        const score = generateScore(new Rng(seed), { tuplets: true, midBarTempos: true })
        for (const width of WIDTHS) {
            expect(checkLayout(score, width), `width ${width}`).toEqual([])
        }
    })
})
