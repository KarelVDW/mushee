import type { BindableCommand } from '@/lib/Keybindings'

import {
    LOWER_PITCH,
    MOVE_NEXT,
    MOVE_PREVIOUS,
    RAISE_PITCH,
    REMOVE_NOTE,
    type ScoreAction,
    TOGGLE_DOT,
    TOGGLE_REST,
    TOGGLE_TIE,
    TOGGLE_TUPLET,
} from './actions'
import type { ScoreManipulator } from './ScoreManipulator'

/** Display groups for the shortcuts dialog, in presentation order. */
export const EDITOR_COMMAND_GROUPS = ['Navigate', 'Select', 'Edit notes', 'Clipboard'] as const
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

const fromAction = (action: ScoreAction, group: EditorCommandGroup, defaultShortcut: string | null): EditorCommand => ({
    id: action.id,
    label: action.label,
    group,
    defaultShortcut,
    run: (manipulator) => manipulator.run(action),
})

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
    fromAction(REMOVE_NOTE, 'Edit notes', 'Backspace'),
    fromAction(TOGGLE_REST, 'Edit notes', 'KeyR'),
    fromAction(TOGGLE_TIE, 'Edit notes', 'KeyT'),
    fromAction(TOGGLE_DOT, 'Edit notes', 'Period'),
    fromAction(TOGGLE_TUPLET, 'Edit notes', 'Digit3'),
    {
        id: 'copy',
        label: 'Copy selection',
        group: 'Clipboard',
        defaultShortcut: 'Mod+KeyC',
        run: (manipulator) => manipulator.copy(),
    },
    {
        id: 'paste',
        label: 'Paste',
        group: 'Clipboard',
        defaultShortcut: 'Mod+KeyV',
        run: (manipulator) => manipulator.paste(),
    },
]
