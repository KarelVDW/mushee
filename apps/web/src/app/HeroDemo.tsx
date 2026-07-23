'use client'

import { Glyph, INTERACTION_BLUE } from '@mushee/notation/components'
import { useEffect, useState } from 'react'

/**
 * The hero demo: an idealised loop of a real recording session in the Solkey
 * editor — the recording cursor sweeps the staff, live waveform bars (the
 * editor's cyan/magenta) sprout under it, and a strict beat-and-a-half later
 * each beat's bars burst away as clean engraved notation takes their place.
 * The melody is Frère Jacques (Broeder Jakob). Everything is driven by one
 * generated CSS timeline so the loop is smooth and cheap; the REC clock is the
 * only JS ticker. Respects prefers-reduced-motion by showing the finished sheet.
 */

// --- The score: two measures of Frère Jacques in C, staff lines at y 55..95 ---

interface DemoNote {
    x: number
    /** Vertical center of the notehead (10px staff spacing, like the editor). */
    cy: number
    /** Beats this note lasts (quarter = 1). */
    beats: number
    half?: boolean
    /** Middle C sits on a ledger line below the staff. */
    ledger?: boolean
}

// C D E C | E F G(half) — "Frè-re Jac-ques, dor-mez vous"
const NOTES: DemoNote[] = [
    { x: 116, cy: 105, beats: 1, ledger: true },
    { x: 176, cy: 100, beats: 1 },
    { x: 236, cy: 95, beats: 1 },
    { x: 296, cy: 105, beats: 1, ledger: true },
    { x: 392, cy: 95, beats: 1 },
    { x: 458, cy: 90, beats: 1 },
    { x: 524, cy: 85, beats: 2, half: true },
]

// --- Timeline (ms within one loop) ---

const LOOP_MS = 9500
const SWEEP_START = 300
const BEAT_MS = 550
const TOTAL_BEATS = 8
const SWEEP_END = SWEEP_START + TOTAL_BEATS * BEAT_MS // 4700
/** The transcription lag: waveform holds the stage this long before notes replace it. */
const TRANSCRIBE_DELAY = 1500

const CURSOR_X0 = 95
const CURSOR_X1 = 624

const noteOnsets = NOTES.map((_, i) => SWEEP_START + NOTES.slice(0, i).reduce((b, n) => b + n.beats, 0) * BEAT_MS)
const noteLands = noteOnsets.map((t) => t + TRANSCRIBE_DELAY)

const pct = (ms: number) => `${((ms / LOOP_MS) * 100).toFixed(2)}%`

// --- Waveform bars: a handful per beat, alternating the two brand neons ---

interface DemoBar {
    x: number
    h: number
    color: string
    inMs: number
    outMs: number
    name: string
}

const BAR_HEIGHTS = [22, 38, 28, 46, 32, 42]
const BARS: DemoBar[] = NOTES.flatMap((note, i) => {
    const count = note.beats === 2 ? 6 : 4
    return Array.from({ length: count }, (_, k) => ({
        x: note.x - 10 + k * 13,
        h: BAR_HEIGHTS[(i + k) % BAR_HEIGHTS.length],
        color: (i * 4 + k) % 2 === 0 ? '#00DBE9' : '#FF2079',
        inMs: noteOnsets[i] + k * ((note.beats * BEAT_MS - 120) / count),
        outMs: noteLands[i] + k * 30,
        name: `demo-bar-${i}-${k}`,
    }))
})

// --- Generated keyframes: every element gets a window on the shared loop ---

