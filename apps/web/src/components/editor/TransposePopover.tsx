'use client'

import { Score as ScoreView } from '@mushee/notation/components'
import { Interval, type IntervalQuality, Measure, type Note, Score } from '@mushee/notation/model'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import { KEY_NAMES, KeySignatureGlyph } from '@/components/editor/KeySignaturePopover'
import { Icon, Popover, PopoverOption, PrimaryButton, Segmented, TertiaryButton } from '@/components/ui'

type TransposeScope = 'score' | 'selection'
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

/** Width the preview's layout packs against — px at zoom 1 (the model's reflow floor). */
const PREVIEW_LAYOUT_WIDTH = 340
/** Inner width of the preview box: the popover's w-90 minus its and the box's padding. */
const PREVIEW_BOX_WIDTH = 304
const PREVIEW_MAX_ZOOM = 1.2

// Key options mirror the key-signature picker: flats → C → sharps.
const KEY_ROWS: number[][] = [
    [-7, -6, -5, -4, -3, -2, -1],
    [0],
    [1, 2, 3, 4, 5, 6, 7],
]

interface TransposePopoverProps {
    score: Score
    /** The current selection in score order — scope choice and the selection preview hang off it. */
    selectedNotes: Note[]
    onApply: (chromatic: number, diatonic: number, scope: TransposeScope) => void
    onDismiss: () => void
    /**
     * Reports the range the popover is currently aimed at — on open, whenever the scope
     * toggle flips, and `null` on close. The editor pulses that range on the canvas so the
     * target of the pending transposition is always visible. Keep referentially stable.
     */
    onScopeChange?: (scope: TransposeScope | null) => void
    /** Extra positioning/layout classes (e.g. `right-0 top-[calc(100%+0.5rem)]`). */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
}

/**
 * The transpose panel. Simple by default — a signed semitone count plus a live preview —
 * with an advanced mode offering the full vocabulary (by interval, by target key, by
 * semitones) behind one toggle. Whatever the input mode, the engine receives a single
 * (chromatic, diatonic) interval and always respells the result minimally, so the preview
 * below is exactly what Apply produces.
 */
