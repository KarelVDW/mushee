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
        <svg width={10} height={18} viewBox="0 0 16 30">
            {hasStem && <line x1={stemX} y1={noteY} x2={stemX} y2={stemY2} stroke="currentColor" strokeWidth={1.2} />}
            {flagName && <Glyph name={flagName} x={stemX} y={stemY2} fill="currentColor" />}
            <Glyph name={noteGlyph} x={noteX} y={noteY} fill="currentColor" />
        </svg>
    )
}

// --- ControlBar ---

interface ControlBarProps {
    accidental: string | undefined
    duration: DurationType | undefined
    accidentalDisabled: boolean
    onAccidentalChange: (accidental: string | undefined) => void
    onDurationChange: (duration: DurationType) => void
    dotted: boolean
    onDotToggle: () => void
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
    playbackState: 'stopped' | 'playing' | 'paused'
    onPlayToggle: () => void
    onStop: () => void
    recordingState: 'idle' | 'countoff' | 'recording'
    onRecordToggle: () => void
    metronome: boolean
    onMetronomeToggle: () => void
}

export function ControlBar({
    accidental,
    duration,
    accidentalDisabled,
    onAccidentalChange,
    onDurationChange,
    dotted,
    onDotToggle,
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
    playbackState,
    onPlayToggle,
    onStop,
    recordingState,
    onRecordToggle,
    metronome,
    onMetronomeToggle,
}: ControlBarProps) {
    const isRecording = recordingState !== 'idle'
    const isPlaying = playbackState === 'playing'
    const canStop = playbackState !== 'stopped' || isRecording
    const playDisabled = isRecording

    return (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 py-3.5 bg-surface-container-lowest tonal-layer-glow">
            {/* LEFT — note input */}
            <div className="flex items-center gap-2 flex-wrap min-w-0">
                <Segmented
                    ariaLabel="Note duration"
                    value={duration}
                    onChange={(v) => v && onDurationChange(v)}
                    options={DURATIONS.map((d) => ({ value: d, label: <DurationIcon dur={d} /> }))}
                />
                <ChipToggle active={dotted} onClick={onDotToggle} ariaLabel="Dotted">
                    ·
                </ChipToggle>
                <ChipToggle active={rest} onClick={onRestToggle} ariaLabel="Rest">
                    <svg width={9} height={16} viewBox="0 0 16 30">
                        <Glyph name="restQuarter" x={1} y={20} fill="currentColor" />
                    </svg>
                </ChipToggle>
                <Segmented
                    ariaLabel="Accidental"
                    value={accidental}
                    onChange={onAccidentalChange}
                    options={ACCIDENTALS.map((a) => ({ value: a.value, label: a.label }))}
                />
                <ChipToggle active={tie} onClick={onTieToggle} disabled={accidentalDisabled}>
                    Tie
                </ChipToggle>
            </div>

            {/* CENTER — transport */}
            <div className="flex items-center gap-3.5">
                <TransportBtn size={36} onClick={onStop} ariaLabel="Stop" disabled={!canStop}>
                    <Icon name="square" size={14} />
                </TransportBtn>
                <TransportBtn
                    size={52}
                    tone="play"
                    active={isPlaying}
                    onClick={onPlayToggle}
                    ariaLabel={isPlaying ? 'Pause' : 'Play'}
                    disabled={playDisabled}>
                    <Icon name={isPlaying ? 'pause' : 'play'} size={24} />
                </TransportBtn>
                <TransportBtn size={68} tone="record" active={isRecording} onClick={onRecordToggle} ariaLabel="Record">
                    <Icon name="circle" size={28} />
                </TransportBtn>
                <TransportBtn size={36} active={metronome} onClick={onMetronomeToggle} ariaLabel="Metronome">
                    <Icon name="audio-lines" size={14} />
                </TransportBtn>
            </div>

            {/* RIGHT — clef + key + tempo readout / editor */}
            <div className="flex justify-end items-center gap-2">
                <ClefControl clef={clef} onSet={onClefSet} disabled={selectionDisabled} />
                <KeySignatureControl fifths={keyFifths} onSet={onKeySet} disabled={selectionDisabled} />
                <TempoControl bpm={bpm} onSet={onTempoSet} disabled={selectionDisabled} />
            </div>
        </div>
    )
}

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
                    className="right-0 top-[calc(100%+0.5rem)]"
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
            <ChipToggle active={open} disabled={disabled} onClick={() => setOpen((o) => !o)} ariaLabel={`Key signature: ${keySignatureLabel(fifths)}`}>
                {fifths === 0 ? <span className="text-sm">♮</span> : <KeySignatureGlyph fifths={fifths} size={24} />}
            </ChipToggle>
            {open && (
                <KeySignaturePopover
                    active={fifths}
                    anchorRef={anchorRef}
                    className="right-0 top-[calc(100%+0.5rem)]"
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
                    className="right-0 top-[calc(100%+0.5rem)]"
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