const TIMELINE_CSS = [
    // Recording cursor: sweep the staff during the take, then get out of the way.
    `@keyframes demo-cursor {
        0% { transform: translateX(${CURSOR_X0}px); opacity: 0; }
        ${pct(SWEEP_START)} { transform: translateX(${CURSOR_X0}px); opacity: 1; }
        ${pct(SWEEP_END)} { transform: translateX(${CURSOR_X1}px); opacity: 1; }
        ${pct(SWEEP_END + 250)} { transform: translateX(${CURSOR_X1}px); opacity: 0; }
        100% { transform: translateX(${CURSOR_X1}px); opacity: 0; }
    }`,
    // Each note fades in the moment "its" waveform hands over, settles 3px down.
    ...NOTES.map(
        (_, i) => `@keyframes demo-note-${i} {
        0%, ${pct(noteLands[i])} { opacity: 0; transform: translateY(-3px); }
        ${pct(noteLands[i] + 240)}, 97% { opacity: 1; transform: translateY(0); }
        100% { opacity: 0; transform: translateY(0); }
    }`,
    ),
    // Each waveform bar sprouts as the cursor passes and bursts out at handover.
    ...BARS.map(
        (bar) => `@keyframes ${bar.name} {
        0%, ${pct(bar.inMs)} { opacity: 0; }
        ${pct(bar.inMs + 140)} { opacity: 1; }
        ${pct(bar.outMs)} { opacity: 1; }
        ${pct(bar.outMs + 180)}, 100% { opacity: 0; }
    }`,
    ),
    // Input level meter: alive while the take runs, idle stubs afterwards.
    `@keyframes demo-meter {
        0%, ${pct(SWEEP_START)} { transform: scaleY(0.18); }
        ${pct(SWEEP_START + 400)} { transform: scaleY(1); }
        ${pct(SWEEP_END)} { transform: scaleY(1); }
        ${pct(SWEEP_END + 500)}, 100% { transform: scaleY(0.18); }
    }`,
    `@keyframes demo-meter-sway {
        0%, 100% { transform: scaleY(1); }
        50% { transform: scaleY(0.55); }
    }`,
    // Chrome chips: REC during the take (+ its trailing transcription), then Saved.
    `@keyframes demo-chip-rec {
        0%, ${pct(noteLands[NOTES.length - 1] + 300)} { opacity: 1; }
        ${pct(noteLands[NOTES.length - 1] + 700)}, 96% { opacity: 0; }
        100% { opacity: 1; }
    }`,
    `@keyframes demo-chip-saved {
        0%, ${pct(noteLands[NOTES.length - 1] + 500)} { opacity: 0; }
        ${pct(noteLands[NOTES.length - 1] + 900)}, 96% { opacity: 1; }
        100% { opacity: 0; }
    }`,
    `@keyframes hero-rec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`,
].join('\n')

const WAVE_PATTERN = [6, 14, 9, 18, 11, 22, 8, 16, 12, 20, 7, 15, 10, 19, 13, 9, 17, 8, 21, 11, 14, 7, 18, 10, 16, 9, 13, 6]

const loopAnim = (name: string, extra = ''): React.CSSProperties => ({
    animation: `${name} ${LOOP_MS}ms linear infinite${extra}`,
})

