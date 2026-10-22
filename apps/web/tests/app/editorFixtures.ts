import type { Note, Score } from '@mushee/notation/model'
import { makeScore, pitched } from '@mushee/notation/testing'

import { EDITOR_COMMANDS } from '@/app/scores/[id]/commands'
import { ScoreManipulator } from '@/app/scores/[id]/ScoreManipulator'
import { Keybindings } from '@/lib/Keybindings'

/**
 * A one-measure score of four pitched quarter notes (C5 D5 E5 F5), attached to a manipulator.
 * `saves` records every score the manipulator handed to its autosave, in order.
 */
export function setupPitched(): { manipulator: ScoreManipulator; notes: Note[]; saves: Score[] } {
    const score = makeScore(1)
    const measure = score.firstMeasure
    if (!measure) throw new Error('expected a measure')
    const notes = score.replace(measure.notes, [pitched('C', 5), pitched('D', 5), pitched('E', 5), pitched('F', 5)])
    // A platform-pinned keymap so Mod means Ctrl regardless of the machine running the tests.
    const manipulator = new ScoreManipulator(new Keybindings(EDITOR_COMMANDS, { storageKey: 'test:editor-shortcuts', isMac: false }))
    const saves: Score[] = []
    manipulator.attach(score, (s) => saves.push(s))
    return { manipulator, notes, saves }
}

/** Every note in the score, in score order. */
export function allNotes(manipulator: ScoreManipulator): Note[] {
    return manipulator.score?.measures.flatMap((m) => m.notes) ?? []
}
