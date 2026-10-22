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

/** The count-in: one dot per felt pulse of the bar, each filling red on its click. */
function CountoffDots({ countoff }: { countoff: RecordingStatus['countoff'] }) {
    if (!countoff) return null
    return (
        <span className="inline-flex items-center gap-2">
            {Array.from({ length: countoff.total }, (_, i) => (
                <span
                    key={i}
                    className={[
                        'size-2.5 rounded-full motion-safe:transition-colors motion-safe:duration-150 ease-solkey',
                        // Unfilled dots in `outline` (4.5:1 on the white well): the count reads before the clicks fill it.
                        i <= countoff.beat ? 'bg-error' : 'bg-outline',
                    ].join(' ')}
                />
            ))}
        </span>
    )
}

function HintLine({ hint }: { hint: StripHint }) {
    const quiet = 'font-body font-normal text-[13px] leading-tight text-on-surface-variant'
    if (hint.kind === 'stop') {
        // The record-as-stop button in miniature — a white rounded square on a red disc, as the
        // live button draws it (RecordGlyph) — so the line points at that button, never at an
        // outlined playback Stop.
        const glyph = (
            <span className="inline-flex align-[-2px]">
                <span aria-hidden className="inline-flex size-3.5 items-center justify-center rounded-full bg-error">
                    <span className="size-1.25 rounded-[1.5px] bg-on-error" />
                </span>
                <span className="sr-only">the stop button</span>
            </span>
        )
        return <p className={`m-0 truncate ${quiet}`}>{hint.touch ? <>Tap {glyph} to stop</> : <>Press Space or {glyph} to stop</>}</p>
    }
    // A transcription warning may run to two lines on a phone; everything else is one.
    if (hint.kind === 'warning') {
        return <p className="m-0 font-body font-medium text-[13px] leading-snug text-on-surface text-center">{hint.text}</p>
    }
    return <p className={`m-0 truncate ${quiet}`}>{hint.text}</p>
}

/**
 * The one recording status surface (contract C10): for the length of a take it stands in for
 * the dock's tool wells — a white capsule well on the dock's chrome. The count-in reads 'Get
 * ready' over one dot per click (the engine's own clock fills them), then 'Recording' with a
 * slowly pulsing red dot and the elapsed time; one hint line says how to stop, how much of
 * today is left, or what the server's transcription is doing. Screen readers hear the state
 * changes once, through the editor's announcer (contract C11); the strip's own polite status
 * carries only the transcription news, and the elapsed clock stays silent.
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
                'flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-[28px] px-5 py-2',
                'bg-surface-container-lowest tonal-layer-glow',
                touch ? 'flex-1' : 'mx-auto w-full max-w-[26rem]',
            ].join(' ')}>
            <div aria-hidden className="flex items-center gap-2.5">
                {status.phase === 'recording' && <span className="recording-dot size-2 shrink-0 rounded-full bg-error" />}
                <span className="font-label font-medium text-[15px] leading-none text-on-surface">{copy.label}</span>
                {status.phase === 'countoff' ? (
                    <CountoffDots countoff={status.countoff} />
                ) : (
                    <span className="font-mono font-normal text-[13px] leading-none text-on-surface-variant">
                        {formatRecordingTime(elapsed)}
                    </span>
                )}
            </div>
            {hint && <HintLine hint={hint} />}
            <span role="status" aria-live="polite" className="sr-only">
                {copy.news}
            </span>
        </div>
    )
}