export function HeroDemo() {
    // `animate` flips on after mount (and only without prefers-reduced-motion);
    // until then the finished sheet shows, which is also the SSR/no-motion state.
    const [animate, setAnimate] = useState(false)
    const [seconds, setSeconds] = useState(0)

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        setAnimate(true)
        const start = Date.now()
        const timer = setInterval(() => setSeconds(Math.floor(((Date.now() - start) % LOOP_MS) / 1000)), 250)
        return () => clearInterval(timer)
    }, [])

    return (
        <div className="flex flex-col gap-3">
            <div className="bg-surface-container-lowest rounded-lg editorial-shadow p-6 -rotate-[1.5deg]" aria-hidden>
                {/* Editor chrome: window dots + live REC state / saved state */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex gap-1.5">
                        {[0, 1, 2].map((i) => (
                            <span key={i} className="w-2.5 h-2.5 rounded-full bg-surface-container-high" />
                        ))}
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="font-mono text-[12px] leading-none text-on-surface-variant">♩ = 110</span>
                        <span className="relative">
                            <span
                                className="inline-flex items-center gap-1.5 bg-error-container/15 rounded-full px-2.5 py-1.5"
                                style={animate ? loopAnim('demo-chip-rec') : { opacity: 0 }}>
                                <span
                                    className="w-2 h-2 rounded-full bg-error-container"
                                    style={animate ? { animation: 'hero-rec-pulse 1.2s ease-in-out infinite' } : undefined}
                                />
                                <span className="font-label font-semibold text-[10px] leading-none tracking-[0.14em] uppercase text-on-surface">
                                    Rec
                                </span>
                                <span className="font-mono text-[11px] leading-none text-on-surface-variant">
                                    0:{String(seconds).padStart(2, '0')}
                                </span>
                            </span>
                            <span
                                className="absolute inset-y-0 right-0 inline-flex items-center gap-1.5 bg-primary-soft/60 rounded-full px-2.5 py-1.5 whitespace-nowrap"
                                style={animate ? loopAnim('demo-chip-saved') : undefined}>
                                <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.5}>
                                    <path d="M20 6 9 17l-5-5" />
                                </svg>
                                <span className="font-label font-semibold text-[10px] leading-none tracking-[0.14em] uppercase text-on-surface">
                                    Saved
                                </span>
                            </span>
                        </span>
                    </div>
                </div>

                {/* The staff: waveform lands under the cursor, notation follows a beat behind */}
                <svg viewBox="0 0 640 165" width="100%">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <line key={i} x1={16} x2={624} y1={55 + i * 10} y2={55 + i * 10} stroke="var(--color-on-surface)" strokeWidth={1} />
                    ))}
                    {/* Barlines: mid measure + final (thin + thick, like the editor) */}
                    <line x1={344} x2={344} y1={55} y2={95} stroke="var(--color-on-surface)" strokeWidth={1} />
                    <line x1={617} x2={617} y1={55} y2={95} stroke="var(--color-on-surface)" strokeWidth={1} />
                    <line x1={622.5} x2={622.5} y1={55} y2={95} stroke="var(--color-on-surface)" strokeWidth={3} />
                    <Glyph name="gClef" x={26} y={85} fill="var(--color-on-surface)" />
                    <Glyph name="timeSig4" x={62} y={65} fill="var(--color-on-surface)" />
                    <Glyph name="timeSig4" x={62} y={85} fill="var(--color-on-surface)" />

                    {/* Live waveform bars — the editor's transient cyan/magenta layer */}
                    {animate &&
                        BARS.map((bar) => (
                            <g key={bar.name} style={loopAnim(bar.name)} opacity={0}>
                                <rect
                                    className="waveform-bar"
                                    x={bar.x}
                                    y={75 - bar.h / 2}
                                    width={3.5}
                                    height={bar.h}
                                    rx={1.4}
                                    fill={bar.color}
                                />
                            </g>
                        ))}

                    {/* The engraved result, landing a strict beat-and-a-half after the sound */}
                    {NOTES.map((note, i) => (
                        <g key={note.x} style={animate ? loopAnim(`demo-note-${i}`) : undefined} opacity={animate ? 0 : 1}>
                            {note.ledger && (
                                <line x1={note.x - 4} x2={note.x + 14.5} y1={105} y2={105} stroke="var(--color-on-surface)" strokeWidth={1} />
                            )}
                            <Glyph name={note.half ? 'noteheadHalf' : 'noteheadBlack'} x={note.x} y={note.cy} fill="var(--color-on-surface)" />
                            <line
                                x1={note.x + 10.1}
                                x2={note.x + 10.1}
                                y1={note.cy - 1}
                                y2={note.cy - 33}
                                stroke="var(--color-on-surface)"
                                strokeWidth={1.3}
                            />
                        </g>
                    ))}

                    {/* Recording cursor */}
                    {animate && (
                        <g style={loopAnim('demo-cursor')} opacity={0}>
                            <line x1={0} x2={0} y1={42} y2={112} stroke={INTERACTION_BLUE} strokeWidth={2.5} />
                            <circle cx={0} cy={42} r={3.5} fill={INTERACTION_BLUE} />
                        </g>
                    )}
                </svg>

                {/* Input level meter */}
                <div className="flex items-end gap-0.75 h-6 mt-3" role="presentation">
                    {WAVE_PATTERN.map((h, i) => (
                        <span
                            key={i}
                            className="origin-bottom"
                            style={{
                                width: 4,
                                height: h,
                                ...(animate
                                    ? { animation: `demo-meter ${LOOP_MS}ms linear infinite`, animationDelay: `${i * 30}ms` }
                                    : { transform: 'scaleY(0.18)' }),
                            }}>
                            <span
                                className="block w-full h-full origin-bottom rounded-full bg-primary-container"
                                style={
                                    animate
                                        ? { animation: `demo-meter-sway ${900 + (i % 5) * 120}ms ease-in-out infinite` }
                                        : undefined
                                }
                            />
                        </span>
                    ))}
                </div>
            </div>
            <style>{TIMELINE_CSS}</style>
        </div>
    )
}
