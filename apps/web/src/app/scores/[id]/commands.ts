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

/** Display groups for the shortcuts dialog, in presentation order — playing and recording first, then the everyday edits. */
export const EDITOR_COMMAND_GROUPS = [
    'Playback',
    'Edit notes',
    'Note length',
    'Sharp or flat',
    'Move around',
    'Select',
    'Copy and paste',
    'Undo',
] as const
export type EditorCommandGroup = (typeof EDITOR_COMMAND_GROUPS)[number]

/** Why the length keys decline on a run of notes — the same words the dock's length tools show. */
export const LENGTH_NEEDS_ONE_NOTE = 'Select one note to change its length.'

/**
 * A keyboard-triggerable editor operation: what the shortcuts dialog lists and what a keydown
 * resolves to. A command wraps either a {@link ScoreAction} (note edits) or a manipulator
 * method (selection / clipboard); the {@link ScoreManipulator} resolves keystrokes to commands
 * through its Keybindings and runs them.
 */
export interface EditorCommand extends BindableCommand {
    label: string
    group: EditorCommandGroup
    /**
     * A second key that also runs this (fixed) command, matched by {@link KeyboardEvent.key} —
     * for a key no shortcut can be recorded on, like the keyboard's Menu key. `label` is how the
     * shortcuts dialog shows it.
     */
    alternateKey?: { key: string; label: string }
    /**
     * An unmodified key ({@link KeyboardEvent.key}) this fixed command claims before any binding
     * is looked up: Escape stops a running take before it collapses a selection. When the
     * command declines, the key goes on to whatever it is bound to. `label` is its keycap.
     */
    preemptKey?: { key: string; label: string }
    /**
     * Declined while a control that the key activates natively has focus (a button, link or
     * switch): Space on a focused button presses that button, never the transport.
     */
    yieldsToControls?: boolean
    /** Perform the command. Return `false` when it didn't apply, leaving the keystroke to the browser. */
    run: (manipulator: ScoreManipulator) => boolean | void
}

/**
 * How {@link fromAction} wraps an action. A parameterised action is pinned to one `arg`, so a
 * single keystroke can stand in for one choice of a dock picker (a duration, an accidental);
 * its `suffix` keeps every such keystroke its own rebindable command, and its `label` names
 * the choice. `arg` is required exactly when the action takes one. `singleNote` declines the
 * keystroke while a run of notes is selected — for the single-note length actions, which
 * would otherwise silently change only the run's active note.
 */
type FromActionOptions<A> = {
    group: EditorCommandGroup
    shortcut: string | null
    suffix?: string
    label?: string
    singleNote?: boolean
} & ([A] extends [void] ? { arg?: never } : { arg: A })

