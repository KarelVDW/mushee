'use client'

import { CLEF_DEFS, type ClefType, type DurationType, getGlyphWidth, Glyph, GLYPH_SCALE } from '@mushee/notation/components'
import { TUPLET_NUMBER_SCALE } from '@mushee/notation/components/constants'
import { type ReactNode, useRef, useState } from 'react'

import { ClefGlyph, ClefPopover } from '@/components/editor/ClefPopover'
import { KeySignatureGlyph, keySignatureLabel, KeySignaturePopover } from '@/components/editor/KeySignaturePopover'
import { TempoPopover } from '@/components/editor/TempoPopover'
import { ChipToggle, Icon, Segmented, TransportBtn } from '@/components/ui'

const ACCIDENTALS: { label: string; value: string | undefined }[] = [
    { label: '♮', value: undefined },
    { label: '♭', value: 'b' },
    { label: '♯', value: '#' },
]

const DURATIONS: DurationType[] = ['w', 'h', 'q', '8', '16']

// --- Duration icon ---

const ICON_STEM_HEIGHT = 22

function DurationIcon({ dur }: { dur: DurationType }) {
    const noteGlyph = dur === 'w' ? 'noteheadWhole' : dur === 'h' ? 'noteheadHalf' : 'noteheadBlack'
    const flagName = dur === '8' ? 'flag8thUp' : dur === '16' ? 'flag16thUp' : undefined
    const hasStem = dur !== 'w'
    const nhWidth = getGlyphWidth(noteGlyph, GLYPH_SCALE)
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

// --- Tuplet icon ---

function TupletIcon() {
    const numWidth = getGlyphWidth('timeSig3', TUPLET_NUMBER_SCALE)
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

// --- Transport (lives in the editor header) ---

export interface TransportControlsProps {
    playbackState: 'stopped' | 'playing' | 'paused'
    onPlayToggle: () => void
    onStop: () => void
    recordingState: 'idle' | 'countoff' | 'recording'
    onRecordToggle: () => void
    metronome: boolean
    onMetronomeToggle: () => void
    /** Thumb-sized buttons with the record button as the biggest of the set (the mobile dock). */
    large?: boolean
    /** The mobile dock hides the metronome here and hosts it in the tool strip instead. */
    showMetronome?: boolean
}

export function TransportControls({
    playbackState,
    onPlayToggle,
    onStop,
    recordingState,
    onRecordToggle,
    metronome,
    onMetronomeToggle,
    large = false,
    showMetronome = true,
}: TransportControlsProps) {
    const isRecording = recordingState !== 'idle'
    const isPlaying = playbackState === 'playing'
    const canStop = playbackState !== 'stopped' || isRecording

    return (
        <div className={`flex items-center shrink-0 ${large ? 'gap-2' : 'gap-2.5'}`}>
            <TransportBtn size={large ? 36 : 30} onClick={onStop} ariaLabel="Stop" disabled={!canStop}>
                <Icon name="square" size={large ? 14 : 12} />
            </TransportBtn>
            <TransportBtn
                size={large ? 46 : 40}
                tone="play"
                active={isPlaying}
                onClick={onPlayToggle}
                ariaLabel={isPlaying ? 'Pause' : 'Play'}
                disabled={isRecording}>
                <Icon name={isPlaying ? 'pause' : 'play'} size={large ? 20 : 18} />
            </TransportBtn>
            <TransportBtn size={large ? 54 : 40} tone="record" active={isRecording} onClick={onRecordToggle} ariaLabel="Record">
                <Icon name="circle" size={16} />
            </TransportBtn>
            {showMetronome && (
                <TransportBtn size={large ? 36 : 30} active={metronome} onClick={onMetronomeToggle} ariaLabel="Metronome">
                    <Icon name="audio-lines" size={large ? 14 : 12} />
                </TransportBtn>
            )}
        </div>
    )
}

// --- Mobile action row (bottom of the dock): note navigation, pitch nudges, transport ---

interface MobileEditorActionsProps {
    transport: TransportControlsProps
    onPrevious: () => void
    onNext: () => void
    onPitchUp: () => void
    onPitchDown: () => void
    onRemoveNote: () => void
    /** No note selected (nothing to navigate from or nudge). */
    disabled: boolean
}

/**
 * Touch replaces the keyboard: arrows become the note navigator, ArrowUp/Down become
 * pitch nudges, Backspace becomes the remove-note button, and the transport moves
 * down here where thumbs live. The record button stays the biggest, loudest control
 * on the screen.
 */
export function MobileEditorActions({
    transport,
    onPrevious,
    onNext,
    onPitchUp,
    onPitchDown,
    onRemoveNote,
    disabled,
}: MobileEditorActionsProps) {
    return (
        <div role="group" aria-label="Note navigation and transport" className="flex items-center justify-between gap-1.5 pt-2">
            <div className="flex items-center gap-1">
                <TransportBtn size={36} onClick={onPrevious} ariaLabel="Select previous note" disabled={disabled}>
                    <Icon name="chevron-left" size={18} />
                </TransportBtn>
                <TransportBtn size={36} onClick={onNext} ariaLabel="Select next note" disabled={disabled}>
                    <Icon name="chevron-right" size={18} />
                </TransportBtn>
            </div>
            <div className="flex items-center gap-1">
                <TransportBtn size={36} onClick={onPitchDown} ariaLabel="Lower pitch" disabled={disabled}>
                    <Icon name="chevron-down" size={18} />
                </TransportBtn>
                <TransportBtn size={36} onClick={onPitchUp} ariaLabel="Raise pitch" disabled={disabled}>
                    <Icon name="chevron-up" size={18} />
                </TransportBtn>
            </div>
            <TransportBtn size={36} onClick={onRemoveNote} ariaLabel="Remove note" disabled={disabled}>
                <Icon name="delete" size={18} />
            </TransportBtn>
            <TransportControls {...transport} large showMetronome={false} />
        </div>
    )
}

// --- Note tool-dock (floats over the bottom of the score area) ---

interface NoteToolDockProps {
    accidental: string | undefined
    duration: DurationType | undefined
    accidentalDisabled: boolean
    onAccidentalChange: (accidental: string | undefined) => void
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
    selectionDisabled: boolean
    /** Tighter group spacing so the tool rows fit a phone. */
    compact?: boolean
    /** When set, a metronome toggle joins the tool strip (mobile: the action row has no room for it). */
    metronome?: { active: boolean; onToggle: () => void }
    /** Extra dock row rendered below the tools (the mobile action row). */
    footer?: ReactNode
}

/**
 * The tool dock from DESIGN.md: every selection-scoped edit control in one docked bar
 * along the editor's bottom edge — the chrome mirror of the slim header, so it can never
 * hang over the score. Groups are separated by 1.5rem of space — no dividers — and the
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
    selectionDisabled,
    compact = false,
    metronome,
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
                <div className="flex items-center gap-1.5">
                    <ChipToggle active={dotted} onClick={onDotToggle} ariaLabel="Dotted">
                        ·
                    </ChipToggle>
                    <ChipToggle active={tuplet} onClick={onTupletToggle} disabled={tupletDisabled} ariaLabel="Triplet">
                        <TupletIcon />
                    </ChipToggle>
                    <ChipToggle active={rest} onClick={onRestToggle} ariaLabel="Rest">
                        <svg width={9} height={16} viewBox="0 0 16 30">
                            <Glyph name="restQuarter" x={1} y={20} fill="currentColor" />
                        </svg>
                    </ChipToggle>
                    <ChipToggle active={tie} onClick={onTieToggle} disabled={accidentalDisabled}>
                        Tie
                    </ChipToggle>
                </div>
                <Segmented
                    ariaLabel="Accidental"
                    value={accidental}
                    onChange={onAccidentalChange}
                    options={ACCIDENTALS.map((a) => ({ value: a.value, label: a.label }))}
                />
                <div className="flex items-center gap-1.5">
                    <ClefControl clef={clef} onSet={onClefSet} disabled={selectionDisabled} compact={compact} />
                    <KeySignatureControl fifths={keyFifths} onSet={onKeySet} disabled={selectionDisabled} compact={compact} />
                    <TempoControl bpm={bpm} onSet={onTempoSet} disabled={selectionDisabled} compact={compact} />
                    {metronome && (
                        <ChipToggle active={metronome.active} onClick={metronome.onToggle} ariaLabel="Metronome">
                            <Icon name="audio-lines" size={14} />
                        </ChipToggle>
                    )}
                </div>
            </div>
            {footer}
        </div>
    )
}

/**
 * Popovers open upward from the dock, clear of its glass panel. In compact (mobile)
 * mode they become a sheet spanning the dock's width instead — anchored popovers
 * would clip at the viewport edges. (`fixed` resolves against the dock, whose
 * backdrop-filter makes it the containing block; the dock spans the viewport.)
 */
function popoverPosition(compact: boolean): string {
    return compact ? 'fixed! inset-x-2 bottom-full mb-2 w-auto! max-h-[60vh] overflow-y-auto' : 'right-0 bottom-[calc(100%+0.75rem)]'
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
            <ChipToggle active={open} disabled={disabled} onClick={() => setOpen((o) => !o)} ariaLabel={`Clef: ${CLEF_DEFS[clef].label}`}>
                <ClefGlyph type={clef} size={26} />
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
                active={open}
                disabled={disabled}
                onClick={() => setOpen((o) => !o)}
                ariaLabel={`Key signature: ${keySignatureLabel(fifths)}`}>
                {fifths === 0 ? <span className="text-sm">♮</span> : <KeySignatureGlyph fifths={fifths} size={24} />}
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

// --- Tempo control ---

interface TempoControlProps {
    bpm: number
    onSet: (bpm: number) => void
    disabled: boolean
    compact: boolean
}

function TempoControl({ bpm, onSet, disabled, compact }: TempoControlProps) {
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const [open, setOpen] = useState(false)

    return (
        <div ref={anchorRef} className="relative">
            <ChipToggle active={open} disabled={disabled} onClick={() => setOpen((o) => !o)} ariaLabel={`Tempo: ${bpm} bpm`}>
                {bpm} bpm
            </ChipToggle>
            {open && (
                <TempoPopover
                    initialBpm={bpm}
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
