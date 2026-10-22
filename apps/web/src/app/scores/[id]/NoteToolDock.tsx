'use client'

import { BeatUnitIcon, ClefIcon, Glyph, KeySignatureIcon, TimeSignatureIcon } from '@mushee/notation/components'
import { Bravura } from '@mushee/notation/engraving/Bravura'
import { TUPLET_NUMBER_SCALE } from '@mushee/notation/engraving/constants'
import {
    type Accidental,
    CLEF_DEFS,
    type ClefType,
    Duration,
    type DurationType,
    type Interval,
    type Note,
    type Score,
    TimeSignature,
} from '@mushee/notation/model'
import { type ReactNode, useMemo, useRef, useState } from 'react'

import { ClefPopover } from '@/components/editor/ClefPopover'
import { keySignatureLabel, KeySignaturePopover } from '@/components/editor/KeySignaturePopover'
import { TempoPopover } from '@/components/editor/TempoPopover'
import { TimeSignaturePopover } from '@/components/editor/TimeSignaturePopover'
import { TransposePopover } from '@/components/editor/TransposePopover'
import { ChipToggle, Icon, Segmented, ToolGroup } from '@/components/ui'

import type { PitchScope } from './ScoreManipulator'

const ACCIDENTALS: { label: string; value: Accidental | undefined }[] = [
    { label: '♮', value: undefined },
    { label: '♭', value: 'b' },
    { label: '♯', value: '#' },
]

const DURATIONS: DurationType[] = ['w', 'h', 'q', '8', '16']

// --- Duration icon ---

const ICON_STEM_HEIGHT = 22

function DurationIcon({ dur }: { dur: DurationType }) {
    const duration = new Duration({ type: dur })
    const noteGlyph = duration.noteheadGlyph
    const flagName = duration.flagGlyph('up')
    const hasStem = dur !== 'w'
    const nhWidth = Bravura.width(noteGlyph)
    const noteX = 1
    const noteY = 26
    const stemX = noteX + nhWidth
    const stemY2 = noteY - ICON_STEM_HEIGHT
    return (
        <svg width={11} height={20} viewBox="0 0 16 30">
            {hasStem && <line x1={stemX} y1={noteY} x2={stemX} y2={stemY2} stroke="currentColor" strokeWidth={1.2} />}
            {flagName && <Glyph name={flagName} x={stemX} y={stemY2} fill="currentColor" />}
            <Glyph name={noteGlyph} x={noteX} y={noteY} fill="currentColor" />
        </svg>
    )
}

// --- Tie icon ---

/**
 * The tie curve on its own — the same tapered arc the score draws (see Tie.tsx),
 * thin at the ends and thick in the middle. Two noteheads plus the arc read as a
 * face at chip size, so the icon keeps only the mark the button actually toggles.
 */
function TieIcon() {
    const [x1, x2, y] = [2, 30, 6]
    const midX = (x1 + x2) / 2
    return (
        <svg width={18} height={11} viewBox="0 0 32 20">
            <path d={`M ${x1} ${y} Q ${midX} ${y + 9} ${x2} ${y} Q ${midX} ${y + 14} ${x1} ${y} Z`} fill="currentColor" />
        </svg>
    )
}

// --- Tuplet icon ---

function TupletIcon() {
    const numWidth = Bravura.width('timeSig3', TUPLET_NUMBER_SCALE)
    const gap = numWidth / 2 + 3
    const y = 10
    return (
        <svg width={18} height={11} viewBox="0 0 32 20">
            <rect x={1} y={y} width={1.5} height={5} fill="currentColor" />
            <rect x={1} y={y} width={16 - gap - 1} height={1.5} fill="currentColor" />
            <rect x={16 + gap} y={y} width={15 - gap} height={1.5} fill="currentColor" />
            <rect x={29.5} y={y} width={1.5} height={5} fill="currentColor" />
            <Glyph name="timeSig3" x={16 - numWidth / 2} y={y} scale={TUPLET_NUMBER_SCALE} fill="currentColor" />
        </svg>
    )
}
// --- Note tool-dock (docked along the editor's bottom edge) ---

