import { BEAM_LEVEL_STRIDE, BEAM_MAX_SLOPE, BEAM_WIDTH, PARTIAL_BEAM_LENGTH } from '@/components/notation/constants'

import type { Beam } from '../Beam'
import { Note } from '../Note'

interface LayoutBeamSegment {
    x1: number
    y1: number
    x2: number
    y2: number
    thickness: number
}

export class BeamLayout {
    readonly id = crypto.randomUUID()
    readonly primary: LayoutBeamSegment
    readonly secondaries: LayoutBeamSegment[]
    private _stemByNote: Map<Note, { x: number; y1: number; y2: number }>

    constructor(beam: Beam) {
        const firstStem = beam.firstNote.layout.stem
        if (typeof firstStem === 'undefined') throw new Error('Beam note has no stem')

        const lastStem = beam.lastNote.layout.stem
        if (typeof lastStem === 'undefined') throw new Error('Beam note has no stem')

        // slope
        const dx = lastStem.x - firstStem.x
        let slope = 0
        if (dx !== 0) {
            const rawSlope = (lastStem.y2 - firstStem.y2) / dx
            slope = Math.max(-BEAM_MAX_SLOPE, Math.min(BEAM_MAX_SLOPE, rawSlope / 2))
        }

        this._stemByNote = new Map()

        let beamFirstY = firstStem.y2
        for (const n of beam.notes) {
            const originalStem = n.layout.stem
            if (typeof originalStem === 'undefined') continue
            const beamYAtNote = beamFirstY + (originalStem.x - firstStem.x) * slope
            this._stemByNote.set(n, { ...originalStem, y2: beamYAtNote })

            if (beam.stemDir === 'up' && beamYAtNote > originalStem.y2) {
                beamFirstY -= beamYAtNote - originalStem.y2
            } else if (beam.stemDir === 'down' && beamYAtNote < originalStem.y2) {
                beamFirstY += originalStem.y2 - beamYAtNote
            }
        }

        // primary
        const dirSign = beam.stemDir === 'up' ? 1 : -1
        const y1 = beamFirstY
        const y2 = y1 + (lastStem.x - firstStem.x) * slope
        this.primary = { x1: firstStem.x, y1, x2: lastStem.x, y2, thickness: BEAM_WIDTH * dirSign }

        // secondaries
        const segments: LayoutBeamSegment[] = []
        const thickness = BEAM_WIDTH * dirSign
        const beamY = beamFirstY - BEAM_LEVEL_STRIDE * -dirSign
        let segStart: number | null = null
        let segStartY: number | null = null
        for (let i = 0; i < beam.notes.length; i++) {
            const n = beam.notes[i]
            if (!n.duration.hasSecondaryBeam) continue

            const stemX = n.layout.stem?.x
            if (typeof stemX === 'undefined') continue
            const yAtNote = beamY + (stemX - firstStem.x) * slope

            if (segStart === null) segStart = stemX
            if (segStartY === null) segStartY = yAtNote

            const nextQualifies = i + 1 < beam.notes.length && beam.notes[i + 1].duration.hasSecondaryBeam
            if (!nextQualifies) {
                if (segStart === stemX) {
                    const partialDir = i === 0 ? 1 : -1
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
        this.secondaries = segments
    }

    getStem(note: Note) {
        return this._stemByNote.get(note)
    }
}
