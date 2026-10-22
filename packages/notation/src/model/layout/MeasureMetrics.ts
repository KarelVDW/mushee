import { sumBy } from 'lodash-es'

import { MAX_MEASURES_PER_ROW } from '../../engraving/constants'
import type { KeyAccidental, KeySignature } from '../KeySignature'
import type { Measure } from '../Measure'
import type { Note } from '../Note'
import { BarlineLayout } from './BarlineLayout'
import { DisplayedAccidentals } from './DisplayedAccidentals'
import { KeySignatureLayout } from './KeySignatureLayout'
import { KeySignatureWidth } from './KeySignatureWidth'
import { NoteWidth } from './NoteWidth'

/** Which leading attributes a measure draws. */
export interface MeasureFlags {
    readonly showsClef: boolean
    readonly showsKeySignature: boolean
    readonly showsTimeSignature: boolean
}

/**
 * One measure's layout inputs, derived once per ScoreLayout rebuild from the
 * semantic model: what each note and key signature draws and how wide it is,
 * and which attributes the measure shows on its own account. Row packing reads
 * its minimal widths; MeasureLayout reads the rest.
 */
export class MeasureMetrics {
    /** The accidental glyph each note draws, resolved in measure context. */
    readonly accidentals: Map<Note, string | undefined>
    /** Width per note, carrying its drawn accidental. */
    readonly noteWidths: Map<Note, NoteWidth>
    /** Contextual width per key signature (leading + mid-measure), each carrying its drawn accidentals. */
    readonly keyWidths: Map<KeySignature, KeySignatureWidth>
    /** The leading key's drawn accidentals (cancellation naturals included) — the one input that depends on the previous measure. */
    readonly leadingKeyAccidentals: KeyAccidental[]
    /** Width of elements present regardless of flags: mid-measure changes, notes, barline. */
    readonly fixedWidth: number
    /** Diff-based flags (vs the previous measure); row starts are forced on top during packing. */
    readonly baseFlags: MeasureFlags

    constructor(
        readonly measure: Measure,
        previous: Measure | undefined,
    ) {
        this.accidentals = new DisplayedAccidentals(measure).byNote
        this.noteWidths = new Map(measure.notes.map((note) => [note, new NoteWidth(note, this.accidentals.get(note))]))
        this.leadingKeyAccidentals = KeySignatureLayout.drawnAccidentalsFor(measure.keySignature)
        const midKeyWidths = measure.midMeasureKeySignatures.map(
            (key) => [key, new KeySignatureWidth(KeySignatureLayout.drawnAccidentalsFor(key))] as const,
        )
        this.keyWidths = new Map([[measure.keySignature, new KeySignatureWidth(this.leadingKeyAccidentals)], ...midKeyWidths])
        this.fixedWidth =
            sumBy(measure.midMeasureClefs, (clef) => clef.layout.width.total) +
            sumBy(midKeyWidths, ([, width]) => width.total) +
            sumBy([...this.noteWidths.values()], (width) => width.total) +
            BarlineLayout.widthOf(measure.endBarline)
        this.baseFlags = {
            showsClef: !previous || previous.lastClef.type !== measure.clef.type,
            showsKeySignature: !previous || previous.lastKey.fifths !== measure.keySignature.fifths,
            showsTimeSignature: !previous?.timeSignature.equals(measure.timeSignature),
        }
    }

    /** A measure narrower than this is padded up — prevents unusably cramped bars. */
    static floorFor(scoreWidth: number): number {
        return scoreWidth / (MAX_MEASURES_PER_ROW + 1)
    }

    /** The narrowest this measure can be drawn with `flags`' leading attributes, but never under `floor`. */
    minimalWidth(flags: MeasureFlags, floor: number): number {
        const sum =
            (flags.showsClef ? this.measure.clef.layout.width.total : 0) +
            (flags.showsKeySignature ? this.keyWidthOf(this.measure.keySignature).total : 0) +
            (flags.showsTimeSignature ? this.measure.timeSignature.layout.width.total : 0) +
            this.fixedWidth
        return Math.max(sum, floor)
    }

    noteWidthOf(note: Note): NoteWidth {
        const width = this.noteWidths.get(note)
        if (!width) throw new Error('Note width missing from measure metrics')
        return width
    }

    keyWidthOf(key: KeySignature): KeySignatureWidth {
        const width = this.keyWidths.get(key)
        if (!width) throw new Error('Key signature width missing from measure metrics')
        return width
    }
}
