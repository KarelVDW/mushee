import type { BindableCommand } from '@/lib/Keybindings'

import {
    type ActionArgs,
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
    /** Perform the command. Return `false` when it didn't apply, leaving the keystroke to the browser. */
    run: (manipulator: ScoreManipulator) => boolean | void
}

/**
 * How {@link fromAction} wraps an action. A parameterised action is pinned to one `arg`, so a
 * single keystroke can stand in for one choice of a dock picker (a duration, an accidental);
 * its `suffix` keeps every such keystroke its own rebindable command, and its `label` names
 * the choice. `arg` is required exactly when the action takes one.
 */
type FromActionOptions<A> = {
    group: EditorCommandGroup
    shortcut: string | null
    suffix?: string
    label?: string
} & ([A] extends [void] ? { arg?: never } : { arg: A })

const fromAction = <A>(action: ScoreAction<A>, options: FromActionOptions<NoInfer<A>>): EditorCommand => {
    const { group, shortcut, suffix, label } = options
    // The options type already tied `arg`'s presence to the action's parameter.
    const args = ('arg' in options ? [options.arg] : []) as ActionArgs<A>
    return {
        id: suffix ? `${action.id}:${suffix}` : action.id,
        label: label ?? action.label,
        group,
        defaultShortcut: shortcut,
        run: (manipulator) => manipulator.run(action, ...args),
    }
}

/** The dock's duration picker, one key per value: mnemonic letters (Digit3 is the triplet toggle). */
const DURATION_COMMANDS: readonly EditorCommand[] = (
    [
        ['w', 'Whole note', 'KeyW'],
        ['h', 'Half note', 'KeyH'],
        ['q', 'Quarter note', 'KeyQ'],
        ['8', 'Eighth note', 'KeyE'],
        ['16', 'Sixteenth note', 'KeyS'],
    ] as const
).map(([type, label, shortcut]) => fromAction(SET_DURATION, { group: 'Durations', shortcut, arg: type, suffix: type, label }))

/**
 * The dock's accidental picker. Mnemonics assume a US layout (♭ on B, ♮ on N, ♯ where # is typed);
 * bindings are physical keys, so other layouts see other letters — the dialog shows the live ones
 * and everything is rebindable.
 */
const ACCIDENTAL_COMMANDS: readonly EditorCommand[] = [
    fromAction(SET_ACCIDENTAL, { group: 'Accidentals', shortcut: 'KeyB', arg: 'b', suffix: 'flat', label: 'Flat' }),
    fromAction(SET_ACCIDENTAL, { group: 'Accidentals', shortcut: 'KeyN', arg: undefined, suffix: 'natural', label: 'Natural' }),
    fromAction(SET_ACCIDENTAL, { group: 'Accidentals', shortcut: 'Shift+Digit3', arg: '#', suffix: 'sharp', label: 'Sharp' }),
]

/**
 * Every keyboard-triggerable command, in dialog order. Default shortcuts name physical keys
 * ({@link KeyboardEvent.code}), so they sit on the same key position on every keyboard layout.
 */
export const EDITOR_COMMANDS: readonly EditorCommand[] = [
    fromAction(MOVE_PREVIOUS, { group: 'Navigate', shortcut: 'ArrowLeft' }),
    fromAction(MOVE_NEXT, { group: 'Navigate', shortcut: 'ArrowRight' }),
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
    fromAction(RAISE_PITCH, { group: 'Edit notes', shortcut: 'ArrowUp' }),
    fromAction(LOWER_PITCH, { group: 'Edit notes', shortcut: 'ArrowDown' }),
    {
        id: REMOVE_NOTE.id,
        label: REMOVE_NOTE.label,
        group: 'Edit notes',
        defaultShortcut: 'Backspace',
        // Through the manipulator method (not fromAction): an all-rest selection deletes measures.
        run: (manipulator) => manipulator.deleteSelection(),
    },
    fromAction(TOGGLE_REST, { group: 'Edit notes', shortcut: 'KeyR' }),
    fromAction(TOGGLE_TIE, { group: 'Edit notes', shortcut: 'KeyT' }),
    fromAction(TOGGLE_DOT, { group: 'Edit notes', shortcut: 'Period' }),
    fromAction(TOGGLE_TUPLET, { group: 'Edit notes', shortcut: 'Digit3' }),
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