export function TransposePopover({ score, selectedNotes, onApply, onDismiss, onScopeChange, className, anchorRef }: TransposePopoverProps) {
    const [advanced, setAdvanced] = useState(false)
    const [tab, setTab] = useState<TransposeTab>('interval')
    const [scope, setScope] = useState<TransposeScope>('score')
    const [semitones, setSemitones] = useState(0)
    const [degree, setDegree] = useState(2)
    const [quality, setQuality] = useState<IntervalQuality>('major')
    const [octaves, setOctaves] = useState(0)
    const [direction, setDirection] = useState<1 | -1>(1)
    const [targetFifths, setTargetFifths] = useState<number | null>(null)

    const hasSelection = selectedNotes.length > 1
    const effectiveScope = hasSelection && scope === 'selection' ? 'selection' : 'score'
    const currentFifths =
        (effectiveScope === 'selection' && selectedNotes[0] ? selectedNotes[0].keySignature.fifths : score.firstMeasure?.keySignature.fifths) ??
        0

    const interval = useMemo(() => {
        if (!advanced || tab === 'semitones') return Interval.fromSemitones(semitones)
        if (tab === 'key') return targetFifths === null ? new Interval(0, 0) : Interval.betweenKeys(currentFifths, targetFifths, direction)
        return Interval.fromParts(degree, quality, octaves, direction)
    }, [advanced, tab, semitones, targetFifths, currentFifths, direction, degree, quality, octaves])

    // The preview is its own tiny Score (never the live one): the first affected measure,
    // rebuilt and transposed from scratch on every input change.
    const previewVersion = score.version
    const preview = useMemo(
        // The version isn't read in the build itself, but a score edit must rebuild the preview.
        () => buildPreview(score, selectedNotes, interval, effectiveScope),
        [score, previewVersion, selectedNotes, interval, effectiveScope],
    )
    // A lone measure fills only a slice of the layout width, so the view is zoomed until the
    // measure's actually-used width fills the preview box (the box crops the empty remainder).
    const previewZoom = useMemo(() => {
        preview.setLayoutWidth(PREVIEW_LAYOUT_WIDTH)
        const first = preview.measures[0]?.layout
        const used = first ? first.measureX + first.measureWidth : PREVIEW_LAYOUT_WIDTH
        const scale = Math.min(PREVIEW_MAX_ZOOM, PREVIEW_BOX_WIDTH / used)
        return { scale, height: preview.layout.totalHeight * scale }
    }, [preview])

    // Aim the canvas pulse at the current scope while open; clear it on close.
    useEffect(() => {
        onScopeChange?.(effectiveScope)
    }, [onScopeChange, effectiveScope])
    useEffect(() => () => onScopeChange?.(null), [onScopeChange])

    const selectDegree = (next: number) => {
        setDegree(next)
        // Coerce the quality into the new degree's class (no perfect third, no major fifth).
        if (PERFECT_DEGREES.has(next) && (quality === 'major' || quality === 'minor')) setQuality('perfect')
        if (!PERFECT_DEGREES.has(next) && quality === 'perfect') setQuality('major')
    }

    const openAdvanced = () => {
        // Carry a dialed-in semitone count into the advanced mode's matching tab.
        if (semitones !== 0) setTab('semitones')
        setAdvanced(true)
    }

    const apply = useCallback(() => {
        if (interval.isUnison) return
        onApply(interval.chromatic, interval.diatonic, effectiveScope)
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
            onDismiss={onDismiss}
            onKeyDown={handleKey}
            anchorRef={anchorRef}
            className={`w-90 gap-3${className ? ` ${className}` : ''}`}
            headerRight={
                <span className="font-mono font-medium text-[11px] leading-none text-on-surface-variant">
                    {interval.isUnison ? 'No change' : `${interval.chromatic > 0 ? '+' : ''}${interval.chromatic} st`}
                </span>
            }>
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
                        <div role="group" aria-label="Interval size" className="flex gap-1">
                            {DEGREES.map(({ degree: d, label, name }) => (
                                <PopoverOption
                                    key={d}
                                    active={degree === d}
                                    ariaLabel={name}
                                    title={name}
                                    onClick={() => selectDegree(d)}
                                    className="justify-center w-8 h-8 text-[13px] font-medium">
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
                                    className="justify-center px-2.5 h-8 text-[12px] font-medium">
                                    {QUALITY_LABELS[value]}
                                </PopoverOption>
                            ))}
                        </div>
                    </LabeledRow>
                    <div className="flex items-center justify-between gap-3">
                        <DirectionControl direction={direction} onChange={setDirection} />
                        <NumberStepper ariaLabel="Extra octaves" value={octaves} min={0} max={MAX_EXTRA_OCTAVES} onChange={setOctaves} suffix="oct" />
                    </div>
                </>
            )}

            {advanced && tab === 'key' && (
                <>
                    <div className="flex items-center justify-between gap-3">
                        <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant">
                            From <span className="font-medium text-on-surface">{KEY_NAMES[currentFifths]} major</span> to:
                        </span>
                        <DirectionControl direction={direction} onChange={setDirection} />
                    </div>
                    <div role="group" aria-label="Target key" className="flex flex-col gap-1.5 items-center">
                        {KEY_ROWS.map((row, i) => (
                            <div key={i} className="flex flex-wrap justify-center gap-1">
                                {row.map((fifths) => (
                                    <PopoverOption
                                        key={fifths}
                                        active={fifths === targetFifths}
                                        ariaLabel={`${KEY_NAMES[fifths]} major`}
                                        title={`${KEY_NAMES[fifths]} major`}
                                        onClick={() => setTargetFifths(fifths)}
                                        className="flex-col justify-end gap-0.5 w-10.5 h-12 px-1 py-1">
                                        <span className="flex flex-1 items-center">
                                            <KeySignatureGlyph fifths={fifths} size={26} />
                                        </span>
                                        <span className="text-[10px] leading-none font-medium">{KEY_NAMES[fifths]}</span>
                                    </PopoverOption>
                                ))}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {(!advanced || tab === 'semitones') && (
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

            {hasSelection && (
                <Segmented
                    ariaLabel="Apply to"
                    value={scope}
                    onChange={(v) => v && setScope(v)}
                    options={[
                        { value: 'score' as const, label: 'Whole score' },
                        { value: 'selection' as const, label: 'Selection' },
                    ]}
                />
            )}

            <div className="flex flex-col gap-1.5">
                <span className="font-label font-semibold text-[11px] leading-none uppercase tracking-[0.12em] text-on-surface-variant">
                    Preview
                </span>
                <div aria-hidden className="bg-white rounded-md manuscript-canvas px-3 py-1 overflow-hidden pointer-events-none select-none">
                    <div style={{ height: previewZoom.height }}>
                        <div style={{ width: PREVIEW_LAYOUT_WIDTH, transform: `scale(${previewZoom.scale})`, transformOrigin: 'top left' }}>
                            <ScoreView score={preview} layoutId={preview.layout.id} />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3">
                <TertiaryButton onClick={() => (advanced ? setAdvanced(false) : openAdvanced())}>
                    {advanced ? 'Fewer options' : 'Advanced options'}
                </TertiaryButton>
                <PrimaryButton onClick={apply} disabled={interval.isUnison}>
                    Apply
                </PrimaryButton>
            </div>
        </Popover>
    )
}

function LabeledRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <span className="font-label font-semibold text-[11px] leading-none uppercase tracking-[0.12em] text-on-surface-variant">
                {label}
            </span>
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
    /** Let the field stretch to the row's width (the simple mode's single control). */
    grow?: boolean
}

/** A ± stepper around a numeric field, in the tempo popover's input style. */
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
                'w-9 self-stretch inline-flex items-center justify-center rounded-sm border-0 shrink-0',
                'bg-surface-container-low text-on-surface cursor-pointer',
                'enabled:hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40',
                'transition-colors duration-150 ease-solkey',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            ].join(' ')}>
            <Icon name={delta > 0 ? 'plus' : 'minus'} size={14} />
        </button>
    )
    return (
        <div className={`flex items-stretch gap-1 ${grow ? 'flex-1' : ''}`}>
            <div className={`relative flex items-center px-3 rounded-sm bg-surface-container-low ${grow ? 'flex-1' : 'w-24'}`}>
                <input
                    type="number"
                    min={min}
                    max={max}
                    value={draft}
                    onChange={(e) => {
                        setDraft(e.target.value)
                        const n = parseInt(e.target.value, 10)
                        if (!Number.isNaN(n)) onChange(clamp(n))
                    }}
                    onBlur={() => setDraft(String(value))}
                    aria-label={ariaLabel}
                    className="flex-1 min-w-0 w-8 py-2.5 bg-transparent border-0 outline-0 font-body font-medium text-[15px] leading-none text-on-surface [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="font-label font-medium text-[10px] leading-none uppercase tracking-[0.12em] text-on-surface-variant">
                    {suffix}
                </span>
                <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-primary-container" />
            </div>
            {stepButton(-1)}
            {stepButton(1)}
        </div>
    )
}

/**
 * A one-measure throwaway Score previewing the transposition: the first affected measure's
 * notes under its clef/key/meter, run through the same `Score.transpose` the Apply button
 * uses — key change, respelling and all.
 */
function buildPreview(score: Score, selectedNotes: Note[], interval: Interval, scope: TransposeScope): Score {
    const source = scope === 'selection' && selectedNotes[0] ? selectedNotes[0].measure : score.firstMeasure
    const preview = new Score()
    if (!source) return preview
    const key = source.keySignature
    const measure = new Measure(preview, source.clef.type, source.timeSignature, { keyFifths: key.fifths, keyMode: key.mode })
    preview.addMeasure(0, measure)
    if (source.notes.length) measure.addNotes(source.notes.map((note) => note.clone({})))
    if (interval.isUnison) return preview
    if (scope === 'selection') {
        // Only the selected notes move — mirror them into the copy by position.
        const targets = selectedNotes
            .filter((note) => note.measure === source)
            .map((note) => measure.notes[source.notes.indexOf(note)])
            .filter((note): note is Note => note !== undefined)
        if (targets.length) preview.transpose(interval.chromatic, interval.diatonic, targets)
    } else {
        preview.transpose(interval.chromatic, interval.diatonic)
    }
    return preview
}
