import { BEAM_LEVEL_STRIDE, BEAM_MAX_SLOPE, BEAM_WIDTH, PARTIAL_BEAM_LENGTH } from '@/components/notation/constants';

import type { Beam } from '../Beam';

interface LayoutBeamSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
}

export class BeamLayout {
    readonly id = crypto.randomUUID()
    constructor(private beam: Beam) {}

    get firstStemX() {
        const x = this.beam.firstNote.layout.stemX
        if (x === undefined) throw new Error('Beam note has no stem')
        return x
    }

    get lastStemX() {
        const x = this.beam.lastNote.layout.stemX
        if (x === undefined) throw new Error('Beam note has no stem')
        return x
    }

    /** Uses defaultStemTipY (no beam adjustment) to avoid circular dependency */
    private get firstDefaultTipY(): number {
        const y = this.beam.firstNote.layout.defaultStemTipY
        if (y === undefined) throw new Error('Beam note has no stem')
        return y
    }

    private get lastDefaultTipY(): number {
        const y = this.beam.lastNote.layout.defaultStemTipY
        if (y === undefined) throw new Error('Beam note has no stem')
        return y
    }

    get slope() {
        const dx = this.lastStemX - this.firstStemX
        let slope = 0
        if (dx !== 0) {
            const rawSlope = (this.lastDefaultTipY - this.firstDefaultTipY) / dx
            // Ideal slope is half of raw (engraving convention), clamped
            slope = Math.max(-BEAM_MAX_SLOPE, Math.min(BEAM_MAX_SLOPE, rawSlope / 2))
        }
        return slope
    }

    get beamFirstY() {
        const slope = this.slope
        // Start from first stem's default tip, then adjust so no stems poke through
        let beamFirstY = this.firstDefaultTipY
        for (const n of this.beam.notes) {
            const stemX = n.layout.stemX
            const stemTipY = n.layout.defaultStemTipY
            if (stemX === undefined || stemTipY === undefined) continue
            const beamYAtNote = beamFirstY + (stemX - this.firstStemX) * slope

            if (this.beam.stemDir === 'up' && beamYAtNote > stemTipY) {
                beamFirstY -= beamYAtNote - stemTipY
            } else if (this.beam.stemDir === 'down' && beamYAtNote < stemTipY) {
                beamFirstY += stemTipY - beamYAtNote
            }
        }
        return beamFirstY
    }

    get primary(): LayoutBeamSegment {
        const dirSign = this.beam.stemDir === 'up' ? 1 : -1
        const y1 = this.beamFirstY
        const y2 = y1 + (this.lastStemX - this.firstStemX) * this.slope
        return { x1: this.firstStemX, y1, x2: this.lastStemX, y2, thickness: BEAM_WIDTH * dirSign }
    }

    get secondaries(): LayoutBeamSegment[] {
        const dirSign = this.beam.stemDir === 'up' ? 1 : -1
        const slope = this.slope
        const segments: LayoutBeamSegment[] = []
        const thickness = BEAM_WIDTH * dirSign

        const beamY = this.beamFirstY - BEAM_LEVEL_STRIDE * -dirSign
        let segStart: number | null = null
        let segStartY: number | null = null
        for (let i = 0; i < this.beam.notes.length; i++) {
            const n = this.beam.notes[i]
            if (!n.duration.hasSecondaryBeam) continue

            const stemX = n.layout.stemX
            if (stemX === undefined) continue
            const yAtNote = beamY + (stemX - this.firstStemX) * slope

            if (segStart === null) segStart = stemX
            if (segStartY === null) segStartY = yAtNote

            // Check if next note also qualifies — if not, close segment
            const nextQualifies = i + 1 < this.beam.notes.length && this.beam.notes[i + 1].duration.hasSecondaryBeam
            if (!nextQualifies) {
                if (segStart === stemX) {
                    // Single note with secondary beam — draw partial beam
                    const partialDir = i === 0 ? 1 : -1 // first note: right, otherwise: left
                    const px1 = stemX
                    const px2 = stemX + partialDir * PARTIAL_BEAM_LENGTH
                    const py1 = yAtNote
                    const py2 = yAtNote + partialDir * PARTIAL_BEAM_LENGTH * slope
                    segments.push({ x1: px1, y1: py1, x2: px2, y2: py2, thickness })
                } else {
                    segments.push({ x1: segStart, y1: segStartY, x2: stemX, y2: yAtNote, thickness })
                }
                segStart = null
                segStartY = null
            }
        }

        return segments
    }
}
