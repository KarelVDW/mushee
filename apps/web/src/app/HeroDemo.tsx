'use client'

import { useEffect, useState } from 'react'

import { Glyph, INTERACTION_BLUE } from '@/components/notation'

/**
 * The hero demo: a looping re-creation of a real recording session in the
 * Sheemu editor — REC indicator running, waveform moving, and the notes of a
 * melody landing on the staff one by one, exactly the way live transcription
 * fills the sheet. Pure SVG driven by a small step timer; respects
 * prefers-reduced-motion by showing the completed sheet instead.
 */

interface DemoNote {
    x: number
    /** Vertical center of the notehead (staff lines sit at y 55..95). */
    cy: number
}

// Two 4/4 measures of a simple melody (G A B D | C B A G).
const NOTES: DemoNote[] = [
    { x: 128, cy: 85 },
    { x: 186, cy: 80 },
    { x: 244, cy: 75 },
    { x: 302, cy: 65 },
    { x: 396, cy: 70 },
    { x: 454, cy: 75 },
    { x: 512, cy: 80 },
    { x: 570, cy: 85 },
]

const TICK_MS = 640
/** A few extra ticks of "silence" at the end before the loop restarts. */
const STEPS = NOTES.length + 3

const WAVE_PATTERN = [6, 14, 9, 18, 11, 22, 8, 16, 12, 20, 7, 15, 10, 19, 13, 9, 17, 8, 21, 11, 14, 7, 18, 10, 16, 9, 13, 6]

export function HeroDemo() {
    const [step, setStep] = useState(0)
    const [animate, setAnimate] = useState(false)

    useEffect(() => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setStep(NOTES.length)
            return
        }
        setAnimate(true)
        const timer = setInterval(() => setStep((s) => (s + 1) % STEPS), TICK_MS)
        return () => clearInterval(timer)
    }, [])

    const visibleNotes = Math.min(step, NOTES.length)
    const recording = animate
    const playheadX = visibleNotes === 0 ? 96 : NOTES[Math.min(visibleNotes, NOTES.length) - 1].x + 26
    const seconds = Math.floor((step * TICK_MS) / 1000)

    return (
        <div className="flex flex-col gap-3">
            <div className="bg-surface-container-lowest rounded-lg editorial-shadow p-6 -rotate-[1.5deg]" aria-hidden>
                {/* Editor chrome: window dots + live REC state */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex gap-1.5">
                        {[0, 1, 2].map((i) => (
                            <span key={i} className="w-2.5 h-2.5 rounded-full bg-surface-container-high" />
                        ))}
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="font-mono text-[12px] leading-none text-on-surface-variant">♩ = 92</span>
                        <span className="inline-flex items-center gap-1.5 bg-error-container/15 rounded-full px-2.5 py-1.5">
                            <span
                                className="w-2 h-2 rounded-full bg-error-container"
                                style={recording ? { animation: 'hero-rec-pulse 1.2s ease-in-out infinite' } : undefined}
                            />
                            <span className="font-label font-semibold text-[10px] leading-none tracking-[0.14em] uppercase text-on-surface">
                                Rec
                            </span>
                            <span className="font-mono text-[11px] leading-none text-on-surface-variant">
                                0:{String(seconds).padStart(2, '0')}
                            </span>
                        </span>
                    </div>
                </div>

                {/* The staff, filling in as "you" play */}
                <svg viewBox="0 0 640 165" width="100%">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <line key={i} x1={16} x2={624} y1={55 + i * 10} y2={55 + i * 10} stroke="var(--color-on-surface)" strokeWidth={1} />
                    ))}
                    {/* Barlines: two measures + final */}
                    <line x1={358} x2={358} y1={55} y2={95} stroke="var(--color-on-surface)" strokeWidth={1} />
                    <line x1={624} x2={624} y1={55} y2={95} stroke="var(--color-on-surface)" strokeWidth={1.6} />
                    <Glyph name="gClef" x={26} y={85} fill="var(--color-on-surface)" />

                    {NOTES.map((note, i) => {
                        const visible = i < visibleNotes
                        const stemUp = note.cy >= 75
                        const isNewest = visible && i === visibleNotes - 1
                        return (
                            <g
                                key={note.x}
                                style={{
                                    opacity: visible ? 1 : 0,
                                    transform: visible ? 'translateY(0)' : 'translateY(-4px)',
                                    transition: 'opacity 220ms ease-out, transform 220ms ease-out',
                                }}>
                                <ellipse
                                    cx={note.x}
                                    cy={note.cy}
                                    rx={5.5}
                                    ry={4.2}
                                    fill={isNewest ? INTERACTION_BLUE : 'var(--color-on-surface)'}
                                    transform={`rotate(-15 ${note.x} ${note.cy})`}
                                />
                                <line
                                    x1={stemUp ? note.x + 5 : note.x - 5}
                                    x2={stemUp ? note.x + 5 : note.x - 5}
                                    y1={note.cy}
                                    y2={stemUp ? note.cy - 30 : note.cy + 30}
                                    stroke={isNewest ? INTERACTION_BLUE : 'var(--color-on-surface)'}
                                    strokeWidth={1.4}
                                />
                                {isNewest && <circle cx={note.x} cy={note.cy} r={11} fill={INTERACTION_BLUE} opacity={0.2} />}
                            </g>
                        )
                    })}

                    {/* Playhead following the transcription */}
                    {recording && (
                        <g style={{ transform: `translateX(${playheadX}px)`, transition: 'transform 500ms cubic-bezier(0.2,0.8,0.2,1)' }}>
                            <line x1={0} x2={0} y1={42} y2={108} stroke={INTERACTION_BLUE} strokeWidth={2} />
                            <circle cx={0} cy={42} r={3.5} fill={INTERACTION_BLUE} />
                        </g>
                    )}
                </svg>

                {/* Input level meter */}
                <div className="flex items-end gap-[3px] h-6 mt-3" role="presentation">
                    {WAVE_PATTERN.map((h, i) => {
                        const active = recording && i / WAVE_PATTERN.length <= (step % STEPS) / (STEPS - 2)
                        const height = active ? WAVE_PATTERN[(i + step * 3) % WAVE_PATTERN.length] : 4
                        return (
                            <span
                                key={i}
                                className={active ? 'bg-primary-container rounded-full' : 'bg-surface-container-high rounded-full'}
                                style={{ width: 4, height, transition: 'height 300ms ease' }}
                            />
                        )
                    })}
                </div>
            </div>
            <p className="font-body font-normal text-[12px] leading-normal text-on-surface-variant text-center m-0">
                Recording in the Sheemu editor: play a phrase, and the notes land on the staff as you go.
            </p>
            <style>{`@keyframes hero-rec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
        </div>
    )
}
