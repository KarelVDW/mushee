import type { BindableCommand } from '@/lib/Keybindings'

import {
    LOWER_PITCH,
    MINIMIZE_ACCIDENTALS,
    MOVE_NEXT,
    MOVE_PREVIOUS,
    RAISE_PITCH,
    REMOVE_NOTE,
    type ScoreAction,
    SET_ACCIDENTAL,
    SET_DURATION,
    TOGGLE_DOT,
    TOGGLE_REST,
    TOGGLE_TIE,
    TOGGLE_TUPLET,
} from './actions'
import type { ScoreManipulator } from './ScoreManipulator'

/** Display groups for the shortcuts dialog, in presentation order. */
export const EDITOR_COMMAND_GROUPS = ['Navigate', 'Select', 'Edit notes', 'Durations', 'Accidentals', 'Clipboard', 'History'] as const
export type EditorCommandGroup = (typeof EDITOR_COMMAND_GROUPS)[number]

/**
 * A keyboard-triggerable editor operation: what the shortcuts dialog lists and what a keydown
 * resolves to. A command wraps either a {@link ScoreAction} (note edits) or a manipulator
 * method (selection / clipboard); the {@link ScoreManipulator} resolves keystrokes to commands
 * through its Keybindings and runs them.
 */
export interface EditorCommand extends BindableCommand {
    label: string
    group: EditorCommandGroup
    /** One-line dialog copy explaining what the command does when the label alone is terse. */
    description?: string
    /** Perform the command. Return `false` when it didn't apply, leaving the keystroke to the browser. */
    run: (manipulator: ScoreManipulator) => boolean | void
}

const fromAction = (action: ScoreAction, group: EditorCommandGroup, defaultShortcut: string | null): EditorCommand => ({
    id: action.id,
    label: action.label,
    group,
    defaultShortcut,
    run: (manipulator) => manipulator.run(action),
})

/**
 * A parameterised action pinned to one argument, so a single keystroke can stand in for one
 * choice of a dock picker (a duration, an accidental). The id is suffixed with the choice so
 * every keystroke stays its own rebindable command.
 */
const fromActionWith = (
    action: ScoreAction,
    suffix: string,
    arg: unknown,
    label: string,
    description: string,
    group: EditorCommandGroup,
    defaultShortcut: string | null,
): EditorCommand => ({
    id: `${action.id}:${suffix}`,
    label,
    description,
    group,
    defaultShortcut,
    run: (manipulator) => manipulator.run(action, arg),
})

/** The dock's duration picker, one key per value: mnemonic letters (Digit3 is the triplet toggle). */
const DURATION_COMMANDS: readonly EditorCommand[] = (
    [
        ['w', 'Whole note', 'KeyW'],
        ['h', 'Half note', 'KeyH'],
        ['q', 'Quarter note', 'KeyQ'],
        ['8', 'Eighth note', 'KeyE'],
        ['16', 'Sixteenth note', 'KeyS'],
    ] as const
).map(([type, label, key]) =>
    fromActionWith(SET_DURATION, type, type, label, `Set the selected note to a ${label.toLowerCase()}.`, 'Durations', key),
)

/** The dock's accidental picker: ♭ on B (how it is written), ♮ on N, ♯ on the key that types # on a US layout. */
const ACCIDENTAL_COMMANDS: readonly EditorCommand[] = [
    fromActionWith(SET_ACCIDENTAL, 'flat', 'b', 'Flat', 'Lower the selected notes by a semitone (♭).', 'Accidentals', 'KeyB'),
    fromActionWith(
        SET_ACCIDENTAL,
        'natural',
        undefined,
        'Natural',
        'Remove the accidental from the selected notes (♮).',
        'Accidentals',
        'KeyN',
    ),
    fromActionWith(SET_ACCIDENTAL, 'sharp', '#', 'Sharp', 'Raise the selected notes by a semitone (♯).', 'Accidentals', 'Shift+Digit3'),
]

/**
 * Every keyboard-triggerable command, in dialog order. Default shortcuts name physical keys
 * ({@link KeyboardEvent.code}), so they sit on the same key position on every keyboard layout.
 */
