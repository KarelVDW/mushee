'use client'

import { ScoreView } from '@mushee/notation/components'
import { Interval, type IntervalQuality, type Note, Score } from '@mushee/notation/model'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { KeySignatureGrid } from '@/components/editor/KeySignaturePopover'
import type { PitchScope } from '@/components/editor/pitchScope'
import { UnitNumberField } from '@/components/editor/UnitNumberField'
import { Eyebrow, Icon, Popover, PopoverOption, PrimaryButton, Segmented, TertiaryButton } from '@/components/ui'

type TransposeTab = 'interval' | 'key' | 'semitones'

const DEGREES: { degree: number; label: string; name: string }[] = [
    { degree: 1, label: '1', name: 'Unison' },
    { degree: 2, label: '2', name: 'Second' },
    { degree: 3, label: '3', name: 'Third' },
    { degree: 4, label: '4', name: 'Fourth' },
    { degree: 5, label: '5', name: 'Fifth' },
    { degree: 6, label: '6', name: 'Sixth' },
    { degree: 7, label: '7', name: 'Seventh' },
    { degree: 8, label: '8', name: 'Octave' },
]

const PERFECT_DEGREES = new Set([1, 4, 5, 8])
const PERFECT_QUALITIES: IntervalQuality[] = ['perfect', 'augmented', 'diminished']
const MAJOR_QUALITIES: IntervalQuality[] = ['major', 'minor', 'augmented', 'diminished']
const QUALITY_LABELS: Record<IntervalQuality, string> = {
    perfect: 'Perfect',
    major: 'Major',
    minor: 'Minor',
    augmented: 'Augmented',
    diminished: 'Diminished',
}

const MAX_SEMITONES = 24
const MAX_EXTRA_OCTAVES = 3
const OCTAVE = 12

/** Width the preview's layout packs against — px at zoom 1 (the model's reflow floor). */
const PREVIEW_LAYOUT_WIDTH = 340
/** Inner width of the preview box: the popover's w-90 minus its and the box's padding. */
const PREVIEW_BOX_WIDTH = 304
const PREVIEW_MAX_ZOOM = 1.2
/**
 * Vertical crop of the preview (layout units): the 160-unit row reserves generous room
 * under the staff (bottom line at 80); cutting at 128 keeps down-stems and a couple of
 * ledger lines while dropping the mostly-empty tail.
 */
const PREVIEW_CROP_HEIGHT = 128
/** On a phone sheet the preview leaves the room to the controls: never taller than this (px). */
const SHEET_PREVIEW_MAX_HEIGHT = 96

/**
 * What a transposition does, in plain words: "2 half steps higher", plus the key the score
 * lands in when the whole score moves ("— now in D major"); "No change yet" before any move.
 */
export function transposeReadout(chromatic: number, keyAfter: string | null): string {
    if (chromatic === 0) return 'No change yet'
    const steps = Math.abs(chromatic)
    const move = `${steps} half ${steps === 1 ? 'step' : 'steps'} ${chromatic > 0 ? 'higher' : 'lower'}`
    return keyAfter ? `${move} — now in ${keyAfter}` : move
}

interface TransposePopoverProps {
    score: Score
    /** The current selection in score order — the selection preview hangs off it. */
    selectedNotes: Note[]
    /**
     * Whether the selection can narrow the transposition to itself
     * (ScoreManipulator.selectionNarrowsPitchOps) — only then is the Apply-to choice offered.
     */
    selectionNarrowsPitchOps: boolean
    onApply: (interval: Interval, scope: PitchScope) => void
    onDismiss: () => void
    /**
     * Reports the range the popover is currently aimed at — on open, whenever the scope
     * toggle flips, and `null` on close. The editor pulses that range on the canvas so the
     * target of the pending transposition is always visible. Keep referentially stable.
     */
    onScopeChange?: (scope: PitchScope | null) => void
    /** Extra positioning/layout classes (e.g. `right-0 top-[calc(100%+0.5rem)]`); ignored by a sheet, which its host positions. */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
    /** `sheet` on phones: the full-width sheet above the dock (see Popover). */
    variant?: 'anchored' | 'sheet'
    /** Rendered above the controls — the More sheet's Back link. */
    lead?: ReactNode
}

/**
 * The transpose panel. Simple by default — half a step or an octave at a time, said in plain
 * words ("2 half steps higher — now in D major"), over a live preview — with "More options"
 * offering the full vocabulary (by interval, by target key, by semitones). Whatever the input
 * mode, the engine receives a single {@link Interval} and always respells the result
 * minimally, so the preview below is exactly what Apply produces.
 */
