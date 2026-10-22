'use client'

import { useSyncExternalStore } from 'react'

import type { RecordingWaveformStore } from '../lib/RecordingWaveformStore'
import type { Score as ScoreModel } from '../model'
import { Staff } from '../model/layout/Staff'
import { WAVEFORM_COLORS } from './constants'

const BAR_WIDTH = 2.5
/** Tallest bar: half the staff height on either side of the middle line. */
const MAX_RADIUS = Staff.HEIGHT / 2

/**
 * The live recording waveform: one brand-colored bar per amplitude sample,
 * anchored to the score position it was sung at, its height in proportion to
 * the sample's loudness. Subscribes to the store directly so 30Hz sample
 * updates re-render only this layer. Silence draws nothing — the host leaves
 * quiet samples out of the store (a bar that never enters can't leak), so a
 * pause never reads as a dotted rule through the staff.
 *
 * Bars rise in and then wait, still; once the transcription of their moment
 * lands on the staff they exit: grow to the full staff height, fade, and hand
 * the pixels over to the notes that replaced them.
 * Positions resolve at render time from the live layout, so bars stay glued
 * to their beat when rows reflow as measures fill up.
 *
 * The motion is the host's CSS, not this package's: the `.waveform-bar` /
 * `.waveform-bar-exit` classes, their keyframes and the `--waveform-burst`
 * factor live in apps/web/src/app/globals.css (shared with the landing-page
 * demo). The exit animation's `animationend → store.remove` is the only path
 * that drops an exiting bar, so a host without those styles leaks bars —
 * any new host must import them.
 */
export function RecordingWaveform({ store, score }: { store: RecordingWaveformStore; score: ScoreModel }) {
    const bars = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
    if (!bars.length) return null

    return (
        <g data-export-exclude>
            {bars.map((bar) => {
                const measure = score.measures[bar.measureIndex]
                if (!measure) return null
                const { x, rowY } = score.layout.pointAtBeat(measure, bar.beat)
                const y = rowY + Staff.MIDDLE_Y
                const radius = bar.amp * MAX_RADIUS
                // The exit grows the bar to the full staff height before fading.
                const burstScale = radius > 0 ? MAX_RADIUS / radius : 1
                return (
                    <rect
                        key={bar.id}
                        className={bar.exiting ? 'waveform-bar waveform-bar-exit' : 'waveform-bar'}
                        style={bar.exiting ? ({ '--waveform-burst': burstScale } as React.CSSProperties) : undefined}
                        x={x - BAR_WIDTH / 2}
                        y={y - radius}
                        width={BAR_WIDTH}
                        height={radius * 2}
                        rx={BAR_WIDTH / 2}
                        fill={WAVEFORM_COLORS[bar.seq % WAVEFORM_COLORS.length]}
                        onAnimationEnd={bar.exiting ? () => store.remove(bar.id) : undefined}
                    />
                )
            })}
        </g>
    )
}
