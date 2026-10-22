import { INTERACTION_BLUE } from '@mushee/notation/components'
import type { Score } from '@mushee/notation/model'
import type { MidiPlayer } from '@mushee/playback/MidiPlayer'
import type { ScoreScheduler } from '@mushee/playback/ScoreScheduler'
import type { Tickable } from '@mushee/playback/Ticker'

/** The cursor's fill per mode: the editor's interaction blue while playing, red while a take records. */
const TONE_FILL = { playback: INTERACTION_BLUE, recording: '#ef4444' } as const

export type PlaybackCursorTone = keyof typeof TONE_FILL

/**
 * The score's playback cursor — the one writer of its SVG rect, for playback
 * and recording alike. Positions come from the score's layout
 * (`ScoreLayout.pointAtBeat`); the rect's `x`, `transform` and `display` are
 * written in exactly the form Score.tsx's MutationObserver parses to keep the
 * cursor scrolled into view.
 *
 * As a Tickable it follows a playback pass: each frame it moves to the
 * scheduler's position on the shared clock, and hides once the pass has
 * played out.
 */
export class PlaybackCursor implements Tickable {
    private el: SVGRectElement | null = null
    /** The score the playback pass in flight plays; see follow(). */
    private followed: Score | null = null

    constructor(
        private readonly midiPlayer: Pick<MidiPlayer, 'currentTime'>,
        private readonly scheduler: Pick<ScoreScheduler, 'positionAt' | 'hasFinishedAt'>,
    ) {}

    /** Draw into `el` from now on (null detaches: every write becomes a no-op). */
    attach(el: SVGRectElement | null): void {
        this.el = el
    }

    /** Make tick() follow the scheduler's pass over `score`. */
    follow(score: Score): void {
        this.followed = score
    }

    /** Show the cursor at `beat` of measure `measureIndex`; a measure the score no longer has hides it. */
    moveTo(score: Score, measureIndex: number, beat: number): void {
        const measure = score.measures[measureIndex]
        if (!measure) {
            this.hide()
            return
        }
        const { x, rowY } = score.layout.pointAtBeat(measure, beat)
        // The rect is 3 units wide; centre it on the beat.
        this.el?.setAttribute('x', String(x - 1.5))
        this.el?.setAttribute('transform', `translate(0, ${rowY})`)
        this.el?.setAttribute('display', '')
    }

    hide(): void {
        this.el?.setAttribute('display', 'none')
    }

    setTone(tone: PlaybackCursorTone): void {
        this.el?.setAttribute('fill', TONE_FILL[tone])
    }

    /** Fade the cursor to `opacity` (0..1); null returns it to fully opaque. */
    setOpacity(opacity: number | null): void {
        if (opacity === null) this.el?.removeAttribute('fill-opacity')
        else this.el?.setAttribute('fill-opacity', opacity.toFixed(3))
    }

    tick(): boolean {
        const elapsed = this.midiPlayer.currentTime
        const pos = this.scheduler.positionAt(elapsed)
        if (pos && this.followed) this.moveTo(this.followed, pos.measureIndex, pos.beat)

        if (this.scheduler.hasFinishedAt(elapsed)) {
            this.hide()
            return true
        }
        return false
    }
}
