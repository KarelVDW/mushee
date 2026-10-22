/**
 * What a pitch operation (transpose, minimize accidentals) acts on: the whole score, or only
 * the selected run. Only a multi-note selection can narrow one — see the editor's
 * `ScoreManipulator.selectionNarrowsPitchOps`. Kept here, below both, so the transpose popover
 * and the editor share it without the popover reaching up into the editor page.
 */
export type PitchScope = 'score' | 'selection'
