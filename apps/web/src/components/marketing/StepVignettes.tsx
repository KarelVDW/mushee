import { INTERACTION_BLUE_BAND } from '@mushee/notation/components'

import { DEMO_BAR_HEIGHTS, type DemoNote, DemoRecordingCursor, DemoSavedChip, DemoStaff, DemoWaveformBar } from '@/components/DemoSheet'
import { Icon } from '@/components/ui'

/** What each How it works step shows: the record button, the staff filling in, a note being fixed. */
export type StepVignetteKind = 'record' | 'sing' | 'fix'

/**
 * A How it works step's picture: a still, decorative tile drawn from the product's real parts
 * (the record button and count-in, the staff with its waveform and recording cursor, the Pitch
 * well and the Saved state) — never an illustration. Built from spans and SVG only, and hidden
 * from assistive technology, so the page gains no fake controls.
 */
export function StepVignette({ kind }: { kind: StepVignetteKind }) {
    return (
        <div
            aria-hidden
            className="relative rounded-xl bg-surface-container-lowest tonal-layer-glow overflow-hidden flex items-center justify-center h-32 sm:h-40 mb-5">
            {kind === 'record' ? <RecordVignette /> : kind === 'sing' ? <SingVignette /> : <FixVignette />}
        </div>
    )
}

/** 01: the dock's record button, the count-in's four beats half done, and the strip's own words. */
function RecordVignette() {
    return (
        <div className="flex flex-col items-center gap-3">
            {/* The record red on purpose: this is the record button, not an error. */}
            <span className="size-14 rounded-full bg-surface-container-lowest tonal-layer-glow inline-flex items-center justify-center">
                <span className="size-5 rounded-full bg-record" />
            </span>
            <span className="flex items-center gap-1.5">
                {[true, true, false, false].map((counted, i) => (
                    <span key={i} className={`size-2 rounded-full ${counted ? 'bg-record' : 'ring-[1.5px] ring-inset ring-outline'}`} />
                ))}
            </span>
            <span className="font-body font-normal text-[12px] leading-none text-on-surface-variant">Get ready · from bar 1</span>
        </div>
    )
}

// 02: one bar without clef or time signature — two notes written, then the sound still turning into
// notes: six waveform bars, the recording cursor at their leading edge.
const SING_NOTES: readonly DemoNote[] = [
    { x: 34, cy: 95, beats: 1 },
    { x: 84, cy: 90, beats: 1 },
]
const SING_BARS = Array.from({ length: 6 }, (_, k) => ({ x: 128 + k * 13, h: DEMO_BAR_HEIGHTS[k % DEMO_BAR_HEIGHTS.length] }))

function SingVignette() {
    return (
        <DemoStaff
            notes={SING_NOTES}
            from={12}
            to={244}
            barlines={[244]}
            framed={false}
            viewBox="4 36 248 78"
            className="h-20 sm:h-24 w-auto">
            {SING_BARS.map((bar, k) => (
                <DemoWaveformBar key={bar.x} x={bar.x} h={bar.h} index={k} />
            ))}
            <DemoRecordingCursor x={214} />
        </DemoStaff>
    )
}

// 03: three notes, the middle one selected (the editor's selection band behind it), beside the
// dock's Pitch well; the score has saved.
const FIX_NOTES: readonly DemoNote[] = [
    { x: 30, cy: 100, beats: 1 },
    { x: 80, cy: 90, beats: 1 },
    { x: 130, cy: 95, beats: 1 },
]

function FixVignette() {
    const selected = FIX_NOTES[1]
    return (
        <>
            <DemoSavedChip className="absolute top-3 right-3" />
            <div className="flex items-center gap-4 sm:gap-6">
                <DemoStaff
                    notes={FIX_NOTES}
                    from={10}
                    to={166}
                    barlines={[]}
                    framed={false}
                    viewBox="4 40 166 72"
                    className="h-18 sm:h-22 w-auto">
                    {/* The selection band: staff top − 6 to staff bottom + 6, soft corners for a lone note. */}
                    <rect x={selected.x - 10} y={49} width={36} height={52} rx={3} fill={INTERACTION_BLUE_BAND} />
                </DemoStaff>
                {/* The dock's Pitch well: Higher and Lower. */}
                <span className="inline-flex items-center gap-0.5 p-0.75 rounded-full bg-surface-container-lowest tonal-layer-glow text-on-surface">
                    {(['chevron-up', 'chevron-down'] as const).map((icon) => (
                        <span key={icon} className="inline-flex items-center justify-center h-8 w-9 rounded-full">
                            <Icon name={icon} size={16} />
                        </span>
                    ))}
                </span>
            </div>
        </>
    )
}
