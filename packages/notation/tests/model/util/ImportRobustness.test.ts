import { BEAT_EPSILON } from '@mushee/notation/model/Duration'
import { MusicXmlExporter } from '@mushee/notation/model/util/MusicXmlExporter'
import { MusicXmlImporter } from '@mushee/notation/model/util/MusicXmlImporter'
import { describe, expect, it } from 'vitest'

import { generateScore, Rng } from './scoreGenerator'

/**
 * Import robustness: a MusicXML file a user uploads may be truncated, hand-edited
 * or exported by a tool with ideas of its own. Whatever we feed the importer,
 * it must either produce a score whose bars fit their meter (never over-full, at
 * most a sub-sixteenth short where a cut tuplet left a residue), or fail with
 * one of its three user-facing messages — never a TypeError, a RangeError or
 * an "undefined is not iterable" from deep inside.
 *
 * Mutations here are applied to our own exporter's output (structurally valid
 * to begin with), so every survivor exercises real parsing paths.
 */

const FRIENDLY_ERRORS = ['The file is not well-formed XML.', 'The file is not a MusicXML score.', 'The score has no measures.']

const GARBAGE_TEXT = ['', '-1', '0', '999999', 'NaN', '1e308', 'abc', '7/8', ' 4 ', '∞', '-0.5', '3+2']

/** One random structural or textual mutation of an XML document. */
function mutate(xml: string, rng: Rng): string {
    const roll = rng.next()
    if (roll < 0.1) return xml.slice(0, Math.floor(xml.length * rng.next())) // truncated download
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    const elements = Array.from(document.getElementsByTagName('*'))
    const pick = () => elements[rng.int(1, elements.length - 1)] // never the root
    if (roll < 0.35) {
        pick().remove() // a dropped element: duration, pitch, type, whole measures…
    } else if (roll < 0.55) {
        const el = pick()
        el.parentElement?.insertBefore(el.cloneNode(true), el) // a duplicated element: two <pitch>, two <attributes>…
    } else if (roll < 0.8) {
        const leaves = elements.filter((el) => el.children.length === 0)
        const leaf = leaves[rng.int(0, leaves.length - 1)]
        leaf.textContent = rng.pick(GARBAGE_TEXT) // a nonsense value where a number or step was
    } else if (roll < 0.9) {
        const el = pick()
        for (const attribute of Array.from(el.attributes)) el.removeAttribute(attribute.name) // lost attributes (tie type, part id…)
    } else {
        const a = pick()
        const b = pick()
        if (a !== b && !a.contains(b) && !b.contains(a)) a.parentElement?.insertBefore(b, a) // reordered siblings/cousins
    }
    return new XMLSerializer().serializeToString(document)
}

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1)

describe('MusicXML importer over mutated documents', () => {
    it.each(SEEDS)('either imports a well-formed score or fails with a friendly message (seed %i)', (seed) => {
        const rng = new Rng(seed)
        let xml = new MusicXmlExporter(generateScore(rng, { tuplets: true, midBarTempos: true })).toXml('Fuzz')
        for (let i = rng.int(1, 4); i > 0; i--) xml = mutate(xml, rng)

        try {
            const { score } = new MusicXmlImporter(xml).toScore()
            expect(score.measures.length).toBeGreaterThan(0)
            for (const measure of score.measures) {
                expect(measure.beats, `bar ${measure.index} over-full: ${measure.beats} of ${measure.maxBeats}`).toBeLessThan(
                    measure.maxBeats + BEAT_EPSILON,
                )
                // A cut tuplet may leave a sub-sixteenth residue rather than a dropped note.
                expect(measure.maxBeats - measure.beats, `bar ${measure.index} holds ${measure.beats} of ${measure.maxBeats}`).toBeLessThan(
                    1 / 6,
                )
            }
            // And whatever came out can be saved and reloaded.
            expect(() => new MusicXmlExporter(score).toXml('Fuzz')).not.toThrow()
        } catch (err) {
            if (err instanceof Error && FRIENDLY_ERRORS.includes(err.message)) return
            throw err
        }
    })
})
