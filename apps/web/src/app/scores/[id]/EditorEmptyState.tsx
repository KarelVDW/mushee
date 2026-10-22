'use client'

import { type Ref, useEffect, useState } from 'react'

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
}

/**
 * What an empty score says: what to do (sing, hum or play; record, count-in, go), that Solkey
 * writes melodies one note at a time, and the button to start right there. HTML below the
 * staff, after the ScoreView — never an <svg> (the exports and the selection bar take the
 * canvas's first one) and never in an export. Neutral tones; the record dot keeps its red.
 *
 * Shown purely from the score's content: it fades out as the first pitched note lands (at
 * once under reduced motion) and comes back if the score is emptied again.
 */
export function EditorEmptyState({ show, touch, onStartRecording, descriptionId, startRef }: EditorEmptyStateProps) {
    const [phase, setPhase] = useState<'shown' | 'leaving' | 'gone'>(show ? 'shown' : 'gone')
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
    const form = touch ? 'touch' : 'desktop'

    return (
        <div
            data-export-exclude
            inert={leaving}
            className={[
                'mx-auto mb-6 max-w-120 flex flex-col items-center gap-3 text-center',
                // 56px below the score's last row on desktop. The bar buttons' row (MeasureControls:
                // 12px + a 32px row, 40px on touch) sits in between — held invisible while the score
                // is empty, so it keeps its room — and this margin is what is left.
                // Phones keep 24px clear of those 40px buttons — the row alone already takes 52px.
                touch ? 'mt-6' : 'mt-3 pointer-coarse:mt-1',
                'transition-[opacity,transform] duration-200 ease-solkey motion-reduce:transition-none',
                leaving ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0',
            ].join(' ')}>
            <h2 className="m-0 font-display font-semibold text-[20px] leading-tight text-on-surface">{EMPTY_SCORE_COPY.title}</h2>
            <p id={descriptionId} className="m-0 max-w-[34ch] font-body font-normal text-[15px] leading-normal text-on-surface-variant">
                {EMPTY_SCORE_COPY.body[form]}
            </p>
            <button
                ref={startRef}
                type="button"
                onClick={onStartRecording}
                className={[
                    'mt-1 inline-flex items-center gap-2 rounded-full border-0 cursor-pointer px-5',
                    touch ? 'h-10' : 'h-11',
                    'bg-surface-container-low text-on-surface hover:bg-surface-container',
                    'font-label font-semibold text-[14px] leading-none',
                    'transition-colors duration-150 ease-solkey focus-ring',
                ].join(' ')}>
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-error-container" />
                {EMPTY_SCORE_COPY.start}
            </button>
            <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">{EMPTY_SCORE_COPY.byHand[form]}</p>
        </div>
    )
}