interface NoteToolDockProps {
    accidental: Accidental | undefined
    duration: DurationType | undefined
    accidentalDisabled: boolean
    onAccidentalChange: (accidental: Accidental | undefined) => void
    onDurationChange: (duration: DurationType) => void
    dotted: boolean
    onDotToggle: () => void
    tuplet: boolean
    tupletDisabled: boolean
    onTupletToggle: () => void
    tie: boolean
    onTieToggle: () => void
    rest: boolean
    onRestToggle: () => void
    bpm: number
    onTempoSet: (bpm: number) => void
    clef: ClefType
    onClefSet: (clef: ClefType) => void
    keyFifths: number
    onKeySet: (fifths: number) => void
    time: { beatAmount: number; beatType: number }
    onTimeSet: (beatAmount: number, beatType: number) => void
    selectionDisabled: boolean
    /** Tighter group spacing so the tool rows fit a phone. */
    compact?: boolean
    /** When set, the pitch actions (minimize accidentals / transpose) join the score-settings well (mobile: the header has no room for them). */
    pitch?: {
        onMinimize: () => void
        score: Score
        selectedNotes: Note[]
        selectionNarrowsPitchOps: boolean
        onTranspose: (interval: Interval, scope: PitchScope) => void
        /** Forwarded to the popover's onScopeChange (the canvas pulse over its target). */
        onTransposeAim?: (scope: PitchScope | null) => void
    }
    /** When set, a metronome toggle joins the tool strip (mobile: the action row has no room for it). */
    metronome?: { active: boolean; onToggle: () => void }
    /** When set, undo/redo join the tool strip (mobile: the header has no room for them and there is no ⌘Z). */
    history?: { canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }
    /** Extra dock row rendered below the tools (the mobile action row). */
    footer?: ReactNode
}

/**
 * The tool dock from DESIGN.md: every selection-scoped edit control in one docked bar
 * along the editor's bottom edge — the chrome mirror of the slim header, so it can never
 * hang over the score. Each tool group sits in its own white capsule well (ToolGroup /
 * the Segmented track) so it lifts off the dock's tone — no dividers — and the
 * clef/key/tempo popovers open upward, away from the dock. New tool groups wrap onto
 * additional rows instead of overflowing.
 */
export function NoteToolDock({
    accidental,
    duration,
    accidentalDisabled,
    onAccidentalChange,
    onDurationChange,
    dotted,
    onDotToggle,
    tuplet,
    tupletDisabled,
    onTupletToggle,
    tie,
    onTieToggle,
    rest,
    onRestToggle,
    bpm,
    onTempoSet,
    clef,
    onClefSet,
    keyFifths,
    onKeySet,
    time,
    onTimeSet,
    selectionDisabled,
    compact = false,
    pitch,
    metronome,
    history,
    footer,
}: NoteToolDockProps) {
    return (
        <div className="shrink-0 z-20 px-3 sm:px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow">
            <div
                role="group"
                aria-label="Note tools"
                className={`mx-auto flex items-center justify-center flex-wrap gap-y-2 ${compact ? 'gap-x-3' : 'gap-x-6'}`}>
                <Segmented
                    ariaLabel="Note duration"
                    value={duration}
                    onChange={(v) => v && onDurationChange(v)}
                    options={DURATIONS.map((d) => ({ value: d, label: <DurationIcon dur={d} /> }))}
                />
                <ToolGroup ariaLabel="Note modifiers">
                    <ChipToggle plain active={dotted} onClick={onDotToggle} ariaLabel="Dotted" disabled={duration === '16'}>
                        ·
                    </ChipToggle>
                    <ChipToggle plain active={tuplet} onClick={onTupletToggle} disabled={tupletDisabled} ariaLabel="Triplet">
                        <TupletIcon />
                    </ChipToggle>
                    <ChipToggle plain active={rest} onClick={onRestToggle} ariaLabel="Rest">
                        <svg width={9} height={16} viewBox="0 0 16 30">
                            <Glyph name="restQuarter" x={1} y={20} fill="currentColor" />
                        </svg>
                    </ChipToggle>
                    <ChipToggle plain active={tie} onClick={onTieToggle} disabled={accidentalDisabled} ariaLabel="Tie">
                        <TieIcon />
                    </ChipToggle>
                </ToolGroup>
                <Segmented
                    ariaLabel="Accidental"
                    value={accidental}
                    onChange={onAccidentalChange}
                    options={ACCIDENTALS.map((a) => ({ value: a.value, label: a.label }))}
                />
                <ToolGroup ariaLabel="Score settings">
                    <ClefControl clef={clef} onSet={onClefSet} disabled={selectionDisabled} compact={compact} />
                    <KeySignatureControl fifths={keyFifths} onSet={onKeySet} disabled={selectionDisabled} compact={compact} />
                    <TimeSignatureControl time={time} onSet={onTimeSet} disabled={selectionDisabled} compact={compact} />
                    <TempoControl bpm={bpm} time={time} onSet={onTempoSet} disabled={selectionDisabled} compact={compact} />
                    {pitch && (
                        <>
                            <ChipToggle plain onClick={pitch.onMinimize} disabled={selectionDisabled} ariaLabel="Minimize accidentals">
                                <Icon name="natural" size={14} />
                            </ChipToggle>
                            <TransposeControl
                                score={pitch.score}
                                selectedNotes={pitch.selectedNotes}
                                selectionNarrowsPitchOps={pitch.selectionNarrowsPitchOps}
                                onApply={pitch.onTranspose}
                                onScopeChange={pitch.onTransposeAim}
                                disabled={selectionDisabled}
                                compact={compact}
                            />
                        </>
                    )}
                    {metronome && (
                        <ChipToggle plain active={metronome.active} onClick={metronome.onToggle} ariaLabel="Metronome">
                            <Icon name="audio-lines" size={14} />
                        </ChipToggle>
                    )}
                </ToolGroup>
                {history && (
                    <ToolGroup ariaLabel="History">
                        <ChipToggle plain onClick={history.onUndo} disabled={!history.canUndo} ariaLabel="Undo">
                            <Icon name="undo" size={14} />
                        </ChipToggle>
                        <ChipToggle plain onClick={history.onRedo} disabled={!history.canRedo} ariaLabel="Redo">
                            <Icon name="redo" size={14} />
                        </ChipToggle>
                    </ToolGroup>
                )}
            </div>
            {footer}
        </div>
    )
}

