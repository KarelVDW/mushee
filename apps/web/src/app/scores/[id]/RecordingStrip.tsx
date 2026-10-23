'use client'

import { useEffect, useState } from 'react'

import { formatRecordingTime } from '@/lib/recordingTime'

import { type RecordingStatus, RecordingStripCopy, type StripHint } from './RecordingCopy'

/** Whole seconds since `startedAt` (a `performance.now()` reading), ticking once a second; 0 until it is set. */
function useElapsedSeconds(startedAt: number | null): number {
    const [now, setNow] = useState(() => performance.now())
    useEffect(() => {
        if (startedAt === null) return
        setNow(performance.now())
        const timer = setInterval(() => setNow(performance.now()), 250)
        return () => clearInterval(timer)
    }, [startedAt])
    return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))
}

/**
 * The count-in: one dot per felt pulse of the bar, there (hollow) from the first frame and each
 * filling with the recording red on its click — a ring, then a disc, so the count never rides
 * on colour alone. The slot grows with the count (5 in 5/4), right-aligned against the label.
 */
function CountoffDots({ countoff }: { countoff: RecordingStatus['countoff'] }) {
    return (
        <span className="min-w-12 flex justify-end gap-2">
            {Array.from({ length: countoff?.total ?? 0 }, (_, i) => (
                <span
                    key={i}
                    className={[
                        'size-2.5 shrink-0 rounded-full ring-[1.5px] ring-inset',
                        'motion-safe:transition-[background-color,box-shadow] motion-safe:duration-150 ease-solkey',
                        // Unfilled: an `outline` ring (4.5:1 on the white well), so the count reads before the clicks fill it.
                        countoff && i <= countoff.beat ? 'bg-record ring-record' : 'bg-transparent ring-outline',
                    ].join(' ')}
                />
            ))}
        </span>
    )
}

function HintLine({ hint }: { hint: StripHint }) {
    const quiet = 'max-w-full font-body font-normal text-[13px] leading-tight text-on-surface-variant'
    if (hint.kind === 'stop') {
        // The record-as-stop button in miniature — a white rounded square on a red disc, as the
        // live button draws it (RecordGlyph) — so the line points at that button, never at an
        // outlined playback Stop. Sized to the text and centred on it.
        const glyph = (
            <span className="inline-flex align-middle -translate-y-px">
                <span aria-hidden className="inline-flex size-[1.05em] items-center justify-center rounded-full bg-record">
                    <span className="size-1.25 rounded-[1.5px] bg-on-record" />
                </span>
                <span className="sr-only">the stop button</span>
            </span>
        )
        return <p className={`m-0 truncate ${quiet}`}>{hint.touch ? <>Tap {glyph} to stop</> : <>Press Space or {glyph} to stop</>}</p>
    }
    // A transcription warning may run to two lines on a phone (never more: RecordingStripCopy.WARNING),
    // balanced so no word is left alone on the second; everything else is one.
    if (hint.kind === 'warning') {
        return (
            <p className="m-0 max-w-full font-body font-medium text-[13px] leading-snug text-on-surface text-center text-balance">
                {hint.text}
            </p>
        )
    }
    return <p className={`m-0 truncate ${quiet}`}>{hint.text}</p>
}

/**
 * The one recording status surface (contract C10): for the length of a take it stands in for
 * the dock's tool wells — a white capsule well on the dock's chrome. One stable two-line
 * layout: the state row ('[dots] Get ready  from bar 3' through the count-in, then '[live dot]
 * Recording 0:00') over one hint line — how to stop, how much of today is left, or what the
 * server's transcription is doing — or an empty spacer of the same height, so the state word
 * holds its place at the downbeat. The engine's own clock fills the count-in's dots. Screen
 * readers hear the state changes once, through the editor's announcer (contract C11); the
 * strip's own polite status carries only the transcription news, and the elapsed clock stays
 * silent.
 */
export function RecordingStrip({ status, touch }: { status: RecordingStatus; touch: boolean }) {
    const elapsed = useElapsedSeconds(status.captureStartedAt)
    const copy = new RecordingStripCopy(status, elapsed, touch)
    const hint = copy.hint
    return (
        <div
            role="group"
            aria-label="Recording status"
            data-export-exclude
            className={[
                // Two rows: the state (20px) over the hint (16px; a two-line warning grows it).
                'grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[20px_minmax(16px,auto)] content-center justify-items-center gap-1',
                'rounded-[28px] px-5 py-2 bg-surface-container-lowest tonal-layer-glow',
                // Desktop: the strip fades in as it replaces the wells (at once under reduced motion,
                // the global rule), and widens a little for a transcription warning.
                touch ? 'flex-1' : `mx-auto w-full animate-solkey-step-in ${hint?.kind === 'warning' ? 'max-w-120' : 'max-w-104'}`,
            ].join(' ')}>
            {/* Keyed by phase: the count-in's row unmounts at the downbeat, so its words and the
                recording's are never in the strip at once, and the recording's fades in. */}
            <div key={status.phase} aria-hidden className="flex items-center gap-2.5 animate-solkey-step-in">
                {status.phase === 'countoff' ? (
                    <>
                        <CountoffDots countoff={status.countoff} />
                        <span className="font-label font-medium text-[15px] leading-none text-on-surface">{copy.label}</span>
                        <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant whitespace-nowrap">
                            {copy.startsFrom}
                        </span>
                    </>
                ) : (
                    <>
                        <span className="recording-dot size-2 shrink-0 rounded-full bg-record" />
                        <span className="font-label font-medium text-[15px] leading-none text-on-surface">{copy.label}</span>
                        <span className="font-mono font-normal text-[13px] leading-none tabular-nums text-on-surface-variant">
                            {formatRecordingTime(elapsed)}
                        </span>
                    </>
                )}
            </div>
            {hint ? <HintLine hint={hint} /> : <span aria-hidden className="h-4" />}
            <span role="status" aria-live="polite" className="sr-only">
                {copy.news}
            </span>
        </div>
    )
}
