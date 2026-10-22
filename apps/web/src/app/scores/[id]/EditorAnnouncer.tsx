'use client'

import { useEffect, useState } from 'react'

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
 * The editor's one live region (contract C11): always mounted, visually hidden, polite — and
 * deliberately without role="status", so the Toaster's status region stays the page's first.
 * Anything in the editor speaks through {@link ScoreManipulator.announce}; the recording flow
 * says "Count-in", "Recording" and what a finished recording added.
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
