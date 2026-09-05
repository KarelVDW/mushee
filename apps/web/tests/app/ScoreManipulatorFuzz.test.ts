import type { ClefType, DurationType } from '@mushee/notation/components/types'
import { Note, Pitch } from '@mushee/notation/model'
import { BEAT_EPSILON } from '@mushee/notation/model/Duration'
import { ScoreSerializer } from '@mushee/notation/model/util/ScoreSerializer'
import { makeScore } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

import {
    CLEAR_PITCH,
    LOWER_PITCH,
    MOVE_NEXT,
    MOVE_PREVIOUS,
    RAISE_PITCH,
    REMOVE_NOTE,
    SET_ACCIDENTAL,
    SET_DURATION,
    TOGGLE_DOT,
    TOGGLE_REST,
    TOGGLE_TIE,
    TOGGLE_TUPLET,
} from '@/app/scores/[id]/actions'
import { ScoreManipulator } from '@/app/scores/[id]/ScoreManipulator'

/**
 * The editor's core promise under random abuse: after ANY sequence of edits the
 * score is still well-formed (every bar exactly full, at least one bar, every
 * note attached), nothing throws, and undoing every step restores the exact
 * starting document while redoing every step restores the exact final one.
 * Seeded, so a failure names the one seed to replay.
 */

/** A cut tuplet may leave a sub-sixteenth residue (the model keeps the note rather than dropping it). */
const RESIDUE = 1 / 6

class Rng {
    private state: number
    constructor(seed: number) {
        this.state = seed >>> 0
    }
    next(): number {
        let t = (this.state += 0x6d2b79f5)
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    int(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1))
    }
    pick<T>(items: readonly T[]): T {
        return items[Math.floor(this.next() * items.length)]
    }
}

const DURATIONS: DurationType[] = ['w', 'h', 'q', '8', '16']
const CLEFS: ClefType[] = ['treble', 'bass', 'alto', 'tenor', 'treble8vb']
const NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

function startingScore(rng: Rng) {
    const score = makeScore(rng.int(1, 3))
    for (const measure of score.measures) {
        const notes = measure.notes.map((rest) =>
            rng.next() < 0.7
                ? new Note({ duration: rest.duration, pitch: new Pitch({ name: rng.pick(NAMES), octave: rng.int(3, 5) }) })
                : rest,
        )
        score.replace(measure.notes, notes)
    }
    return score
}

function scoreOf(manipulator: ScoreManipulator) {
    const score = manipulator.score
    if (!score) throw new Error('manipulator has no score')
    return score
}

const serialize = (manipulator: ScoreManipulator) => JSON.stringify(new ScoreSerializer(scoreOf(manipulator)).toInput())

function assertWellFormed(manipulator: ScoreManipulator, step: string) {
    const score = scoreOf(manipulator)
    expect(score.measures.length, `${step}: no measures left`).toBeGreaterThan(0)
    for (const measure of score.measures) {
        expect(measure.beats, `${step}: bar ${measure.index} over-full at ${measure.beats}/${measure.maxBeats}`).toBeLessThan(
            measure.maxBeats + BEAT_EPSILON,
        )
        expect(measure.maxBeats - measure.beats, `${step}: bar ${measure.index} holds ${measure.beats}/${measure.maxBeats}`).toBeLessThan(
            RESIDUE,
        )
        for (const note of measure.notes) expect(note.isAttached, `${step}: detached note in bar ${measure.index}`).toBe(true)
    }
    const selected = manipulator.selectedNote
    if (selected) expect(selected.isAttached, `${step}: selection points at a detached note`).toBe(true)
}