/**
 * The compact popover sheet: full viewport width just above the dock, scrolling when tall.
 * Shared with the in-score attribute popovers (page.tsx), which position it against a
 * `relative` wrapper around the dock rather than the dock's own containing block.
 */
export const COMPACT_POPOVER_SHEET = 'inset-x-2 bottom-full mb-2 w-auto! max-h-[60vh] overflow-y-auto'

/**
 * Popovers open upward from the dock, clear of its glass panel. In compact (mobile)
 * mode they become a sheet spanning the dock's width instead — anchored popovers
 * would clip at the viewport edges. (`fixed` resolves against the dock, whose
 * backdrop-filter makes it the containing block; the dock spans the viewport.)
 */
function popoverPosition(compact: boolean): string {
    return compact ? `fixed! ${COMPACT_POPOVER_SHEET}` : 'right-0 bottom-[calc(100%+0.75rem)]'
}

// --- Clef control ---

interface ClefControlProps {
    clef: ClefType
    onSet: (clef: ClefType) => void
    disabled: boolean
    compact: boolean
}

function ClefControl({ clef, onSet, disabled, compact }: ClefControlProps) {
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const [open, setOpen] = useState(false)

    return (
        <div ref={anchorRef} className="relative">
            <ChipToggle
                plain
                active={open}
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
                ariaLabel={`Clef: ${CLEF_DEFS[clef].label}`}>
                <ClefIcon type={clef} size={26} />
            </ChipToggle>
            {open && (
                <ClefPopover
                    active={clef}
                    anchorRef={anchorRef}
                    className={popoverPosition(compact)}
                    onSelect={(type) => {
                        onSet(type)
                        setOpen(false)
                    }}
                    onDismiss={() => setOpen(false)}
                />
            )}
        </div>
    )
}

// --- Key signature control ---

interface KeySignatureControlProps {
    fifths: number
    onSet: (fifths: number) => void
    disabled: boolean
    compact: boolean
}

function KeySignatureControl({ fifths, onSet, disabled, compact }: KeySignatureControlProps) {
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const [open, setOpen] = useState(false)

    return (
        <div ref={anchorRef} className="relative">
            <ChipToggle
                plain
                active={open}
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
                ariaLabel={`Key signature: ${keySignatureLabel(fifths)}`}>
                {fifths === 0 ? <span className="text-sm">♮</span> : <KeySignatureIcon fifths={fifths} size={24} />}
            </ChipToggle>
            {open && (
                <KeySignaturePopover
                    active={fifths}
                    anchorRef={anchorRef}
                    className={popoverPosition(compact)}
                    onSelect={(value) => {
                        onSet(value)
                        setOpen(false)
                    }}
                    onDismiss={() => setOpen(false)}
                />
            )}
        </div>
    )
}

