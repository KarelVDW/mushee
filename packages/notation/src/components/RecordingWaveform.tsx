'use client'

import { useSyncExternalStore } from 'react'

import type { RecordingWaveformStore } from '../lib/RecordingWaveformStore'
import type { Score as ScoreModel } from '../model'
import { Staff } from '../model/layout/Staff'
import { HIGHLIGHT_MAGENTA, WAVEFORM_CYAN } from './constants'

/** Brand accents (loud tier) — one of the two sanctioned brand-accent exceptions inside the canvas (see constants.ts). */
const BAR_COLORS = [WAVEFORM_CYAN, HIGHLIGHT_MAGENTA]
const BAR_WIDTH = 2.5
/** Tallest bar: half the staff height on either side of the middle line. */
const MAX_RADIUS = Staff.HEIGHT / 2
/** Bars shorter than this still read as a heartbeat during silence. */
const MIN_RADIUS = 1.5

/**
 * The live recording waveform: one brand-colored bar per amplitude sample,
 * anchored to the score position it was sung at. Subscribes to the store
 * directly so 30Hz sample updates re-render only this layer.
 *
 * Bars breathe while they wait (subtle sway), and once the transcription of
 * their moment lands on the staff they exit: grow to the full staff height,
 * fade, and hand the pixels over to the notes that replaced them.
 * Positions resolve at render time from the live layout, so bars stay glued
 * to their beat when rows reflow as measures fill up.
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
                const radius = Math.max(MIN_RADIUS, bar.amp * MAX_RADIUS)
                // The exit grows the bar to the full staff height before fading.
                const burstScale = MAX_RADIUS / radius
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
                        fill={BAR_COLORS[bar.seq % BAR_COLORS.length]}
                        onAnimationEnd={bar.exiting ? () => store.remove(bar.id) : undefined}
                    />
                )
            })}
        </g>
    )
}