/** One random edit; returns a label for failure messages. */
function randomEdit(manipulator: ScoreManipulator, rng: Rng): string {
    const roll = rng.next()
    const notes = scoreOf(manipulator).measures.flatMap((m) => m.notes)
    if (roll < 0.1) {
        manipulator.select(rng.pick(notes))
        return 'select'
    }
    if (roll < 0.16) {
        const a = rng.pick(notes)
        const b = rng.pick(notes)
        manipulator.select(a)
        manipulator.extendSelectionTo(b)
        return 'extend selection'
    }
    if (roll < 0.22) return (manipulator.run(rng.pick([MOVE_NEXT, MOVE_PREVIOUS])), 'move')
    if (roll < 0.34) return (manipulator.run(rng.pick([RAISE_PITCH, LOWER_PITCH])), 'nudge pitch')
    if (roll < 0.46) {
        const type = rng.pick(DURATIONS)
        manipulator.run(SET_DURATION, type)
        return `duration ${type}`
    }
    if (roll < 0.52) return (manipulator.run(TOGGLE_DOT), 'dot')
    if (roll < 0.58) return (manipulator.run(TOGGLE_TUPLET), 'tuplet')
    if (roll < 0.63) return (manipulator.run(TOGGLE_TIE), 'tie')
    if (roll < 0.69) return (manipulator.run(TOGGLE_REST), 'rest')
    if (roll < 0.73) return (manipulator.run(SET_ACCIDENTAL, rng.pick(['#', 'b', undefined])), 'accidental')
    if (roll < 0.76) return (manipulator.run(CLEAR_PITCH), 'clear pitch')
    if (roll < 0.8) return (manipulator.run(REMOVE_NOTE), 'remove note')
    if (roll < 0.84) return (manipulator.deleteSelection(), 'delete selection')
    if (roll < 0.87) {
        manipulator.copy()
        manipulator.run(MOVE_NEXT)
        manipulator.paste()
        return 'copy/paste'
    }
    if (roll < 0.9) return (manipulator.addMeasure(), 'add measure')
    if (roll < 0.92) return (manipulator.removeMeasure(), 'remove measure')
    if (roll < 0.95) {
        const i = rng.int(0, scoreOf(manipulator).measures.length - 1)
        manipulator.setTempoAt(i, 0, rng.int(40, 200))
        return 'tempo'
    }
    if (roll < 0.97) return (manipulator.setClefAt(rng.int(0, scoreOf(manipulator).measures.length - 1), rng.pick(CLEFS)), 'clef')
    if (roll < 0.99) return (manipulator.setKeyAt(rng.int(0, scoreOf(manipulator).measures.length - 1), rng.int(-7, 7)), 'key')
    manipulator.setTimeSignatureAt(rng.int(0, scoreOf(manipulator).measures.length - 1), rng.pick([2, 3, 4, 6]), rng.pick([4, 8]))
    return 'time signature'
}

const SEEDS = Array.from({ length: 120 }, (_, i) => i + 1)

describe('ScoreManipulator under random edit sequences', () => {
    it.each(SEEDS)('keeps the score well-formed and undo/redo exact (seed %i)', (seed) => {
        const rng = new Rng(seed)
        const manipulator = new ScoreManipulator()
        manipulator.attach(startingScore(rng), () => undefined)
        const initial = serialize(manipulator)
        const steps: string[] = []

        const count = rng.int(5, 25)
        for (let i = 0; i < count; i++) {
            const label = randomEdit(manipulator, rng)
            steps.push(label)
            assertWellFormed(manipulator, `after ${steps.join(' → ')}`)
        }
        const final = serialize(manipulator)

        let undone = 0
        while (manipulator.canUndo) {
            manipulator.undo()
            undone += 1
            assertWellFormed(manipulator, `undo #${undone} of ${steps.join(' → ')}`)
            expect(undone, 'undo never runs out').toBeLessThanOrEqual(count + 1)
        }
        expect(serialize(manipulator), `after undoing ${steps.join(' → ')}`).toBe(initial)

        while (manipulator.canRedo) manipulator.redo()
        expect(serialize(manipulator), `after redoing ${steps.join(' → ')}`).toBe(final)
    })
})
