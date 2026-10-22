import { BEAM_LEVEL_STRIDE, BEAM_MAX_SLOPE, BEAM_WIDTH, PARTIAL_BEAM_LENGTH } from '../../engraving/constants'
import type { Note } from '../Note'
import type { StemDirection } from '../types'
import type { BeamedRun } from './BeamFinder'
import type { NoteLayout } from './NoteLayout'
import type { LayoutBeamSegment, LayoutStem } from './types'

/**
 * A beamed group and its geometry: which notes are beamed (from BeamFinder),
 * the shared stem direction, the primary/secondary beam segments, and the
 * repositioned stem tips. Built by MeasureLayout with explicit context — the
 * x position and standalone layout of each member note.
 */
export class BeamLayout {
    readonly id = crypto.randomUUID()
    readonly notes: Note[]
    readonly stemDir: StemDirection
    readonly primary: LayoutBeamSegment
    readonly secondaries: LayoutBeamSegment[]
    private _stemByNote: Map<Note, LayoutStem>

    constructor(group: BeamedRun, context: { xOf: (note: Note) => number; layoutOf: (note: Note) => NoteLayout }) {
        this.notes = group.notes
        this.stemDir = group.stemDir
        // Each member's standalone stem (note-local) and its measure-local x — every pass below reads these.
        const members = group.notes.map((note) => {
            const stem = context.layoutOf(note).getStem(this.stemDir)
            return { note, stem, x: context.xOf(note) + stem.x }
        })
        const first = members[0]
        const last = members[members.length - 1]

        // slope — halved as damping, so the beam slants less steeply than the melodic contour it follows
        const dx = last.x - first.x
        let slope = 0
        /* v8 ignore next -- divide-by-zero guard: beam notes always occupy distinct x, so dx !== 0 */
        if (dx !== 0) {
            const rawSlope = (last.stem.y2 - first.stem.y2) / dx
            slope = Math.max(-BEAM_MAX_SLOPE, Math.min(BEAM_MAX_SLOPE, rawSlope / 2))
        }

        // Shift the beam line until every stem reaches it.
        let beamFirstY = first.stem.y2
        for (const { stem, x } of members) {
            const beamYAtNote = beamFirstY + (x - first.x) * slope
            if (this.stemDir === 'up' && beamYAtNote > stem.y2) {
                beamFirstY -= beamYAtNote - stem.y2
            } else if (this.stemDir === 'down' && beamYAtNote < stem.y2) {
                beamFirstY += stem.y2 - beamYAtNote
            }
        }

        this._stemByNote = new Map(members.map(({ note, stem, x }) => [note, { ...stem, y2: beamFirstY + (x - first.x) * slope }]))

        // primary
        const dirSign = this.stemDir === 'up' ? 1 : -1
        const thickness = BEAM_WIDTH * dirSign
        this.primary = { x1: first.x, y1: beamFirstY, x2: last.x, y2: beamFirstY + dx * slope, thickness }

        // secondaries — one level stride further from the noteheads than the primary
        const segments: LayoutBeamSegment[] = []
        const beamY = beamFirstY + BEAM_LEVEL_STRIDE * dirSign
        let run: { x: number; y: number } | null = null
        for (let i = 0; i < members.length; i++) {
            const { note, x } = members[i]
            if (!note.duration.hasSecondaryBeam) continue

            const yAtNote = beamY + (x - first.x) * slope
            run ??= { x, y: yAtNote }

            const nextQualifies = i + 1 < members.length && members[i + 1].note.duration.hasSecondaryBeam
            if (!nextQualifies) {
                if (run.x === x) {
                    const partialDir = i === 0 ? 1 : -1
                    segments.push({
                        x1: x,
                        y1: yAtNote,
                        x2: x + partialDir * PARTIAL_BEAM_LENGTH,
                        y2: yAtNote + partialDir * PARTIAL_BEAM_LENGTH * slope,
                        thickness,
                    })
                } else {
                    segments.push({ x1: run.x, y1: run.y, x2: x, y2: yAtNote, thickness })
                }
                run = null
            }
        }
        this.secondaries = segments
    }

    /** The beam-repositioned stem of `note`: note-local, same space as NoteLayout.stem (primary/secondaries are measure-local). */
    getStem(note: Note) {
        return this._stemByNote.get(note)
    }
}
