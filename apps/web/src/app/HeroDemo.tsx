'use client'

import { useEffect, useState } from 'react'

import { DEMO_TIMELINE_CSS, DemoCard, demoClockSeconds } from '@/components/DemoSheet'
import { Icon, IconButton, SecondaryButton, Tooltip } from '@/components/ui'
import { EXAMPLE_SHARE_TOKEN } from '@/lib/env'

/**
 * The hero demo: an idealised loop of a real recording session in the Solkey editor, played on
 * the demo sheet (see DemoSheet) — the red recording cursor sweeps the staff, live waveform bars
 * (the editor's cyan/magenta) rise under it, and about 1.5 s later (under three beats at ♩ = 110)
 * each beat's bars burst away as clean engraved notation takes their place.
 * A caption says what is happening, and the loop (longer than 5 s) has a pause control
 * (WCAG 2.2.2): paused — like prefers-reduced-motion and the server render — shows the finished
 * sheet, which is also the frame the loop starts from. When this environment has an example
 * share, "Hear an example" opens it, so a visitor can hear a real score before signing up.
 */
export function HeroDemo() {
    // `motion` flips on after mount (and only without prefers-reduced-motion); until then the
    // finished sheet shows, which is also the SSR, no-motion and paused state.
    const [motion, setMotion] = useState(false)
    const [paused, setPaused] = useState(false)
    const animate = motion && !paused
    const [seconds, setSeconds] = useState(0)

    useEffect(() => {
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setMotion(true)
    }, [])

    // The REC clock runs only while the loop does; playing again picks the loop up from the finished sheet.
    useEffect(() => {
        if (!animate) return
        const start = Date.now()
        setSeconds(demoClockSeconds(0))
        const timer = setInterval(() => setSeconds(demoClockSeconds(Date.now() - start)), 250)
        return () => clearInterval(timer)
    }, [animate])

    const toggleLabel = paused ? 'Play demo' : 'Pause demo'

    return (
        <div className="flex flex-col gap-3">
            {/* The pause control is the card's sibling: an img's children are presentational, so it can't sit inside. */}
            <div className="relative">
                <div
                    role="img"
                    aria-label="Demo: a hummed melody turning into notes on a staff"
                    className="bg-surface-container-lowest rounded-lg tonal-layer-glow p-7 -rotate-[1.5deg]">
                    <DemoCard animate={animate} seconds={seconds} />
                </div>
                {motion && (
                    <div className="absolute bottom-4 right-5">
                        <Tooltip label={toggleLabel}>
                            <IconButton
                                icon={paused ? 'play' : 'pause'}
                                size={40}
                                ariaLabel={toggleLabel}
                                hoverTone="neutral"
                                onClick={() => setPaused((p) => !p)}
                            />
                        </Tooltip>
                    </div>
                )}
            </div>
            {/* The caption, with the example beside it when this environment has one. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                    Someone humming Frère Jacques. Each note appears a moment after it&apos;s sung.
                </p>
                {EXAMPLE_SHARE_TOKEN && (
                    <SecondaryButton href={`/s/${EXAMPLE_SHARE_TOKEN}`} tone="raised" size="lg">
                        <span className="inline-flex items-center gap-2">
                            Hear an example
                            <Icon name="arrow-right" size={14} />
                        </span>
                    </SecondaryButton>
                )}
            </div>
            <style>{DEMO_TIMELINE_CSS}</style>
        </div>
    )
}
