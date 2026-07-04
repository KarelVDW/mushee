'use client'

import { useRef, useState } from 'react'

import {
    CLEF_DEFS,
    ClefGlyph,
    ClefPopover,
    type ClefType,
    type DurationType,
    getGlyphWidth,
    Glyph,
    GLYPH_SCALE,
    KeySignatureGlyph,
    keySignatureLabel,
    KeySignaturePopover,
    TempoPopover,
} from '@/components/notation'
import { TUPLET_NUMBER_SCALE } from '@/components/notation/constants'
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

interface TransportControlsProps {
    playbackState: 'stopped' | 'playing' | 'paused'
    onPlayToggle: () => void
    onStop: () => void
    recordingState: 'idle' | 'countoff' | 'recording'
    onRecordToggle: () => void
    metronome: boolean
    onMetronomeToggle: () => void
}

export function TransportControls({
    playbackState,
    onPlayToggle,
    onStop,
    recordingState,
    onRecordToggle,
    metronome,
    onMetronomeToggle,
}: TransportControlsProps) {
    const isRecording = recordingState !== 'idle'
    const isPlaying = playbackState === 'playing'
    const canStop = playbackState !== 'stopped' || isRecording

    return (
        <div className="flex items-center gap-2.5 shrink-0">
            <TransportBtn size={30} onClick={onStop} ariaLabel="Stop" disabled={!canStop}>
                <Icon name="square" size={12} />
            </TransportBtn>
            <TransportBtn
                size={40}
                tone="play"
                active={isPlaying}
                onClick={onPlayToggle}
                ariaLabel={isPlaying ? 'Pause' : 'Play'}
                disabled={isRecording}>
                <Icon name={isPlaying ? 'pause' : 'play'} size={18} />
            </TransportBtn>
            <TransportBtn size={40} tone="record" active={isRecording} onClick={onRecordToggle} ariaLabel="Record">
                <Icon name="circle" size={16} />
            </TransportBtn>
            <TransportBtn size={30} active={metronome} onClick={onMetronomeToggle} ariaLabel="Metronome">
                <Icon name="audio-lines" size={12} />
            </TransportBtn>
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
}

/**
 * The floating glass tool-dock from DESIGN.md: every selection-scoped edit control in one
 * hand-held panel, hovering over the bottom of the score. Groups are separated by 1.5rem of
 * space — no dividers — and the clef/key/tempo popovers open upward, away from the dock.
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
}: NoteToolDockProps) {
    return (
        <div className="absolute inset-x-0 bottom-5 z-20 flex justify-center pointer-events-none px-4">
            <div
                role="group"
                aria-label="Note tools"
                className="pointer-events-auto glass-panel tonal-layer-glow rounded-lg px-5 py-2.5 flex items-center justify-center flex-wrap gap-x-6 gap-y-2">
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
                    <ClefControl clef={clef} onSet={onClefSet} disabled={selectionDisabled} />
                    <KeySignatureControl fifths={keyFifths} onSet={onKeySet} disabled={selectionDisabled} />
                    <TempoControl bpm={bpm} onSet={onTempoSet} disabled={selectionDisabled} />
                </div>
            </div>
        </div>
    )
}

// Popovers open upward from the dock, clear of its glass panel.
const POPOVER_POSITION = 'right-0 bottom-[calc(100%+0.75rem)]'

// --- Clef control ---

interface ClefControlProps {
    clef: ClefType
    onSet: (clef: ClefType) => void
    disabled: boolean
}

function ClefControl({ clef, onSet, disabled }: ClefControlProps) {
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
                    className={POPOVER_POSITION}
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
}

function KeySignatureControl({ fifths, onSet, disabled }: KeySignatureControlProps) {
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
                    className={POPOVER_POSITION}
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
}

function TempoControl({ bpm, onSet, disabled }: TempoControlProps) {
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
                    className={POPOVER_POSITION}
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
