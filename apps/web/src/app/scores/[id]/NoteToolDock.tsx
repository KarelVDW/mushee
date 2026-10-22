'use client'

import { BeatUnitIcon, ClefIcon } from '@mushee/notation/components'
import type { Accidental, DurationType } from '@mushee/notation/model'
import { type ReactNode, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

import { ClefPopover } from '@/components/editor/ClefPopover'
import { KeySignaturePopover } from '@/components/editor/KeySignaturePopover'
import type { PitchScope } from '@/components/editor/pitchScope'
import { TempoPopover } from '@/components/editor/TempoPopover'
import { TimeSignaturePopover } from '@/components/editor/TimeSignaturePopover'
import { ChipToggle, Icon, Segmented, ToolGroup } from '@/components/ui'

import { LOWER_PITCH, RAISE_PITCH, SET_ACCIDENTAL, SET_DURATION, TOGGLE_DOT, TOGGLE_REST } from './actions'
import { HistoryTools } from './HistoryTools'
import { MoreNoteTools, MoreToolsSheet } from './MoreToolsSheet'
import { DottedIcon, DURATION_TYPES, DurationIcon, NoteToolStates, RestIcon, ScoreSettingsWords } from './NoteToolParts'
import { PopoverChip } from './PopoverChip'
import type { ScoreManipulator } from './ScoreManipulator'

/** Each note value's name, and its length in beats where the beat is a quarter note. */
const DURATION_NAMES: Record<DurationType, { name: string; quarterBeats: string }> = {
    w: { name: 'Whole note', quarterBeats: '4 beats' },
    h: { name: 'Half note', quarterBeats: '2 beats' },
    q: { name: 'Quarter note', quarterBeats: '1 beat' },
    '8': { name: 'Eighth note', quarterBeats: 'half a beat' },
    '16': { name: 'Sixteenth note', quarterBeats: 'a quarter of a beat' },
}

/** The sharp-or-flat picker, lower to higher: its glyphs are notation (the one sanctioned unicode chrome). */
const ACCIDENTALS: { value: Accidental | undefined; glyph: string; name: string; hint: string; command: string }[] = [
    { value: 'b', glyph: '♭', name: 'Flat', hint: 'a half step lower', command: 'set-accidental:flat' },
    { value: undefined, glyph: '♮', name: 'Natural', hint: 'no sharp or flat', command: 'set-accidental:natural' },
    { value: '#', glyph: '♯', name: 'Sharp', hint: 'a half step higher', command: 'set-accidental:sharp' },
]

/** The first-selection hint (contract C10), per input: the mouse can aim at the staff, a finger uses the nudges. */
const MOVE_NOTE_HINT_DESKTOP = 'To move a note, click higher or lower on the staff, or press ↑ ↓.'

function MoveNoteHintPhone() {
    return (
        <>
            To move a note, use{' '}
            <span aria-hidden className="inline-flex items-center gap-0.5 align-middle">
                <Icon name="chevron-down" size={13} />
                <Icon name="chevron-up" size={13} />
            </span>
            <span className="sr-only">the pitch buttons</span> below.
        </>
    )
}

interface NoteToolDockProps {
    manipulator: ScoreManipulator
    /** Phone layout: one tool row (Undo · note length · More) and the More sheet; desktop shows every well. */
    compact?: boolean
    /** The metronome, which lives in the phone's More sheet (the desktop transport has its own). */
    metronome: boolean
    onMetronomeToggle: () => void
    /** The transpose popover's state, kept by the page (the transpose shortcut opens it too) — phones open it in the More sheet. */
    transposeOpen: boolean
    onTransposeOpenChange: (open: boolean) => void
    onTransposeAim: (scope: PitchScope | null) => void
    /**
     * The one line along the dock's top edge (contract C10). A hint passed here wins over the
     * dock's own first-selection hint; null keeps the slot empty.
     */
    hint?: ReactNode
    /**
     * While a take runs: the recording strip, in place of the hint line and every tool row
     * (contract C10). On phones it carries the record-as-stop button beside it, and the page
     * drops the footer for the take, so the dock shrinks to that one row.
     */
    recording?: ReactNode
    /** Extra dock row rendered below the tools (the mobile action row). */
    footer?: ReactNode
}

/** Slack around the phone dock's height animation, so focus rings at its edges aren't clipped (px). */
const RING_SLACK_PX = 4

/**
 * The phone dock's rows, with their height animated (200ms; at once under reduced motion) as
 * they change — the tool rows folding away into the recording strip when a take starts, and
 * back. Only on phones: the desktop dock's anchored popovers must never be clipped.
 */
function AnimatedHeight({ children }: { children: ReactNode }) {
    const inner = useRef<HTMLDivElement>(null)
    const [height, setHeight] = useState<number | null>(null)
    useLayoutEffect(() => {
        const el = inner.current
        if (!el) return
        const measure = () => setHeight(el.offsetHeight)
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(el)
        return () => observer.disconnect()
    }, [])
    return (
        <div
            className="-m-1 p-1 overflow-hidden transition-[height] duration-200 ease-solkey motion-reduce:transition-none"
            style={height === null ? undefined : { height: height + 2 * RING_SLACK_PX }}>
            <div ref={inner}>{children}</div>
        </div>
    )
}

/**
 * The tool dock from DESIGN.md: every selection-scoped edit control in one docked bar along
 * the editor's bottom edge — the chrome mirror of the slim header, so it never hangs over the
 * score. Desktop, left to right: Pitch (Higher · Lower) — Length (five values + Dotted) —
 * Sharp or flat — Rest — More (Triplet, Tie, Simplify sharps and flats) — the score's clef,
 * key, time and tempo. Each group sits in a white capsule well (or is a white chip on its
 * own), popovers open upward, and groups wrap onto more rows rather than overflow. Phones
 * get one tool row — Undo, the note values and a labelled More tile — and the rest in the
 * More sheet. Every icon-only control wears a tooltip with its live shortcut.
 *
 * The dock reads the selection's state straight off the manipulator (it subscribes itself)
 * and dispatches every edit to it directly; what is pressed, off and why follows
 * {@link NoteToolStates}.
 */
export function NoteToolDock({
    manipulator,
    compact = false,
    metronome,
    onMetronomeToggle,
    transposeOpen,
    onTransposeOpenChange,
    onTransposeAim,
    hint,
    recording,
    footer,
}: NoteToolDockProps) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const keybindings = manipulator.keybindings
    // Tooltips name live keys: a rebound shortcut re-renders the dock.
    useSyncExternalStore(keybindings.subscribe, keybindings.getSnapshot, keybindings.getSnapshot)
    const score = manipulator.score
    const settings = manipulator.settings
    if (!score || !settings) return null

    const tools = new NoteToolStates(manipulator)
    const words = new ScoreSettingsWords(settings)
    const shortcut = (command: string) => keybindings.shortcutFor(command)
    const ownHint =
        manipulator.selectedNote && manipulator.moveNoteHint.pending ? compact ? <MoveNoteHintPhone /> : MOVE_NOTE_HINT_DESKTOP : null
    const line = hint === undefined ? ownHint : hint

    const duration = tools.duration
    // Beats are counted in the felt pulse; only where that is a quarter does "Quarter note — 1 beat" hold.
    const beatsAreQuarters = words.pulseIsQuarter
    const durations = (
        <Segmented
            ariaLabel="Note duration"
            value={duration.value}
            disabled={duration.disabled}
            disabledReason={duration.reason}
            onChange={(type) => type && manipulator.run(SET_DURATION, type)}
            options={DURATION_TYPES.map((type) => ({
                value: type,
                label: <DurationIcon dur={type} />,
                ariaLabel: DURATION_NAMES[type].name,
                hint: beatsAreQuarters ? DURATION_NAMES[type].quarterBeats : undefined,
                shortcut: shortcut(`set-duration:${type}`),
            }))}
        />
    )

    return (
        <div
            className={`relative z-20 shrink-0 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] ${compact ? 'px-2' : 'px-3 sm:px-4'}`}>
            {/* The chrome tone and its blur sit on a layer of their own: a bar with a backdrop-filter
                would become the backdrop root of every popover and tooltip opened inside it. */}
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow"
            />
            {compact ? (
                <AnimatedHeight>
                    {recording ? (
                        <div className="flex items-center gap-2">{recording}</div>
                    ) : (
                        <>
                            {line && (
                                <p className="m-0 pb-2 text-center font-body font-normal text-[13px] leading-tight text-on-surface-variant truncate motion-safe:animate-[tooltip-in_200ms_var(--ease-solkey)]">
                                    {line}
                                </p>
                            )}
                            <div role="group" aria-label="Note tools" className="mx-auto flex items-center justify-center gap-x-2">
                                <HistoryTools manipulator={manipulator} compact />
                                {durations}
                                <MoreToolsSheet
                                    manipulator={manipulator}
                                    metronome={metronome}
                                    onMetronomeToggle={onMetronomeToggle}
                                    transposeOpen={transposeOpen}
                                    onTransposeOpenChange={onTransposeOpenChange}
                                    onTransposeAim={onTransposeAim}
                                />
                            </div>
                            {footer}
                        </>
                    )}
                </AnimatedHeight>
            ) : recording ? (
                <div className="flex justify-center">{recording}</div>
            ) : (
                <>
                    {line && (
                        <p className="m-0 pb-2 text-center font-body font-normal text-[13px] leading-tight text-on-surface-variant truncate motion-safe:animate-[tooltip-in_200ms_var(--ease-solkey)]">
                            {line}
                        </p>
                    )}
                    <div
                        role="group"
                        aria-label="Note tools"
                        className="mx-auto flex items-center justify-center flex-wrap gap-y-2 gap-x-6">
                        <ToolGroup ariaLabel="Pitch">
                            {(
                                [
                                    { label: 'Higher', icon: 'chevron-up', action: RAISE_PITCH },
                                    { label: 'Lower', icon: 'chevron-down', action: LOWER_PITCH },
                                ] as const
                            ).map(({ label, icon, action }) => (
                                <ChipToggle
                                    key={label}
                                    plain
                                    ariaLabel={label}
                                    disabled={tools.pitch.disabled}
                                    disabledReason={tools.pitch.reason}
                                    shortcut={shortcut(action.id)}
                                    onClick={() => manipulator.run(action)}>
                                    {/* 22px content in the chip's 7px padding: a 36px button. */}
                                    <span className="inline-flex items-center gap-1 h-5.5">
                                        <Icon name={icon} size={14} />
                                        {label}
                                    </span>
                                </ChipToggle>
                            ))}
                        </ToolGroup>
                        {/* Length: the five values and Dotted share one well; the Segmented's own track is
                            flattened into it, so Dotted (a toggle, not a sixth value) sits beside them. */}
                        <div
                            role="group"
                            aria-label="Note length"
                            className="inline-flex items-center gap-0.5 p-0.75 rounded-full bg-surface-container-lowest tonal-layer-glow *:[[role=group]]:p-0! *:[[role=group]]:bg-transparent! *:[[role=group]]:shadow-none!">
                            {durations}
                            <ChipToggle
                                plain
                                ariaLabel="Dotted"
                                active={tools.dotted.active}
                                disabled={tools.dotted.disabled}
                                disabledReason={tools.dotted.reason}
                                hint="one and a half times as long"
                                shortcut={shortcut(TOGGLE_DOT.id)}
                                onClick={() => manipulator.run(TOGGLE_DOT)}>
                                <span className="inline-flex -my-1">
                                    <DottedIcon />
                                </span>
                            </ChipToggle>
                        </div>
                        <Segmented
                            ariaLabel="Sharp or flat"
                            value={tools.accidental.value}
                            disabled={tools.accidental.disabled}
                            disabledReason={tools.accidental.reason}
                            onChange={(accidental) => manipulator.run(SET_ACCIDENTAL, accidental)}
                            options={ACCIDENTALS.map((a) => ({
                                value: a.value,
                                label: a.glyph,
                                ariaLabel: a.name,
                                hint: a.hint,
                                shortcut: shortcut(a.command),
                            }))}
                        />
                        <ChipToggle
                            ariaLabel="Rest"
                            active={tools.rest.active}
                            disabled={tools.rest.disabled}
                            disabledReason={tools.rest.reason}
                            hint="turn this note into silence"
                            shortcut={shortcut(TOGGLE_REST.id)}
                            onClick={() => manipulator.run(TOGGLE_REST)}>
                            <span className="inline-flex items-center gap-1.5">
                                <RestIcon height={12} />
                                Rest
                            </span>
                        </ChipToggle>
                        <MoreNoteTools manipulator={manipulator} />
                        <ToolGroup ariaLabel="Score settings">
                            <PopoverChip
                                plain
                                ariaLabel={words.clefLabel}
                                disabled={tools.scoreSettings.disabled}
                                disabledReason={tools.scoreSettings.reason}
                                tooltip={`${words.clef} clef`}
                                chip={<ClefIcon type={settings.clef} size={22} />}>
                                {({ anchorRef, className, close }) => (
                                    <ClefPopover
                                        active={settings.clef}
                                        anchorRef={anchorRef}
                                        className={className}
                                        onSelect={(type) => {
                                            manipulator.changeClef(type)
                                            close()
                                        }}
                                        onDismiss={close}
                                    />
                                )}
                            </PopoverChip>
                            <PopoverChip
                                plain
                                ariaLabel={words.keyLabel}
                                disabled={tools.scoreSettings.disabled}
                                disabledReason={tools.scoreSettings.reason}
                                hint="sharps or flats used throughout"
                                chip={<span className="font-label font-semibold text-[13px]">{words.key}</span>}>
                                {({ anchorRef, className, close }) => (
                                    <KeySignaturePopover
                                        active={settings.key.fifths}
                                        anchorRef={anchorRef}
                                        className={className}
                                        onSelect={(fifths) => {
                                            manipulator.changeKey(fifths)
                                            close()
                                        }}
                                        onDismiss={close}
                                    />
                                )}
                            </PopoverChip>
                            <PopoverChip
                                plain
                                ariaLabel={words.timeLabel}
                                disabled={tools.scoreSettings.disabled}
                                disabledReason={tools.scoreSettings.reason}
                                hint={settings.timeSignature.plainNamePerBar}
                                chip={<span className="font-mono font-medium text-[13px]">{words.time}</span>}>
                                {({ anchorRef, className, close }) => (
                                    <TimeSignaturePopover
                                        active={settings.timeSignature}
                                        anchorRef={anchorRef}
                                        className={className}
                                        onSelect={(beatAmount, beatType) => {
                                            manipulator.changeTimeSignature(beatAmount, beatType)
                                            close()
                                        }}
                                        onDismiss={close}
                                    />
                                )}
                            </PopoverChip>
                            <PopoverChip
                                plain
                                ariaLabel={words.tempoLabel}
                                disabled={tools.scoreSettings.disabled}
                                disabledReason={tools.scoreSettings.reason}
                                hint="how fast it plays"
                                chip={
                                    <span className="inline-flex items-center gap-1">
                                        {/* A compound meter's beat is not a quarter: the chip says which note it counts. */}
                                        {!words.pulseIsQuarter && <BeatUnitIcon duration={words.pulse} size={16} />}
                                        <span className="font-mono font-medium">{words.pulseBpm}</span> bpm
                                    </span>
                                }>
                                {({ anchorRef, className, close }) => (
                                    <TempoPopover
                                        initialBpm={settings.bpm}
                                        timeSignature={settings.timeSignature}
                                        anchorRef={anchorRef}
                                        className={className}
                                        onSubmit={(value) => {
                                            manipulator.changeTempo(value)
                                            close()
                                        }}
                                        onDismiss={close}
                                    />
                                )}
                            </PopoverChip>
                        </ToolGroup>
                    </div>
                    {footer}
                </>
            )}
        </div>
    )
}
