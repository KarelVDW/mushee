import { Glyph, RECORDING_CURSOR_RED, WAVEFORM_COLORS } from '@mushee/notation/components'
import type { CSSProperties, ReactNode } from 'react'

import { Icon } from '@/components/ui'

/**
 * The demo sheet: a small, idealised Solkey editor drawn in code — the score's title, the
 * REC/Saved chip, a staff of Frère Jacques (Broeder Jakob) and the input meter. The landing
 * hero plays a recording take on it (see HeroDemo); the auth pages and the How it works tiles
 * show it still. Everything on it is the product's own language: the editor's notation ink,
 * the recording red cursor, the waveform's cyan/magenta bars that rise in and burst into the
 * notes replacing them, the icon set's check.
 *
 * The take is one generated CSS timeline on a shared loop, so it is smooth and cheap. It starts
 * at HANDOFF_MS — the finished sheet, Saved showing — which is also the server render, the
 * paused frame and the reduced-motion frame, so nothing on screen changes when the loop takes
 * over after hydration: the sheet holds, fades out, and the take replays.
 */

// --- The score: two measures of Frère Jacques in C, staff lines at y 55..95 ---

export interface DemoNote {
    x: number
    /** Vertical center of the notehead (10px staff spacing, like the editor). */
    cy: number
    /** Beats this note lasts (quarter = 1); a 2-beat note is drawn as a half note. */
    beats: number
    /** Middle C sits on a ledger line below the staff. */
    ledger?: boolean
}

// C D E C | E F G(half) — "Frè-re Jac-ques, dor-mez vous"
const NOTES: readonly DemoNote[] = [
    { x: 116, cy: 105, beats: 1, ledger: true },
    { x: 176, cy: 100, beats: 1 },
    { x: 236, cy: 95, beats: 1 },
    { x: 296, cy: 105, beats: 1, ledger: true },
    { x: 392, cy: 95, beats: 1 },
    { x: 458, cy: 90, beats: 1 },
    { x: 524, cy: 85, beats: 2 },
]

/** The hero staff's frame: the staff spans x 16..624 and y 55..95, notes and the cursor reach y 38..112. */
const HERO_VIEWBOX = '8 34 624 84'
const STAFF_TOP = 55
const STAFF_SPACE = 10
const INK = 'var(--color-on-surface)'

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

/**
 * Where the loop starts: a second after the last note landed — every note on the staff, Saved
 * showing, the meter idle. The same frame as the static sheet, so motion can take over from it.
 */
const HANDOFF_MS = noteLands[NOTES.length - 1] + 1000

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
/** A bar bursts to the tallest bar's height as it hands over — the editor waveform's rule (MAX_RADIUS / radius). */
const MAX_BAR_H = Math.max(...BAR_HEIGHTS)
/** The waveform's centre line: the staff's middle line. */
const WAVE_MID = 75

const BARS: DemoBar[] = NOTES.flatMap((note, i) => {
    const count = note.beats === 2 ? 6 : 4
    return Array.from({ length: count }, (_, k) => ({
        x: note.x - 10 + k * 13,
        h: BAR_HEIGHTS[(i + k) % BAR_HEIGHTS.length],
        color: WAVEFORM_COLORS[(i * 4 + k) % WAVEFORM_COLORS.length],
        inMs: noteOnsets[i] + k * ((note.beats * BEAT_MS - 120) / count),
        outMs: noteLands[i] + k * 30,
        name: `demo-bar-${i}-${k}`,
    }))
})

// --- Generated keyframes: every element gets a window on the shared loop ---

