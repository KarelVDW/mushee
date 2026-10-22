'use client'

import { BeatUnitIcon, ClefIcon, Glyph, KeySignatureIcon, TimeSignatureIcon } from '@mushee/notation/components'
import { Bravura } from '@mushee/notation/engraving/Bravura'
import { TUPLET_NUMBER_SCALE } from '@mushee/notation/engraving/constants'
import { type Accidental, CLEF_DEFS, type ClefType, Duration, type DurationType, TimeSignature } from '@mushee/notation/model'
import { type ReactNode, type RefObject, useRef, useState, useSyncExternalStore } from 'react'

import { ClefPopover } from '@/components/editor/ClefPopover'
import { KeySignaturePopover } from '@/components/editor/KeySignaturePopover'
import { TempoPopover } from '@/components/editor/TempoPopover'
import { TimeSignaturePopover } from '@/components/editor/TimeSignaturePopover'
import { ChipToggle, Segmented, ToolGroup } from '@/components/ui'

import { SET_ACCIDENTAL, SET_DURATION, TOGGLE_DOT, TOGGLE_REST, TOGGLE_TIE, TOGGLE_TUPLET } from './actions'
import type { ScoreManipulator } from './ScoreManipulator'

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

/** The key chip's compact label, e.g. "♮", "2♯", "3♭" (its accessible name). */
function keySignatureLabel(fifths: number): string {
    if (fifths === 0) return '♮'
    return fifths > 0 ? `${fifths}♯` : `${-fifths}♭`
}

/** The meter the (then disabled) time and tempo chips show while nothing is selected. */
const COMMON_TIME = new TimeSignature(4, 4)

interface NoteToolDockProps {
    manipulator: ScoreManipulator
    /** Tighter group spacing so the tool rows fit a phone, and popovers open as dock-wide sheets. */
    compact?: boolean
    /** Extra chips at the end of the score-settings well (mobile: the pitch tools and the metronome, which the header and action row have no room for). */
    settingsExtras?: ReactNode
    /** A tool group after the others (mobile: undo/redo — no header room and no ⌘Z). */
    trailingGroup?: ReactNode
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
 *
 * The dock reads the active note's state straight off the manipulator (it subscribes itself)
 * and dispatches every edit to it directly; which chips are enabled follows the model's rules.
 */
export function NoteToolDock({ manipulator, compact = false, settingsExtras, trailingGroup, footer }: NoteToolDockProps) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const score = manipulator.score
    if (!score) return null
    const note = manipulator.selectedNote

    const duration = note?.duration.type
    const clef = note?.clef.type ?? 'treble'
    const keyFifths = note?.keySignature.fifths ?? 0
    const bpm = score.bpmAt(note)
    // The meter at the selection: the tempo chip and popover write the tempo in its felt beat (♩. = 60 in 6/8).
    const timeSignature = note?.measure.timeSignature ?? COMMON_TIME
    const pulse = timeSignature.pulse
    const pulseBpm = Math.round(timeSignature.pulseBpmOf(bpm))
    const pulseUnit = pulse.beats === 1 ? '' : `${pulse.name.replace(' ', '-')} `
    // TOGGLE_TIE's own rule: it unties a tied note, and ties one only where the tie can bind.
    const canTie = manipulator.selectedNotes.some((n) => n.tiesForward || score.canTieForward(n))

    // Measure-context edits apply at the active note's position (mid-measure for clef / key /
    // tempo), through the same setters as the in-score glyph popovers.
    const setClef = (type: ClefType) => {
        const at = manipulator.activePosition
        if (at) manipulator.setClefAt(at.measureIndex, type, at.beat)
    }
    const setKey = (fifths: number) => {
        const at = manipulator.activePosition
        if (at) manipulator.setKeyAt(at.measureIndex, fifths, at.beat)
    }
    const setTime = (beatAmount: number, beatType: number) => {
        const at = manipulator.activePosition
        if (at) manipulator.setTimeSignatureAt(at.measureIndex, beatAmount, beatType)
    }
    const setTempo = (value: number) => {
        const at = manipulator.activePosition
        if (at) manipulator.setTempoAt(at.measureIndex, at.beat, value)
    }