const fromAction = <A>(action: ScoreAction<A>, options: FromActionOptions<NoInfer<A>>): EditorCommand => {
    const { group, shortcut, suffix, label, singleNote } = options
    // The options type already tied `arg`'s presence to the action's parameter.
    const args = ('arg' in options ? [options.arg] : []) as ActionArgs<A>
    return {
        id: suffix ? `${action.id}:${suffix}` : action.id,
        label: label ?? action.label,
        group,
        defaultShortcut: shortcut,
        run: (manipulator) => {
            if (singleNote && manipulator.isRangeSelected) return false
            manipulator.run(action, ...args)
        },
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
).map(([type, label, shortcut]) =>
    fromAction(SET_DURATION, { group: 'Note length', shortcut, arg: type, suffix: type, label, singleNote: true }),
)

/**
 * The dock's accidental picker. Mnemonics assume a US layout (♭ on B, ♮ on N, ♯ where # is typed);
 * bindings are physical keys, so other layouts see other letters — the dialog shows the live ones
 * and everything is rebindable.
 */
const ACCIDENTAL_COMMANDS: readonly EditorCommand[] = [
    fromAction(SET_ACCIDENTAL, { group: 'Sharp or flat', shortcut: 'KeyB', arg: 'b', suffix: 'flat', label: 'Flat' }),
    fromAction(SET_ACCIDENTAL, { group: 'Sharp or flat', shortcut: 'KeyN', arg: undefined, suffix: 'natural', label: 'Natural' }),
    fromAction(SET_ACCIDENTAL, { group: 'Sharp or flat', shortcut: 'Shift+Digit3', arg: '#', suffix: 'sharp', label: 'Sharp' }),
]

/** Id of the command that opens the selection actions (copy / paste / delete) from the keyboard. */
export const SELECTION_MENU_COMMAND = 'selection-menu'

/** Ids of the transport commands, for the transport's tooltips (which name their live keys). */
export const PLAY_PAUSE_COMMAND = 'play-pause'
export const RECORD_COMMAND = 'record'

/**
 * Play / record: the transport from the keyboard. Each asks the page through
 * {@link ScoreManipulator.requestTransport} (the transport is view state the manipulator
 * doesn't own) and is declined — left to the browser — when the page can't act on it.
 * Space is fixed (the media-player convention); Escape stopping a take is fixed too, and gets
 * its say before Escape's own binding.
 */
const PLAYBACK_COMMANDS: readonly EditorCommand[] = [
    {
        id: PLAY_PAUSE_COMMAND,
        label: 'Play or pause (also stops a recording)',
        group: 'Playback',
        defaultShortcut: 'Space',
        fixed: true,
        yieldsToControls: true,
        run: (manipulator) => manipulator.requestTransport('toggle'),
    },
    {
        id: 'play-from-start',
        label: 'Play from the start',
        group: 'Playback',
        defaultShortcut: 'Shift+Space',
        yieldsToControls: true,
        run: (manipulator) => manipulator.requestTransport('from-start'),
    },
    {
        id: RECORD_COMMAND,
        label: 'Record or stop recording',
        group: 'Playback',
        defaultShortcut: 'Shift+KeyR',
        run: (manipulator) => manipulator.requestTransport('record'),
    },
    {
        id: 'stop-recording',
        label: 'Stop recording',
        group: 'Playback',
        defaultShortcut: null,
        preemptKey: { key: 'Escape', label: 'Esc' },
        fixed: true,
        run: (manipulator) => manipulator.requestTransport('stop-recording'),
    },
]

/**
 * Every keyboard-triggerable command, in dialog order. Default shortcuts name physical keys
 * ({@link KeyboardEvent.code}), so they sit on the same key position on every keyboard layout.
 */
export const EDITOR_COMMANDS: readonly EditorCommand[] = [
    ...PLAYBACK_COMMANDS,
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
        label: 'Transpose…',
        group: 'Edit notes',
        defaultShortcut: 'Shift+KeyT',
        // Opens the transpose popover (no direct edit); declined until the editor registers it.
        run: (manipulator) => (manipulator.onTransposeRequest ? manipulator.onTransposeRequest() : false),
    },
    ...DURATION_COMMANDS,
    fromAction(TOGGLE_DOT, { group: 'Note length', shortcut: 'Period', singleNote: true }),
    fromAction(TOGGLE_TUPLET, { group: 'Note length', shortcut: 'Digit3', singleNote: true }),
    ...ACCIDENTAL_COMMANDS,
    fromAction(MOVE_PREVIOUS, { group: 'Move around', shortcut: 'ArrowLeft' }),
    fromAction(MOVE_NEXT, { group: 'Move around', shortcut: 'ArrowRight' }),
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
        label: 'Select just this note',
        group: 'Select',
        defaultShortcut: 'Escape',
        // Left to the browser when there is no range to collapse (Escape also dismisses dialogs).
        run: (manipulator) => {
            if (manipulator.selectedNotes.length <= 1) return false
            manipulator.collapseSelection()
        },
    },
    // Clipboard shortcuts are `fixed`: ⌘C/⌘X/⌘V (and ⌘A above) are OS-wide conventions, so
    // they're listed in the shortcuts dialog but never rebindable.
    {
        id: 'copy',
        label: 'Copy selection',
        group: 'Copy and paste',
        defaultShortcut: 'Mod+KeyC',
        fixed: true,
        run: (manipulator) => manipulator.copy(),
    },
    {
        id: 'cut',
        label: 'Cut selection',
        group: 'Copy and paste',
        defaultShortcut: 'Mod+KeyX',
        fixed: true,
        run: (manipulator) => manipulator.cut(),
    },
    {
        id: 'paste',
        label: 'Paste',
        group: 'Copy and paste',
        defaultShortcut: 'Mod+KeyV',
        fixed: true,
        run: (manipulator) => manipulator.paste(),
    },
    // The keyboard's way to the selection actions, as in every desktop app: Shift+F10 or the
    // Menu key. Fixed for the same reason as the clipboard keys.
    {
        id: SELECTION_MENU_COMMAND,
        label: 'Copy, paste and delete menu',
        group: 'Copy and paste',
        defaultShortcut: 'Shift+F10',
        alternateKey: { key: 'ContextMenu', label: 'Menu' },
        fixed: true,
        run: (manipulator) => manipulator.requestSelectionMenu(),
    },
    // History shortcuts are fixed for the same reason: ⌘Z / ⇧⌘Z are OS-wide conventions.
    // With nothing to travel to, the keystroke is left to the browser (undo/redo return false).
    {
        id: 'undo',
        label: 'Undo',
        group: 'Undo',
        defaultShortcut: 'Mod+KeyZ',
        fixed: true,
        run: (manipulator) => manipulator.undo(),
    },
    {
        id: 'redo',
        label: 'Redo',
        group: 'Undo',
        defaultShortcut: 'Mod+Shift+KeyZ',
        fixed: true,
        run: (manipulator) => manipulator.redo(),
    },
]