export function TransposePopover({
    score,
    selectedNotes,
    selectionNarrowsPitchOps,
    onApply,
    onDismiss,
    onScopeChange,
    className,
    anchorRef,
    variant = 'anchored',
    lead,
}: TransposePopoverProps) {
    const sheet = variant === 'sheet'
    const [advanced, setAdvanced] = useState(false)
    const [tab, setTab] = useState<TransposeTab>('interval')
    const [scope, setScope] = useState<PitchScope>('score')
    const [semitones, setSemitones] = useState(0)
    const [degree, setDegree] = useState(2)
    const [quality, setQuality] = useState<IntervalQuality>('major')
    const [octaves, setOctaves] = useState(0)
    const [direction, setDirection] = useState<1 | -1>(1)
    const [targetFifths, setTargetFifths] = useState<number | null>(null)

    const effectiveScope: PitchScope = selectionNarrowsPitchOps && scope === 'selection' ? 'selection' : 'score'
    const currentKey =
        effectiveScope === 'selection' && selectedNotes[0] ? selectedNotes[0].keySignature : (score.firstMeasure?.keySignature ?? null)
    const currentFifths = currentKey?.fifths ?? 0

    const interval = useMemo(() => {
        if (!advanced || tab === 'semitones') return Interval.fromSemitones(semitones)
        if (tab === 'key') return targetFifths === null ? new Interval(0, 0) : Interval.betweenKeys(currentFifths, targetFifths, direction)
        return Interval.fromParts(degree, quality, octaves, direction)
    }, [advanced, tab, semitones, targetFifths, currentFifths, direction, degree, quality, octaves])

    // The preview is its own tiny Score (never the live one): an excerpt of the first affected
    // measure, run through the same `Score.transpose` the Apply button uses — key change,
    // respelling and all — and rebuilt on every input change. The version isn't read in the
    // build itself, but a score edit must rebuild the preview.
    const previewVersion = score.version
    const preview = useMemo(() => {
        const source = effectiveScope === 'selection' && selectedNotes[0] ? selectedNotes[0].measure : score.firstMeasure
        const excerpt = source ? Score.excerpt(source, effectiveScope === 'selection' ? selectedNotes : undefined) : null
        const built = excerpt?.score ?? new Score()
        if (excerpt && !interval.isUnison) {
            // In selection scope only the selected notes move; with none in this measure nothing does.
            if (effectiveScope === 'score') built.transpose(interval)
            else if (excerpt.notes.length) built.transpose(interval, excerpt.notes)
        }
        built.setLayoutWidth(PREVIEW_LAYOUT_WIDTH)
        return built
    }, [score, previewVersion, selectedNotes, interval, effectiveScope])
    // A lone measure fills only a slice of the layout width, so the view is zoomed until the
    // measure's actually-used width fills the preview box (the box crops the empty remainder
    // and centers the visible slice). A phone sheet also caps its height.
    const previewZoom = useMemo(() => {
        const first = preview.measures[0]?.layout
        const used = first ? first.measureX + first.measureWidth : PREVIEW_LAYOUT_WIDTH
        const cropped = Math.min(preview.layout.totalHeight, PREVIEW_CROP_HEIGHT)
        const fit = Math.min(PREVIEW_MAX_ZOOM, PREVIEW_BOX_WIDTH / used)
        const scale = sheet ? Math.min(fit, SHEET_PREVIEW_MAX_HEIGHT / cropped) : fit
        return { scale, width: used * scale, height: cropped * scale }
    }, [preview, sheet])
    // The key the whole score lands in, read off the preview — it ran the very same transpose.
    const landingKey = preview.firstMeasure?.keySignature
    const keyAfter = effectiveScope === 'score' && !interval.isUnison && landingKey ? landingKey.displayName : null

    // Aim the canvas pulse at the current scope while open; clear it on close.
    useEffect(() => {
        onScopeChange?.(effectiveScope)
    }, [onScopeChange, effectiveScope])
    useEffect(() => () => onScopeChange?.(null), [onScopeChange])

    const nudge = (delta: number) => setSemitones((current) => Math.max(-MAX_SEMITONES, Math.min(MAX_SEMITONES, current + delta)))

    const selectDegree = (next: number) => {
        setDegree(next)
        // Coerce the quality into the new degree's class (no perfect third, no major fifth).
        if (PERFECT_DEGREES.has(next) && (quality === 'major' || quality === 'minor')) setQuality('perfect')
        if (!PERFECT_DEGREES.has(next) && quality === 'perfect') setQuality('major')
    }

    const openAdvanced = () => {
        // Carry a dialed-in half-step count into the advanced mode's matching tab.
        if (semitones !== 0) setTab('semitones')
        setAdvanced(true)
    }

    const apply = useCallback(() => {
        if (interval.isUnison) return
        onApply(interval, effectiveScope)
    }, [interval, effectiveScope, onApply])

    const handleKey = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                apply()
            }
        },
        [apply],
    )

    const qualities = PERFECT_DEGREES.has(degree) ? PERFECT_QUALITIES : MAJOR_QUALITIES

    return (
        <Popover
            ariaLabel="Transpose"
            title="Transpose"
            hint="Move every note higher or lower."
            onDismiss={onDismiss}
            onKeyDown={handleKey}
            anchorRef={anchorRef}
            variant={variant}
            className={sheet ? 'gap-3' : `w-90 gap-3${className ? ` ${className}` : ''}`}>
            {lead}
            <p aria-live="polite" className="m-0 font-label font-semibold text-[15px] leading-tight text-on-surface">
                {transposeReadout(interval.chromatic, keyAfter)}
            </p>

            {!advanced && (
                <>
                    <div className="grid grid-cols-2 gap-2">
                        <StepButton icon="chevron-down" disabled={semitones <= -MAX_SEMITONES} onClick={() => nudge(-1)}>
                            Half step lower
                        </StepButton>
                        <StepButton icon="chevron-up" disabled={semitones >= MAX_SEMITONES} onClick={() => nudge(1)}>
                            Half step higher
                        </StepButton>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <OctaveChip disabled={semitones - OCTAVE < -MAX_SEMITONES} onClick={() => nudge(-OCTAVE)}>
                            Down an octave
                        </OctaveChip>
                        <OctaveChip disabled={semitones + OCTAVE > MAX_SEMITONES} onClick={() => nudge(OCTAVE)}>
                            Up an octave
                        </OctaveChip>
                    </div>
                </>
            )}

            {advanced && (
                <Segmented
                    ariaLabel="Transpose by"
                    value={tab}
                    onChange={(v) => v && setTab(v)}
                    options={[
                        { value: 'interval' as const, label: 'Interval' },
                        { value: 'key' as const, label: 'Key' },
                        { value: 'semitones' as const, label: 'Semitones' },
                    ]}
                />
            )}

            {advanced && tab === 'interval' && (
                <>
                    <LabeledRow label="Interval">
                        <div role="group" aria-label="Interval size" className="flex flex-wrap gap-1">
                            {DEGREES.map(({ degree: d, label, name }) => (
                                <PopoverOption
                                    key={d}
                                    active={degree === d}
                                    ariaLabel={name}
                                    title={name}
                                    onClick={() => selectDegree(d)}
                                    className="justify-center w-10 h-10 text-[13px] font-medium">
                                    {label}
                                </PopoverOption>
                            ))}
                        </div>
                    </LabeledRow>
                    <LabeledRow label="Quality">
                        <div role="group" aria-label="Interval quality" className="flex flex-wrap gap-1">
                            {qualities.map((value) => (
                                <PopoverOption
                                    key={value}
                                    active={quality === value}
                                    ariaLabel={QUALITY_LABELS[value]}
                                    onClick={() => setQuality(value)}
                                    className="justify-center px-3 h-10 text-[13px] font-medium">
                                    {QUALITY_LABELS[value]}
                                </PopoverOption>
                            ))}
                        </div>
                    </LabeledRow>
                    <div className="flex items-center justify-between gap-3">
                        <DirectionControl direction={direction} onChange={setDirection} />
                        <NumberStepper
                            ariaLabel="Extra octaves"
                            value={octaves}
                            min={0}
                            max={MAX_EXTRA_OCTAVES}
                            onChange={setOctaves}
                            suffix="oct"
                        />
                    </div>
                </>
            )}

            {advanced && tab === 'key' && (
                <>
                    <div className="flex items-center justify-between gap-3">
                        <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant">
                            From <span className="font-medium text-on-surface">{currentKey ? currentKey.displayName : 'C major'}</span> to:
                        </span>
                        <DirectionControl direction={direction} onChange={setDirection} />
                    </div>
                    <KeySignatureGrid ariaLabel="Target key" active={targetFifths} onSelect={setTargetFifths} size="sm" />
                </>
            )}

            {advanced && tab === 'semitones' && (
                <NumberStepper
                    ariaLabel="Semitones"
                    value={semitones}
                    min={-MAX_SEMITONES}
                    max={MAX_SEMITONES}
                    onChange={setSemitones}
                    suffix="semitones"
                    grow
                />
            )}

            {selectionNarrowsPitchOps && (
                <div className="flex items-center justify-between gap-3">
                    <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant">Apply to</span>
                    {/* Same segmented pill as the Up/Down direction toggle. */}
                    <Segmented
                        ariaLabel="Apply to"
                        value={scope}
                        onChange={(v) => v && setScope(v)}
                        options={[
                            { value: 'score' as const, label: 'Whole score' },
                            { value: 'selection' as const, label: 'Selection' },
                        ]}
                    />
                </div>
            )}

            <div
                aria-hidden
                className="bg-surface-container-low rounded-md px-3 py-2 flex justify-center overflow-hidden pointer-events-none select-none">
                <div className="overflow-hidden" style={{ width: previewZoom.width, height: previewZoom.height }}>
                    <div style={{ width: PREVIEW_LAYOUT_WIDTH, transform: `scale(${previewZoom.scale})`, transformOrigin: 'top left' }}>
                        <ScoreView score={preview} layoutId={preview.layout.id} />
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3">
                <TertiaryButton onClick={() => (advanced ? setAdvanced(false) : openAdvanced())}>
                    {advanced ? 'Fewer options' : 'More options'}
                </TertiaryButton>
                <PrimaryButton onClick={apply} disabled={interval.isUnison}>
                    Apply
                </PrimaryButton>
            </div>
        </Popover>
    )
}

