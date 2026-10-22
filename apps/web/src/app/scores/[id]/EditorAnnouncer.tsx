'use client'

import type { Note } from '@mushee/notation/model'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { shortcutText } from '@/components/ui/Tooltip'
import type { Keybindings } from '@/lib/Keybindings'

import { LOWER_PITCH, MOVE_NEXT, MOVE_PREVIOUS, RAISE_PITCH } from './actions'
import type { EditorCommand } from './commands'
import type { ScoreManipulator } from './ScoreManipulator'

/** A non-breaking space, toggled onto a repeated line so the live region's text changes. */
const NBSP = String.fromCharCode(0xa0)

/**
 * The announcer's clock: a burst of messages (count-in, then recording, a quick run of edits)
 * reads as its last line once things settle for {@link DEBOUNCE_MS}. The same line twice in a
 * row still reads twice — it is republished with a non-breaking space toggled on, since a live
 * region whose text doesn't change says nothing.
 */
export class AnnouncementClock {
    static readonly DEBOUNCE_MS = 150

    private timer: ReturnType<typeof setTimeout> | null = null
    private last = ''

    constructor(private readonly publish: (text: string) => void) {}

    say(text: string): void {
        this.cancel()
        this.timer = setTimeout(() => {
            this.timer = null
            this.last = this.last === text ? text + NBSP : text
            this.publish(this.last)
        }, AnnouncementClock.DEBOUNCE_MS)
    }

    cancel(): void {
        if (this.timer !== null) clearTimeout(this.timer)
        this.timer = null
    }
}

/**
 * What the editor's live region says about the selection and the edits made to it, in plain
 * words: 'G, quarter note. Bar 2, beat 1.' for a note, '5 notes selected, bars 1 to 2.' for a
 * run, and the one thing an edit changed — 'A.' for a pitch, 'Eighth note.' for a length.
 * Beats count the felt pulse (two in 6/8), from 1.
 */
export class EditorSpeech {
    /** The selection: one note and where it sits, or how many notes across which bars. Null for none. */
    static selection(notes: readonly Note[]): string | null {
        const first = notes[0]
        const last = notes[notes.length - 1]
        if (!first || !last) return null
        if (notes.length === 1) return `${first.spokenDescription}. ${EditorSpeech.position(first)}.`
        const from = first.measure.index + 1
        const to = last.measure.index + 1
        return `${notes.length} notes selected, ${from === to ? `bar ${from}` : `bars ${from} to ${to}`}.`
    }

    /** A note's pitch after a pitch edit: 'A.', 'F sharp.' — 'Rest.' for a rest. */
    static pitch(note: Note): string {
        return `${note.spokenPitch}.`
    }

    /** A note's length after a length edit: 'Eighth note.', 'Dotted half note.' */
    static noteLength(note: Note): string {
        return `${EditorSpeech.capitalized(note.spokenDuration)}.`
    }

    /** The whole note after any other single-note edit: 'G, quarter note.', 'Quarter rest.' */
    static note(note: Note): string {
        return `${note.spokenDescription}.`
    }

    /** 'Bar 2, beat 1' — the bar from 1, the felt beat the note starts in from 1. */
    private static position(note: Note): string {
        const measure = note.measure
        const beat = Math.floor(measure.beatOffsetOf(note) / measure.timeSignature.pulse.beats + 1e-9) + 1
        return `Bar ${measure.index + 1}, beat ${beat}`
    }

    private static capitalized(text: string): string {
        return text.charAt(0).toUpperCase() + text.slice(1)
    }
}

/**
 * The editor's one live region (contract C11): always mounted, visually hidden, polite — and
 * deliberately without role="status", so the Toaster's status region stays the page's first.
 * Anything in the editor speaks through {@link ScoreManipulator.announce}: the selection and
 * single-note edits ({@link EditorSpeech}), playback starting and stopping, the autosave
 * failing and recovering, and the recording flow's "Count-in", "Recording" and what a finished
 * recording added.
 */
export function EditorAnnouncer({ manipulator }: { manipulator: ScoreManipulator }) {
    const [text, setText] = useState('')

    useEffect(() => {
        const clock = new AnnouncementClock(setText)
        manipulator.onAnnounce = (message) => clock.say(message)
        return () => {
            clock.cancel()
            manipulator.onAnnounce = undefined
        }
    }, [manipulator])

    return (
        <div aria-live="polite" aria-atomic="true" className="sr-only">
            {text}
        </div>
    )
}

/** Arrow keycaps as a screen reader should say them. */
const SPOKEN_KEYS: Readonly<Record<string, string>> = { '←': 'Left arrow', '→': 'Right arrow', '↑': 'Up arrow', '↓': 'Down arrow' }

/**
 * How the keyboard drives the score, in one plain paragraph built from the live keybindings
 * (a rebound key reads as its new key; an unbound one drops its sentence): 'Left and right
 * arrows move between notes. Up and down change the pitch. Press ? for all shortcuts.' ('?'
 * is fixed: the shortcuts list's own key.)
 */
export class KeyboardHelpText {
    static of(keybindings: Keybindings<EditorCommand>): string {
        const key = (commandId: string) => {
            const text = shortcutText(keybindings.shortcutFor(commandId), false)
            return text ? (SPOKEN_KEYS[text] ?? text) : null
        }
        const previous = key(MOVE_PREVIOUS.id)
        const next = key(MOVE_NEXT.id)
        const higher = key(RAISE_PITCH.id)
        const lower = key(LOWER_PITCH.id)
        const sentences: string[] = []
        if (previous && next) {
            sentences.push(
                previous === SPOKEN_KEYS['←'] && next === SPOKEN_KEYS['→']
                    ? 'Left and right arrows move between notes.'
                    : `${previous} and ${next} move between notes.`,
            )
        }
        if (higher && lower) {
            sentences.push(
                higher === SPOKEN_KEYS['↑'] && lower === SPOKEN_KEYS['↓']
                    ? 'Up and down change the pitch.'
                    : `${higher} and ${lower} change the pitch.`,
            )
        }
        sentences.push('Press ? for all shortcuts.')
        return sentences.join(' ')
    }
}

/** The canvas's keyboard how-to (see {@link KeyboardHelpText}), visually hidden — what its aria-describedby points at. */
export function KeyboardHelp({ id, keybindings }: { id: string; keybindings: Keybindings<EditorCommand> }) {
    useSyncExternalStore(keybindings.subscribe, keybindings.getSnapshot, keybindings.getSnapshot)
    return (
        <p id={id} hidden>
            {KeyboardHelpText.of(keybindings)}
        </p>
    )
}