// --- Time signature control ---

interface TimeSignatureControlProps {
    time: { beatAmount: number; beatType: number }
    onSet: (beatAmount: number, beatType: number) => void
    disabled: boolean
    compact: boolean
}

function TimeSignatureControl({ time, onSet, disabled, compact }: TimeSignatureControlProps) {
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const [open, setOpen] = useState(false)

    return (
        <div ref={anchorRef} className="relative">
            <ChipToggle
                plain
                active={open}
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
                ariaLabel={`Time signature: ${time.beatAmount}/${time.beatType}`}>
                <TimeSignatureIcon beatAmount={time.beatAmount} beatType={time.beatType} size={22} />
            </ChipToggle>
            {open && (
                <TimeSignaturePopover
                    active={time}
                    anchorRef={anchorRef}
                    className={popoverPosition(compact)}
                    onSelect={(beatAmount, beatType) => {
                        onSet(beatAmount, beatType)
                        setOpen(false)
                    }}
                    onDismiss={() => setOpen(false)}
                />
            )}
        </div>
    )
}

// --- Transpose control (the dock's trigger; the desktop header hosts its own) ---

interface TransposeControlProps {
    score: Score
    selectedNotes: Note[]
    selectionNarrowsPitchOps: boolean
    onApply: (interval: Interval, scope: PitchScope) => void
    onScopeChange?: (scope: PitchScope | null) => void
    disabled: boolean
    compact: boolean
}

function TransposeControl({ score, selectedNotes, selectionNarrowsPitchOps, onApply, onScopeChange, disabled, compact }: TransposeControlProps) {
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const [open, setOpen] = useState(false)

    return (
        <div ref={anchorRef} className="relative">
            <ChipToggle plain active={open} disabled={disabled} onClick={() => setOpen((o) => !o)} ariaLabel="Transpose">
                <Icon name="transpose" size={14} />
            </ChipToggle>
            {open && (
                <TransposePopover
                    score={score}
                    selectedNotes={selectedNotes}
                    selectionNarrowsPitchOps={selectionNarrowsPitchOps}
                    anchorRef={anchorRef}
                    className={popoverPosition(compact)}
                    onApply={(interval, scope) => {
                        onApply(interval, scope)
                        setOpen(false)
                    }}
                    onDismiss={() => setOpen(false)}
                    onScopeChange={onScopeChange}
                />
            )}
        </div>
    )
}

// --- Tempo control ---

interface TempoControlProps {
    /** Quarter-note bpm in effect at the selection. */
    bpm: number
    /** The meter at the selection: the chip and popover write the tempo in its felt beat (♩. = 60 in 6/8). */
    time: { beatAmount: number; beatType: number }
    onSet: (bpm: number) => void
    disabled: boolean
    compact: boolean
}

function TempoControl({ bpm, time, onSet, disabled, compact }: TempoControlProps) {
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const [open, setOpen] = useState(false)
    const timeSignature = useMemo(() => new TimeSignature(time.beatAmount, time.beatType), [time.beatAmount, time.beatType])
    const beat = timeSignature.pulse
    const pulseBpm = Math.round(timeSignature.pulseBpmOf(bpm))
    const unit = beat.beats === 1 ? '' : `${beat.name.replace(' ', '-')} `

    return (
        <div ref={anchorRef} className="relative">
            <ChipToggle
                plain
                active={open}
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
                ariaLabel={`Tempo: ${pulseBpm} ${unit}bpm`}>
                <span className="inline-flex items-center gap-1">
                    <BeatUnitIcon duration={beat} size={16} />= {pulseBpm}
                </span>
            </ChipToggle>
            {open && (
                <TempoPopover
                    initialBpm={bpm}
                    timeSignature={timeSignature}
                    anchorRef={anchorRef}
                    className={popoverPosition(compact)}
                    onSubmit={(value) => {
                        onSet(value)
                        setOpen(false)
                    }}
                    onDismiss={() => setOpen(false)}
                />
            )}
        </div>
    )
}
