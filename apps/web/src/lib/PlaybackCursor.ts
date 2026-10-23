import { INTERACTION_BLUE, RECORDING_CURSOR_RED } from '@mushee/notation/components'
import type { Score } from '@mushee/notation/model'
import type { MidiPlayer } from '@mushee/playback/MidiPlayer'
import type { ScoreScheduler } from '@mushee/playback/ScoreScheduler'
import type { Tickable } from '@mushee/playback/Ticker'

/** The cursor's fill per mode: the editor's interaction blue while playing, red while a take records. */
const TONE_FILL = { playback: INTERACTION_BLUE, recording: RECORDING_CURSOR_RED } as const

export type PlaybackCursorTone = keyof typeof TONE_FILL

/**
 * The score's playback cursor — the one writer of its SVG playhead group (a
 * line with a round head, centred on x = 0; see ScoreView), for playback and
 * recording alike. Positions come from the score's layout
 * (`ScoreLayout.pointAtBeat`); the group's `transform` and `display` are
 * written in exactly the form the scroll-follow observer parses — the
 * MutationObserver in @mushee/notation's lib/useScrollFollow.ts, used by
 * ScoreView — to keep the cursor scrolled into view. Its `fill` and
 * `fill-opacity` go on the group too, and both parts inherit them.
 *
 * As a Tickable it follows a playback pass: each frame it moves to the
 * scheduler's position on the shared clock, and hides once the pass has
 * played out.
 */
export class PlaybackCursor implements Tickable {
    private el: SVGGElement | null = null
    /** The score the playback pass in flight plays; see follow(). */
    private followed: Score | null = null

    constructor(
        private readonly midiPlayer: Pick<MidiPlayer, 'currentTime'>,
        private readonly scheduler: Pick<ScoreScheduler, 'positionAt' | 'hasFinishedAt'>,
    ) {}

    /** Draw into `el` from now on (null detaches: every write becomes a no-op). */
    attach(el: SVGGElement | null): void {
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
        // The playhead is drawn centred on its own x = 0: the translate puts it on the beat.
        this.el?.setAttribute('transform', `translate(${x}, ${rowY})`)
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
