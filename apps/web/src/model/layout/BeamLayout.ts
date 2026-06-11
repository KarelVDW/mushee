import { BEAM_LEVEL_STRIDE, BEAM_MAX_SLOPE, BEAM_WIDTH, PARTIAL_BEAM_LENGTH } from '@/components/notation/constants'

import { Note } from '../Note'
import type { NoteLayout } from './NoteLayout'

interface LayoutBeamSegment {
    x1: number
    y1: number
    x2: number
    y2: number
    thickness: number
}

/**
 * A beamed group and its geometry: which notes are beamed (from BeamFinder),
 * the shared stem direction, the primary/secondary beam segments, and the
 * repositioned stem tips. Built by MeasureLayout with explicit context — the
 * x position and standalone layout of each member note.
 */
export class BeamLayout {
    readonly id = crypto.randomUUID()
    readonly notes: Note[]
    readonly stemDir: 'up' | 'down'
    readonly primary: LayoutBeamSegment
    readonly secondaries: LayoutBeamSegment[]
    private _stemByNote: Map<Note, { x: number; y1: number; y2: number }>

    constructor(
        group: { notes: Note[]; stemDir: 'up' | 'down' },
        context: { xOf: (note: Note) => number; layoutOf: (note: Note) => NoteLayout },
    ) {
        this.notes = group.notes
        this.stemDir = group.stemDir
        const firstNote = group.notes[0]
        const lastNote = group.notes[group.notes.length - 1]

        const firstStem = context.layoutOf(firstNote).getStem(this.stemDir)
        const firstStemX = context.xOf(firstNote) + firstStem.x
        const lastStem = context.layoutOf(lastNote).getStem(this.stemDir)
        const lastStemX = context.xOf(lastNote) + lastStem.x

        // slope
        const dx = lastStemX - firstStemX
        let slope = 0
        /* v8 ignore next -- divide-by-zero guard: beam notes always occupy distinct x, so dx !== 0 */
        if (dx !== 0) {
            const rawSlope = (lastStem.y2 - firstStem.y2) / dx
            slope = Math.max(-BEAM_MAX_SLOPE, Math.min(BEAM_MAX_SLOPE, rawSlope / 2))
        }

        this._stemByNote = new Map()

        let beamFirstY = firstStem.y2
        for (const n of group.notes) {
            const originalStem = context.layoutOf(n).getStem(this.stemDir)
            const stemX = context.xOf(n) + originalStem.x
            const beamYAtNote = beamFirstY + (stemX - firstStemX) * slope

            if (this.stemDir === 'up' && beamYAtNote > originalStem.y2) {
                beamFirstY -= beamYAtNote - originalStem.y2
            } else if (this.stemDir === 'down' && beamYAtNote < originalStem.y2) {
                beamFirstY += originalStem.y2 - beamYAtNote
            }
        }

        for (const n of group.notes) {
            const originalStem = context.layoutOf(n).getStem(this.stemDir)
            const stemX = context.xOf(n) + originalStem.x
            const beamYAtNote = beamFirstY + (stemX - firstStemX) * slope
            this._stemByNote.set(n, { ...originalStem, y2: beamYAtNote })
        }

        // primary
        const dirSign = this.stemDir === 'up' ? 1 : -1
        const y1 = beamFirstY
        const y2 = y1 + (lastStemX - firstStemX) * slope
        this.primary = { x1: firstStemX, y1, x2: lastStemX, y2, thickness: BEAM_WIDTH * dirSign }

        // secondaries
        const segments: LayoutBeamSegment[] = []
        const thickness = BEAM_WIDTH * dirSign
        const beamY = beamFirstY - BEAM_LEVEL_STRIDE * -dirSign
        let segStart: number | null = null
        let segStartY: number | null = null
        for (let i = 0; i < group.notes.length; i++) {
            const n = group.notes[i]
            if (!n.duration.hasSecondaryBeam) continue

            const stemX = context.xOf(n) + context.layoutOf(n).getStem(this.stemDir).x
            const yAtNote = beamY + (stemX - firstStemX) * slope

            if (segStart === null) segStart = stemX
            if (segStartY === null) segStartY = yAtNote

            const nextQualifies = i + 1 < group.notes.length && group.notes[i + 1].duration.hasSecondaryBeam
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

    get firstNote() {
        return this.notes[0]
    }

    get lastNote() {
        return this.notes[this.notes.length - 1]
    }

    getStem(note: Note) {
        return this._stemByNote.get(note)
    }
}