interface StepControlProps {
    disabled: boolean
    onClick: () => void
    children: ReactNode
}

/** The simple mode's 44px "Half step lower / higher" buttons: the tonal capsule with a chevron. */
function StepButton({ icon, disabled, onClick, children }: StepControlProps & { icon: 'chevron-up' | 'chevron-down' }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={[
                'h-11 px-3 inline-flex items-center justify-center gap-1.5 rounded-full border-0 cursor-pointer',
                'bg-surface-container-low text-on-surface font-label font-semibold text-[13px] leading-none whitespace-nowrap',
                'enabled:hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40',
                'transition-colors duration-150 ease-solkey focus-ring',
            ].join(' ')}>
            <Icon name={icon} size={16} />
            {children}
        </button>
    )
}

/** A whole-octave jump ("Up an octave") — the most common fix for a whistled or high-voice take. */
function OctaveChip({ disabled, onClick, children }: StepControlProps) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={[
                'h-10 px-4 inline-flex items-center rounded-full border-0 cursor-pointer',
                'bg-transparent text-on-surface font-label font-medium text-[13px] leading-none whitespace-nowrap',
                'enabled:hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-40',
                'transition-colors duration-150 ease-solkey focus-ring',
            ].join(' ')}>
            {children}
        </button>
    )
}

function LabeledRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <Eyebrow>{label}</Eyebrow>
            {children}
        </div>
    )
}

function DirectionControl({ direction, onChange }: { direction: 1 | -1; onChange: (d: 1 | -1) => void }) {
    return (
        <Segmented
            ariaLabel="Direction"
            value={direction > 0 ? 'up' : 'down'}
            onChange={(v) => onChange(v === 'up' ? 1 : -1)}
            options={[
                { value: 'up' as const, label: 'Up' },
                { value: 'down' as const, label: 'Down' },
            ]}
        />
    )
}

interface NumberStepperProps {
    value: number
    min: number
    max: number
    onChange: (value: number) => void
    ariaLabel: string
    /** Unit label rendered inside the field. */
    suffix: string
    /** Let the field stretch to the row's width (the semitones tab's single control). */
    grow?: boolean
}

/** A ± stepper around a {@link UnitNumberField} (the tempo popover's field, one size down). */
function NumberStepper({ value, min, max, onChange, ariaLabel, suffix, grow }: NumberStepperProps) {
    // A local draft lets partial input ("-", "") sit in the field without committing; every
    // parseable value commits immediately and outside changes (the ± buttons) sync back in.
    const [draft, setDraft] = useState(String(value))
    useEffect(() => setDraft(String(value)), [value])
    const clamp = (n: number) => Math.max(min, Math.min(max, n))
    const stepButton = (delta: -1 | 1) => (
        <button
            type="button"
            aria-label={`${delta > 0 ? 'Increase' : 'Decrease'} ${ariaLabel.toLowerCase()}`}
            disabled={delta > 0 ? value >= max : value <= min}
            onClick={() => onChange(clamp(value + delta))}
            className={[
                'w-10 self-stretch inline-flex items-center justify-center rounded-sm border-0 shrink-0',
                'bg-surface-container-low text-on-surface cursor-pointer',
                'enabled:hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40',
                'transition-colors duration-150 ease-solkey',
                'focus-ring',
            ].join(' ')}>
            <Icon name={delta > 0 ? 'plus' : 'minus'} size={14} />
        </button>
    )
    return (
        <div className={`flex items-stretch gap-1 ${grow ? 'flex-1' : ''}`}>
            <UnitNumberField
                value={draft}
                onChange={(raw) => {
                    setDraft(raw)
                    const n = parseInt(raw, 10)
                    if (!Number.isNaN(n)) onChange(clamp(n))
                }}
                onBlur={() => setDraft(String(value))}
                ariaLabel={ariaLabel}
                unit={suffix}
                min={min}
                max={max}
                size="sm"
                className={grow ? 'flex-1 h-10' : 'w-24 h-10'}
            />
            {stepButton(-1)}
            {stepButton(1)}
        </div>
    )
}