    return (
        <div className="shrink-0 z-20 px-3 sm:px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow">
            <div
                role="group"
                aria-label="Note tools"
                className={`mx-auto flex items-center justify-center flex-wrap gap-y-2 ${compact ? 'gap-x-3' : 'gap-x-6'}`}>
                <Segmented
                    ariaLabel="Note duration"
                    value={duration}
                    onChange={(v) => v && manipulator.run(SET_DURATION, v)}
                    options={DURATIONS.map((d) => ({ value: d, label: <DurationIcon dur={d} /> }))}
                />
                <ToolGroup ariaLabel="Note modifiers">
                    <ChipToggle
                        plain
                        active={(note?.duration.dots ?? 0) > 0}
                        onClick={() => manipulator.run(TOGGLE_DOT)}
                        ariaLabel="Dotted"
                        disabled={!note || !Duration.canDot(note.duration.type)}>
                        ·
                    </ChipToggle>
                    <ChipToggle
                        plain
                        active={note?.inTuplet ?? false}
                        onClick={() => manipulator.run(TOGGLE_TUPLET)}
                        disabled={!note?.canToggleTuplet}
                        ariaLabel="Triplet">
                        <TupletIcon />
                    </ChipToggle>
                    <ChipToggle plain active={note?.isRest ?? false} onClick={() => manipulator.run(TOGGLE_REST)} ariaLabel="Rest">
                        <svg width={9} height={16} viewBox="0 0 16 30">
                            <Glyph name="restQuarter" x={1} y={20} fill="currentColor" />
                        </svg>
                    </ChipToggle>
                    <ChipToggle
                        plain
                        active={note?.tiesForward ?? false}
                        onClick={() => manipulator.run(TOGGLE_TIE)}
                        disabled={!canTie}
                        ariaLabel="Tie">
                        <TieIcon />
                    </ChipToggle>
                </ToolGroup>
                <Segmented
                    ariaLabel="Accidental"
                    value={note?.pitch?.accidental}
                    onChange={(accidental) => manipulator.run(SET_ACCIDENTAL, accidental)}
                    options={ACCIDENTALS.map((a) => ({ value: a.value, label: a.label }))}
                />
                <ToolGroup ariaLabel="Score settings">
                    <PopoverChip
                        plain
                        compact={compact}
                        disabled={!note}
                        ariaLabel={`Clef: ${CLEF_DEFS[clef].label}`}
                        chip={<ClefIcon type={clef} size={26} />}>
                        {({ anchorRef, className, close }) => (
                            <ClefPopover
                                active={clef}
                                anchorRef={anchorRef}
                                className={className}
                                onSelect={(type) => {
                                    setClef(type)
                                    close()
                                }}
                                onDismiss={close}
                            />
                        )}
                    </PopoverChip>
                    <PopoverChip
                        plain
                        compact={compact}
                        disabled={!note}
                        ariaLabel={`Key signature: ${keySignatureLabel(keyFifths)}`}
                        chip={keyFifths === 0 ? <span className="text-sm">♮</span> : <KeySignatureIcon fifths={keyFifths} size={24} />}>
                        {({ anchorRef, className, close }) => (
                            <KeySignaturePopover
                                active={keyFifths}
                                anchorRef={anchorRef}
                                className={className}
                                onSelect={(value) => {
                                    setKey(value)
                                    close()
                                }}
                                onDismiss={close}
                            />
                        )}
                    </PopoverChip>
                    <PopoverChip
                        plain
                        compact={compact}
                        disabled={!note}
                        ariaLabel={`Time signature: ${timeSignature.beatAmount}/${timeSignature.beatType}`}
                        chip={<TimeSignatureIcon beatAmount={timeSignature.beatAmount} beatType={timeSignature.beatType} size={22} />}>
                        {({ anchorRef, className, close }) => (
                            <TimeSignaturePopover
                                active={timeSignature}
                                anchorRef={anchorRef}
                                className={className}
                                onSelect={(beatAmount, beatType) => {
                                    setTime(beatAmount, beatType)
                                    close()
                                }}
                                onDismiss={close}
                            />
                        )}
                    </PopoverChip>
                    <PopoverChip
                        plain
                        compact={compact}
                        disabled={!note}
                        ariaLabel={`Tempo: ${pulseBpm} ${pulseUnit}bpm`}
                        chip={
                            <span className="inline-flex items-center gap-1">
                                <BeatUnitIcon duration={pulse} size={16} />= {pulseBpm}
                            </span>
                        }>
                        {({ anchorRef, className, close }) => (
                            <TempoPopover
                                initialBpm={bpm}
                                timeSignature={timeSignature}
                                anchorRef={anchorRef}
                                className={className}
                                onSubmit={(value) => {
                                    setTempo(value)
                                    close()
                                }}
                                onDismiss={close}
                            />
                        )}
                    </PopoverChip>
                    {settingsExtras}
                </ToolGroup>
                {trailingGroup}
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

// --- Popover chip: a ChipToggle that opens an anchored popover ---

interface PopoverChipProps {
    ariaLabel: string
    disabled?: boolean
    /** Phone layout: the popover opens as the dock-wide sheet (see {@link popoverPosition}). */
    compact: boolean
    /** Transparent at rest, for a chip inside a ToolGroup well (see ChipToggle). */
    plain?: boolean
    /** The chip's face. */
    chip: ReactNode
    /** Positioning classes for the popover; defaults to the dock's {@link popoverPosition}. */
    className?: string
    /** Controlled open state, for a popover something else can open too (Shift+T opens transpose). */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /** The popover, mounted only while open: anchor it at `anchorRef`, position it with `className`, dismiss with `close`. */
    children: (popover: { anchorRef: RefObject<HTMLDivElement | null>; className: string; close: () => void }) => ReactNode
}

/**
 * A chip that toggles an anchored popover — the one place the toggle and dismissal wiring
 * lives. The anchor wraps the chip, so the popover's outside-click dismissal ignores the chip
 * and its own toggle isn't fought. Owns its open state unless `open` is passed.
 */
export function PopoverChip({
    ariaLabel,
    disabled,
    compact,
    plain = false,
    chip,
    className,
    open: controlledOpen,
    onOpenChange,
    children,
}: PopoverChipProps) {
    const anchorRef = useRef<HTMLDivElement | null>(null)
    const [ownOpen, setOwnOpen] = useState(false)
    const open = controlledOpen ?? ownOpen
    const setOpen = (next: boolean) => {
        if (controlledOpen === undefined) setOwnOpen(next)
        onOpenChange?.(next)
    }
    const close = () => setOpen(false)

    return (
        <div ref={anchorRef} className="relative">
            <ChipToggle plain={plain} active={open} disabled={disabled} onClick={() => setOpen(!open)} ariaLabel={ariaLabel}>
                {chip}
            </ChipToggle>
            {open && children({ anchorRef, className: className ?? popoverPosition(compact), close })}
        </div>
    )
}
