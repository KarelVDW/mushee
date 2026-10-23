'use client'

import { type Ref, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { BAR_ROW_PLACEHOLDER } from './MeasureControls'

/** The empty state's way out: a fade and an 8px drop as the first note lands. */
const LEAVE_MS = 200

/** The copy the empty state shows, by form factor: phones tap, desktops press and click. */
export const EMPTY_SCORE_COPY = {
    title: 'Sing, hum or play your tune',
    body: {
        desktop: 'Press record, wait for the count-in, then go. Solkey writes melodies, one note at a time.',
        touch: 'Tap record, wait for the count-in, then go. Solkey writes melodies, one note at a time.',
    },
    start: 'Start recording',
    byHand: {
        desktop: 'Or click a beat on the staff to place notes by hand.',
        // A tap only selects on touch (no hover-to-pitch): the Pitch nudges turn the picked rest into a note.
        touch: 'Or tap a beat, then use Pitch below to place notes by hand.',
    },
} as const

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

interface EditorEmptyStateProps {
    /** Whether it belongs on screen: the score holds no pitched note, and nothing records or plays. */
    show: boolean
    /** Phone copy ('Tap record') and the phone-sized button, which stays quieter than the dock's record. */
    touch: boolean
    onStartRecording: () => void
    /** The id the canvas's aria-describedby points at, so a screen reader hears the how-to with the score. */
    descriptionId: string
    /** The Start recording button — focused when the editor opens straight from onboarding. */
    startRef?: Ref<HTMLButtonElement>
    /**
     * Where the bar buttons' row starts in the score wrapper (MeasureControls' `barRowTop`), once
     * the score is laid out: the state then sits right under that row instead of under the
     * whole <svg>, whose empty room below the last row would hold it far from the first bar.
     */
    barRowTop?: number
}

/** The room between the bar buttons' row and the state: 40px, 24px on phones (clear of their 40px buttons). */
const ROW_GAP = { desktop: 40, touch: 24 } as const

/**
 * What an empty score says: what to do (sing, hum or play; record, count-in, go), that Solkey
 * writes melodies one note at a time, and the button to start right there. HTML below the
 * staff, after the ScoreView — never an <svg> (the exports and the selection bar take the
 * canvas's first one) and never in an export. Neutral tones; the record dot keeps its red.
 *
 * Shown purely from the score's content: it fades out as the first pitched note lands (at
 * once under reduced motion) and comes back if the score is emptied again.
 */
export function EditorEmptyState({ show, touch, onStartRecording, descriptionId, startRef, barRowTop }: EditorEmptyStateProps) {
    const [phase, setPhase] = useState<'shown' | 'leaving' | 'gone'>(show ? 'shown' : 'gone')
    const ref = useRef<HTMLDivElement>(null)
    const form = touch ? 'touch' : 'desktop'

    // In flow the state follows the bar buttons' placeholder, which follows the whole <svg>; the
    // buttons themselves sit higher, just under the last row. Lift the state by the difference,
    // so the bar, its buttons and the state read as one line (measured before paint).
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const placeholder = barRowTop === undefined ? null : el.parentElement?.querySelector<HTMLElement>(BAR_ROW_PLACEHOLDER)
        const lift = placeholder && barRowTop !== undefined ? Math.max(0, placeholder.offsetTop - barRowTop) : 0
        el.style.marginTop = lift > 0 ? `${ROW_GAP[form] - lift}px` : ''
    }, [barRowTop, form, phase])
    // Adjusted while rendering, so it never shows a frame late or lingers a frame too long.
    if (show && phase !== 'shown') setPhase('shown')
    if (!show && phase === 'shown') setPhase(prefersReducedMotion() ? 'gone' : 'leaving')

    useEffect(() => {
        if (phase !== 'leaving') return
        const timer = setTimeout(() => setPhase('gone'), LEAVE_MS)
        return () => clearTimeout(timer)
    }, [phase])

    if (phase === 'gone') return null
    const leaving = phase === 'leaving'

    return (
        <div
            ref={ref}
            data-export-exclude
            inert={leaving}
            className={[
                // Phones centre it; from sm up it reads on from the first bar, on the staff's left
                // edge (the paper's padding) — bar, heading, how-to, button: one reading line.
                'mx-auto mb-6 max-w-120 flex flex-col items-center gap-3 text-center sm:mx-0 sm:items-start sm:text-left',
                // 40px below the bar buttons' row (24px on phones, clear of their 40px buttons),
                // held invisible while the score is empty so it keeps its room; `barRowTop` lifts
                // it to that row from the row's placeholder after the svg.
                touch ? 'mt-6' : 'mt-10',
                'transition-[opacity,transform] duration-200 ease-solkey motion-reduce:transition-none',
                leaving ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0',
            ].join(' ')}>
            <h2 className="m-0 font-display font-semibold text-[20px] leading-tight text-on-surface">{EMPTY_SCORE_COPY.title}</h2>
            <p id={descriptionId} className="m-0 max-w-[34ch] font-body font-normal text-[15px] leading-normal text-on-surface-variant">
                {EMPTY_SCORE_COPY.body[form]}
            </p>
            {/* One tonal step above the paper, so it reads as a button — still quieter than the transport's Record. */}
            <button
                ref={startRef}
                type="button"
                onClick={onStartRecording}
                className={[
                    'mt-1 inline-flex items-center gap-2 rounded-full border-0 cursor-pointer px-5',
                    touch ? 'h-10' : 'h-11',
                    'bg-surface-container text-on-surface hover:bg-surface-container-high',
                    'font-label font-semibold text-[14px] leading-none',
                    'transition-colors duration-150 ease-solkey focus-ring',
                ].join(' ')}>
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-record" />
                {EMPTY_SCORE_COPY.start}
            </button>
            <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">{EMPTY_SCORE_COPY.byHand[form]}</p>
        </div>
    )
}