/** The take's keyframes; render them once beside an animated DemoCard (`<style>{DEMO_TIMELINE_CSS}</style>`). */
export const DEMO_TIMELINE_CSS = [
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
    // Each waveform bar rises in from its centre as the cursor passes (the editor's 0.55), then
    // bursts to the tallest bar's height while it fades at handover — the editor's own motion.
    ...BARS.map(
        (bar) => `@keyframes ${bar.name} {
        0%, ${pct(bar.inMs)} { opacity: 0; transform: scaleY(0); }
        ${pct(bar.inMs + 140)}, ${pct(bar.outMs)} { opacity: 0.55; transform: scaleY(1); }
        ${pct(bar.outMs + 180)}, 100% { opacity: 0; transform: scaleY(${(MAX_BAR_H / bar.h).toFixed(3)}); }
    }`,
    ),
    // Input level meter: the live cyan bars grow while the take runs and sink back after, leaving the idle stubs.
    `@keyframes demo-meter {
        0%, ${pct(SWEEP_START)} { transform: scaleY(0); }
        ${pct(SWEEP_START + 400)} { transform: scaleY(1); }
        ${pct(SWEEP_END)} { transform: scaleY(1); }
        ${pct(SWEEP_END + 500)}, 100% { transform: scaleY(0); }
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

/** The REC clock's reading `elapsedMs` after the loop took over (it starts at the handoff, not at zero). */
export function demoClockSeconds(elapsedMs: number): number {
    return Math.floor(((elapsedMs + HANDOFF_MS) % LOOP_MS) / 1000)
}

/**
 * One element's window on the shared loop, entered at the handoff frame (a negative delay), `offsetMs`
 * later. One shorthand, delay included: React must never see it mixed with a longhand.
 */
const loopAnim = (name: string, offsetMs = 0): CSSProperties => ({
    animation: `${name} ${LOOP_MS}ms linear ${offsetMs - HANDOFF_MS}ms infinite`,
})

const WAVE_PATTERN = [6, 14, 9, 18, 11, 22, 8, 16, 12, 20, 7, 15, 10, 19, 13, 9, 17, 8, 21, 11, 14, 7, 18, 10, 16, 9, 13, 6]

// --- Pieces ---

/** One engraved note in notation ink: the notehead, its up-stem, and middle C's ledger line. */
function EngravedNote({ note }: { note: DemoNote }) {
    return (
        <>
            {note.ledger && <line x1={note.x - 4} x2={note.x + 14.5} y1={105} y2={105} stroke={INK} strokeWidth={1} />}
            <Glyph name={note.beats === 2 ? 'noteheadHalf' : 'noteheadBlack'} x={note.x} y={note.cy} fill={INK} />
            <line x1={note.x + 10.1} x2={note.x + 10.1} y1={note.cy - 1} y2={note.cy - 33} stroke={INK} strokeWidth={1.3} />
        </>
    )
}

/** The recording cursor at x 0 (place it with a transform): the editor's red line with its round head. */
export function DemoRecordingCursor({ x = 0, style }: { x?: number; style?: CSSProperties }) {
    return (
        <g style={style} opacity={style ? 0 : undefined} transform={style ? undefined : `translate(${x} 0)`}>
            <line x1={0} x2={0} y1={42} y2={112} stroke={RECORDING_CURSOR_RED} strokeWidth={2.5} />
            <circle cx={0} cy={42} r={3.5} fill={RECORDING_CURSOR_RED} />
        </g>
    )
}

/** A still waveform bar on the staff's middle line, at the editor's 0.55. */
export function DemoWaveformBar({ x, h, index }: { x: number; h: number; index: number }) {
    return (
        <rect
            x={x}
            y={WAVE_MID - h / 2}
            width={3.5}
            height={h}
            rx={1.4}
            fill={WAVEFORM_COLORS[index % WAVEFORM_COLORS.length]}
            opacity={0.55}
        />
    )
}

/** The waveform bars' heights, for a still fragment drawn from the same set as the take. */
export const DEMO_BAR_HEIGHTS: readonly number[] = BAR_HEIGHTS

interface DemoStaffProps {
    /** Play the hero's take over the staff (cursor, rising and bursting bars, notes landing); off, the finished sheet. */
    animate?: boolean
    /** The notes to engrave; the hero's two bars of Frère Jacques by default. */
    notes?: readonly DemoNote[]
    /** The staff's left and right ends. */
    from?: number
    to?: number
    /** Inner barlines' x positions. */
    barlines?: readonly number[]
    /** The clef, the time signature and the final barline (the full staff); a fragment goes without. */
    framed?: boolean
    /** The SVG's frame, cropped to the drawing. */
    viewBox?: string
    className?: string
    /** Still marks drawn over the staff lines and under the notes: a selection band, waveform bars, the cursor. */
    children?: ReactNode
}

/**
 * The demo's staff, in the editor's notation ink and 10px staff spacing. The default is the hero's
 * two bars, framed and cropped to its content; the How it works tiles draw fragments of it. The
 * take (`animate`) only ever plays over the hero's own notes.
 */
export function DemoStaff({
    animate = false,
    notes = NOTES,
    from = 16,
    to = 624,
    barlines = [344],
    framed = true,
    viewBox = HERO_VIEWBOX,
    className,
    children,
}: DemoStaffProps) {
    const playing = animate && notes === NOTES
    return (
        <svg viewBox={viewBox} width="100%" className={className} aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
                <line
                    key={i}
                    x1={from}
                    x2={to}
                    y1={STAFF_TOP + i * STAFF_SPACE}
                    y2={STAFF_TOP + i * STAFF_SPACE}
                    stroke={INK}
                    strokeWidth={1}
                />
            ))}
            {barlines.map((x) => (
                <line key={x} x1={x} x2={x} y1={55} y2={95} stroke={INK} strokeWidth={1} />
            ))}
            {framed && (
                <>
                    {/* The final barline: thin + thick, like the editor. */}
                    <line x1={to - 7} x2={to - 7} y1={55} y2={95} stroke={INK} strokeWidth={1} />
                    <line x1={to - 1.5} x2={to - 1.5} y1={55} y2={95} stroke={INK} strokeWidth={3} />
                    <Glyph name="gClef" x={from + 10} y={85} fill={INK} />
                    <Glyph name="timeSig4" x={from + 46} y={65} fill={INK} />
                    <Glyph name="timeSig4" x={from + 46} y={85} fill={INK} />
                </>
            )}

            {children}

            {/* Live waveform bars — the editor's transient cyan/magenta layer, rising from and bursting about their own centres. */}
            {playing &&
                BARS.map((bar) => (
                    <rect
                        key={bar.name}
                        className="waveform-bar"
                        x={bar.x}
                        y={WAVE_MID - bar.h / 2}
                        width={3.5}
                        height={bar.h}
                        rx={1.4}
                        fill={bar.color}
                        style={loopAnim(bar.name)}
                    />
                ))}

            {/* The engraved result, landing about 1.5 s (under three beats) after the sound */}
            {notes.map((note, i) => (
                <g key={note.x} style={playing ? loopAnim(`demo-note-${i}`) : undefined} opacity={playing ? 0 : 1}>
                    <EngravedNote note={note} />
                </g>
            ))}

            {playing && <DemoRecordingCursor style={loopAnim('demo-cursor')} />}
        </svg>
    )
}

/** The editor header's 'Saved' state as a chip: the icon set's check and the label. */
export function DemoSavedChip({ className, style }: { className?: string; style?: CSSProperties }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 bg-primary-soft/60 text-on-surface rounded-full px-2.5 py-1.5 whitespace-nowrap ${className ?? ''}`}
            style={style}>
            <Icon name="check" size={12} />
            <span className="font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase">Saved</span>
        </span>
    )
}