export const EDITOR_COMMANDS: readonly EditorCommand[] = [
    fromAction(MOVE_PREVIOUS, 'Navigate', 'ArrowLeft'),
    fromAction(MOVE_NEXT, 'Navigate', 'ArrowRight'),
    {
        id: 'extend-selection-previous',
        label: 'Extend selection left',
        group: 'Select',
        defaultShortcut: 'Shift+ArrowLeft',
        run: (manipulator) => manipulator.extendSelectionByStep(-1),
    },
    {
        id: 'extend-selection-next',
        label: 'Extend selection right',
        group: 'Select',
        defaultShortcut: 'Shift+ArrowRight',
        run: (manipulator) => manipulator.extendSelectionByStep(1),
    },
    {
        id: 'select-all',
        label: 'Select all',
        group: 'Select',
        defaultShortcut: 'Mod+KeyA',
        fixed: true,
        run: (manipulator) => manipulator.selectAll(),
    },
    {
        id: 'collapse-selection',
        label: 'Collapse selection',
        group: 'Select',
        defaultShortcut: 'Escape',
        // Left to the browser when there is no range to collapse (Escape also dismisses dialogs).
        run: (manipulator) => {
            if (manipulator.selectedNotes.length <= 1) return false
            manipulator.collapseSelection()
        },
    },
    fromAction(RAISE_PITCH, 'Edit notes', 'ArrowUp'),
    fromAction(LOWER_PITCH, 'Edit notes', 'ArrowDown'),
    {
        id: REMOVE_NOTE.id,
        label: REMOVE_NOTE.label,
        group: 'Edit notes',
        defaultShortcut: 'Backspace',
        // Through the manipulator method (not fromAction): an all-rest selection deletes measures.
        run: (manipulator) => manipulator.deleteSelection(),
    },
    fromAction(TOGGLE_REST, 'Edit notes', 'KeyR'),
    fromAction(TOGGLE_TIE, 'Edit notes', 'KeyT'),
    fromAction(TOGGLE_DOT, 'Edit notes', 'Period'),
    fromAction(TOGGLE_TUPLET, 'Edit notes', 'Digit3'),
    {
        id: MINIMIZE_ACCIDENTALS.id,
        label: MINIMIZE_ACCIDENTALS.label,
        group: 'Edit notes',
        defaultShortcut: 'KeyM',
        // Through the manipulator method (not fromAction) so the highlight flash fires too.
        run: (manipulator) => manipulator.minimizeAccidentals(),
    },
    {
        id: 'transpose',
        label: 'Transpose',
        group: 'Edit notes',
        defaultShortcut: 'Shift+KeyT',
        // Opens the transpose popover (no direct edit); declined until the editor registers it.
        run: (manipulator) => (manipulator.onTransposeRequest ? manipulator.onTransposeRequest() : false),
    },
    ...DURATION_COMMANDS,
    ...ACCIDENTAL_COMMANDS,
    // Clipboard shortcuts are `fixed`: ⌘C/⌘X/⌘V (and ⌘A above) are OS-wide conventions, so
    // they're listed in the shortcuts dialog but never rebindable.
    {
        id: 'copy',
        label: 'Copy selection',
        group: 'Clipboard',
        defaultShortcut: 'Mod+KeyC',
        fixed: true,
        run: (manipulator) => manipulator.copy(),
    },
    {
        id: 'cut',
        label: 'Cut selection',
        group: 'Clipboard',
        defaultShortcut: 'Mod+KeyX',
        fixed: true,
        run: (manipulator) => manipulator.cut(),
    },
    {
        id: 'paste',
        label: 'Paste',
        group: 'Clipboard',
        defaultShortcut: 'Mod+KeyV',
        fixed: true,
        run: (manipulator) => manipulator.paste(),
    },
    // History shortcuts are fixed for the same reason: ⌘Z / ⇧⌘Z are OS-wide conventions.
    // With nothing to travel to, the keystroke is left to the browser (undo/redo return false).
    {
        id: 'undo',
        label: 'Undo',
        group: 'History',
        defaultShortcut: 'Mod+KeyZ',
        fixed: true,
        run: (manipulator) => manipulator.undo(),
    },
    {
        id: 'redo',
        label: 'Redo',
        group: 'History',
        defaultShortcut: 'Mod+Shift+KeyZ',
        fixed: true,
        run: (manipulator) => manipulator.redo(),
    },
]