/** The editor-like card the take plays in: the score's title and the REC/Saved chip, the staff, the input meter. */
export function DemoCard({ animate, seconds }: { animate: boolean; seconds: number }) {
    return (
        <>
            {/* The editor header's layout: the score's title on the left, its live state on the right. */}
            <div className="flex items-center justify-between gap-3 mb-3">
                <span className="font-headline font-semibold text-[14px] leading-none text-on-surface">Frère Jacques</span>
                <span className="relative">
                    <span
                        className="inline-flex items-center gap-1.5 bg-record/10 rounded-full px-2.5 py-1.5"
                        style={animate ? loopAnim('demo-chip-rec') : { opacity: 0 }}>
                        <span
                            className="w-2 h-2 rounded-full bg-record"
                            style={animate ? { animation: 'hero-rec-pulse 1.2s ease-in-out infinite' } : undefined}
                        />
                        <span className="font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface">
                            Rec
                        </span>
                        <span className="font-mono text-[11px] leading-none text-on-surface-variant">
                            0:{String(seconds).padStart(2, '0')}
                        </span>
                    </span>
                    <DemoSavedChip className="absolute inset-y-0 right-0" style={animate ? loopAnim('demo-chip-saved') : undefined} />
                </span>
            </div>

            {/* The staff: waveform lands under the cursor, notation follows about 1.5 s behind */}
            <DemoStaff animate={animate} />

            {/* Input level meter: uniform 3px idle stubs; only the live bars, while the take runs, are cyan. */}
            <div className="flex items-end gap-0.75 h-6 mt-3" role="presentation">
                {WAVE_PATTERN.map((h, i) => (
                    <span key={i} className="relative w-1 h-full">
                        <span className="absolute inset-x-0 bottom-0 h-0.75 rounded-full bg-surface-container-high" />
                        {animate && (
                            <span
                                className="absolute inset-x-0 bottom-0 origin-bottom"
                                style={{ height: h, ...loopAnim('demo-meter', i * 30) }}>
                                <span
                                    className="block w-full h-full origin-bottom rounded-full bg-primary-container"
                                    style={{ animation: `demo-meter-sway ${900 + (i % 5) * 120}ms ease-in-out infinite` }}
                                />
                            </span>
                        )}
                    </span>
                ))}
            </div>
        </>
    )
}

/**
 * The finished sheet as a still card (the auth pages' picture of the product): the hero's card,
 * resting, slightly turned. Decorative.
 */
export function DemoSheetStill() {
    return (
        <div aria-hidden className="bg-surface-container-lowest rounded-lg tonal-layer-glow p-5 -rotate-[1.5deg]">
            <DemoCard animate={false} seconds={8} />
        </div>
    )
}
