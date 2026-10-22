'use client'

import { BeatUnitIcon } from '@mushee/notation/components'
import type { Accidental } from '@mushee/notation/model'
import { type ReactNode, useId, useRef, useState, useSyncExternalStore } from 'react'

import { ClefPopover } from '@/components/editor/ClefPopover'
import { KeySignaturePopover } from '@/components/editor/KeySignaturePopover'
import type { PitchScope } from '@/components/editor/pitchScope'
import { TempoPopover } from '@/components/editor/TempoPopover'
import { TimeSignaturePopover } from '@/components/editor/TimeSignaturePopover'
import { TransposePopover } from '@/components/editor/TransposePopover'
import {
    ChipToggle,
    Eyebrow,
    Icon,
    type IconName,
    Popover,
    Segmented,
    Switch,
    type TooltipShortcut,
    usePickConfirmation,
} from '@/components/ui'
import { shortcutText } from '@/components/ui/Tooltip'

import { SET_ACCIDENTAL, TOGGLE_DOT, TOGGLE_REST, TOGGLE_TIE, TOGGLE_TUPLET } from './actions'
import {
    DottedIcon,
    NEEDS_A_NOTE,
    NoteToolStates,
    RestIcon,
    ScoreSettingsWords,
    TieIcon,
    type ToolState,
    TupletIcon,
} from './NoteToolParts'
import type { ScoreManipulator } from './ScoreManipulator'

/** The "Simplify sharps and flats" tool, wherever it sits: what it does, in one line. */
const SIMPLIFY_LABEL = 'Simplify sharps and flats'

// --- Desktop: the dock's labelled More, an upward popover of the rarer note tools ---

/**
 * The desktop dock's "More": a labelled chip opening "More note tools" — Triplet, Tie and
 * Simplify sharps and flats, the tools a newcomer rarely needs, as 44px labelled rows (each
 * with its plain one-line hint and live shortcut). The toggles keep the panel open, so the
 * pressed state they set stays visible; Simplify acts and closes it.
 */
export function MoreNoteTools({ manipulator }: { manipulator: ScoreManipulator }) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const keybindings = manipulator.keybindings
    useSyncExternalStore(keybindings.subscribe, keybindings.getSnapshot, keybindings.getSnapshot)
    const anchorRef = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    const close = () => setOpen(false)
    const tools = new NoteToolStates(manipulator)

    return (
        <div ref={anchorRef} className="relative">
            <ChipToggle popup active={open} onClick={() => setOpen(!open)} ariaLabel="More note tools">
                <span className="inline-flex items-center gap-1">
                    More
                    <Icon name="chevron-up" size={12} />
                </span>
            </ChipToggle>
            {open && (
                <Popover
                    ariaLabel="More note tools"
                    title="More note tools"
                    onDismiss={close}
                    anchorRef={anchorRef}
                    viewportGutter={8}
                    className="w-84 gap-1 left-0 bottom-[calc(100%+0.75rem)]">
                    <div className="flex flex-col gap-0.5 pt-1.5 -mx-1.5">
                        <ToolRow
                            icon={<TupletIcon size={22} />}
                            label="Triplet"
                            hint="Three notes in the time of two"
                            shortcut={keybindings.shortcutFor('toggle-tuplet')}
                            state={tools.triplet}
                            toggle
                            onClick={() => manipulator.run(TOGGLE_TUPLET)}
                        />
                        <ToolRow
                            icon={<TieIcon size={22} />}
                            label="Tie"
                            hint="Hold into the next note of the same pitch"
                            shortcut={keybindings.shortcutFor('toggle-tie')}
                            state={tools.tie}
                            toggle
                            onClick={() => manipulator.run(TOGGLE_TIE)}
                        />
                        <ToolRow
                            icon={<Icon name="feather" size={18} />}
                            label={SIMPLIFY_LABEL}
                            hint="Fewest possible, same sound"
                            shortcut={keybindings.shortcutFor('minimize-accidentals')}
                            state={tools.pitch}
                            onClick={() => {
                                manipulator.minimizeAccidentals()
                                close()
                            }}
                        />
                    </div>
                </Popover>
            )}
        </div>
    )
}

interface ToolRowProps {
    icon: ReactNode
    label: string
    /** The plain line under the label; a disabled tool shows its reason here instead. */
    hint: string
    shortcut?: TooltipShortcut
    state: ToolState
    /** A pressed/unpressed toggle (aria-pressed), not a one-off action. */
    toggle?: boolean
    onClick: () => void
}

/**
 * One labelled tool in the desktop More popover: icon, name, one-line hint and the live key.
 * A disabled row stays focusable (aria-disabled) and says why on its hint line.
 */
function ToolRow({ icon, label, hint, shortcut, state, toggle = false, onClick }: ToolRowProps) {
    const hintId = useId()
    const keys = shortcutText(shortcut)
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={toggle ? state.active : undefined}
            aria-disabled={state.disabled || undefined}
            aria-describedby={hintId}
            onClick={state.disabled ? undefined : onClick}
            className={[
                'w-full min-h-11 flex items-center gap-3 px-2.5 py-1.5 rounded-md border-0 text-left',
                'transition-colors duration-150 ease-solkey focus-ring',
                state.disabled ? 'cursor-not-allowed opacity-40 bg-transparent' : 'cursor-pointer',
                !state.disabled &&
                    (state.active ? 'bg-primary-container text-on-primary-container' : 'bg-transparent hover:bg-surface-container-high'),
            ]
                .filter(Boolean)
                .join(' ')}>
            <span aria-hidden className="w-7 shrink-0 inline-flex justify-center text-on-surface">
                {icon}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="font-label font-semibold text-[14px] leading-tight text-on-surface">{label}</span>
                <span id={hintId} className="font-body text-[12px] leading-tight text-on-surface-variant">
                    {state.reason ?? hint}
                </span>
            </span>
            {keys && (
                <kbd className="shrink-0 font-label font-semibold text-[11px] leading-none text-on-surface bg-surface-container rounded-sm px-1.5 py-1">
                    {keys}
                </kbd>
            )}
        </button>
    )
}

// --- Phones: the tool row's More tile, opening the "More tools" sheet ---

/** What the More sheet's body shows: its menu, or one picker swapped in (sheets never stack). */
type SheetView = 'menu' | 'clef' | 'key' | 'time' | 'tempo'

/**
 * The sharp-or-flat picker's options on the sheet, each glyph captioned in words — None first.
 * The natural's name keeps its caption and the word the dock and shortcuts use: "None (natural)".
 */
const SHEET_ACCIDENTALS: { value: Accidental | undefined; glyph: string; caption: string; name: string }[] = [
    { value: undefined, glyph: '♮', caption: 'None', name: 'None (natural)' },
    { value: 'b', glyph: '♭', caption: 'Flat', name: 'Flat' },
    { value: '#', glyph: '♯', caption: 'Sharp', name: 'Sharp' },
]

interface MoreToolsSheetProps {
    manipulator: ScoreManipulator
    metronome: boolean
    onMetronomeToggle: () => void
    /** The transpose picker's open state, kept by the page — the transpose shortcut opens it too. */
    transposeOpen: boolean
    onTransposeOpenChange: (open: boolean) => void
    /** Forwarded to the transpose picker's onScopeChange: the canvas pulse over its target. Keep referentially stable. */
    onTransposeAim: (scope: PitchScope | null) => void
}

/**
 * The phone dock's "More" tile and the sheet it opens: everything that isn't Undo or a note
 * length, each with a text label and its current value. "This note" holds the note tools
 * (Dotted, Triplet, Rest, Tie and Sharp or flat, each captioned in plain words); "Whole score"
 * the clef / key / time / tempo pickers, Transpose, Simplify sharps and flats, the metronome
 * and Redo. A picker swaps in for the menu with a Back link — sheets never stack — and a pick
 * shows its fill for a beat before the sheet closes.
 */
export function MoreToolsSheet({
    manipulator,
    metronome,
    onMetronomeToggle,
    transposeOpen,
    onTransposeOpenChange,
    onTransposeAim,
}: MoreToolsSheetProps) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const anchorRef = useRef<HTMLDivElement>(null)
    const [view, setView] = useState<SheetView | null>(null)
    const open = view !== null || transposeOpen
    const closeAll = () => {
        setView(null)
        if (transposeOpen) onTransposeOpenChange(false)
    }
    const confirmAndClose = usePickConfirmation(closeAll, true)
    const back = () => {
        if (transposeOpen) onTransposeOpenChange(false)
        setView('menu')
    }

    const score = manipulator.score
    const settings = manipulator.settings
    if (!score || !settings) return null
    const words = new ScoreSettingsWords(settings)
    const lead = <BackLink onClick={back} />

    const sheet = (() => {
        if (transposeOpen) {
            return (
                <TransposePopover
                    variant="sheet"
                    lead={lead}
                    score={score}
                    selectedNotes={manipulator.selectedNotes}
                    selectionNarrowsPitchOps={manipulator.selectionNarrowsPitchOps}
                    anchorRef={anchorRef}
                    onApply={(interval, scope) => {
                        manipulator.transpose(interval, scope)
                        closeAll()
                    }}
                    onDismiss={closeAll}
                    onScopeChange={onTransposeAim}
                />
            )
        }
        switch (view) {
            case 'clef':
                return (
                    <ClefPopover
                        variant="sheet"
                        lead={lead}
                        active={settings.clef}
                        anchorRef={anchorRef}
                        onSelect={(type) => {
                            manipulator.changeClef(type)
                            confirmAndClose()
                        }}
                        onDismiss={closeAll}
                    />
                )
            case 'key':
                return (
                    <KeySignaturePopover
                        variant="sheet"
                        lead={lead}
                        active={settings.key.fifths}
                        anchorRef={anchorRef}
                        onSelect={(fifths) => {
                            manipulator.changeKey(fifths)
                            confirmAndClose()
                        }}
                        onDismiss={closeAll}
                    />
                )
            case 'time':
                return (
                    <TimeSignaturePopover
                        variant="sheet"
                        lead={lead}
                        active={settings.timeSignature}
                        anchorRef={anchorRef}
                        onSelect={(beatAmount, beatType) => {
                            manipulator.changeTimeSignature(beatAmount, beatType)
                            confirmAndClose()
                        }}
                        onDismiss={closeAll}
                    />
                )
            case 'tempo':
                return (
                    <TempoPopover
                        variant="sheet"
                        lead={lead}
                        initialBpm={settings.bpm}
                        timeSignature={settings.timeSignature}
                        anchorRef={anchorRef}
                        onSubmit={(bpm) => {
                            manipulator.changeTempo(bpm)
                            closeAll()
                        }}
                        onDismiss={closeAll}
                    />
                )
            case 'menu':
                return (
                    <MoreToolsMenu
                        manipulator={manipulator}
                        words={words}
                        anchorRef={anchorRef}
                        metronome={metronome}
                        onMetronomeToggle={onMetronomeToggle}
                        onOpen={setView}
                        onTranspose={() => onTransposeOpenChange(true)}
                        onClose={closeAll}
                    />
                )
            default:
                return null
        }
    })()

    return (
        <div ref={anchorRef} className="shrink-0">
            <button
                type="button"
                aria-label="More tools"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => (open ? closeAll() : setView('menu'))}
                className={[
                    'w-11 h-12 inline-flex flex-col items-center justify-center gap-0.5 rounded-2xl border-0 cursor-pointer',
                    'font-label font-semibold text-[11px] leading-none select-none [-webkit-touch-callout:none]',
                    'transition-[background-color,color] duration-150 ease-solkey focus-ring',
                    open
                        ? 'bg-primary-container text-on-primary-container'
                        : 'bg-surface-container-lowest tonal-layer-glow text-on-surface hover:bg-surface-container-high',
                ].join(' ')}>
                <Icon name="more-horizontal" size={18} />
                More
            </button>
            {sheet}
        </div>
    )
}

/** The sheet's way back from a picker to its menu: "‹ Back". */
function BackLink({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="self-start -ml-2 h-10 px-2 inline-flex items-center gap-1 rounded-full border-0 bg-transparent cursor-pointer font-label font-semibold text-[13px] leading-none text-primary hover:bg-surface-container-high transition-colors duration-150 ease-solkey focus-ring">
            <Icon name="chevron-left" size={16} />
            Back
        </button>
    )
}

interface MoreToolsMenuProps {
    manipulator: ScoreManipulator
    words: ScoreSettingsWords
    anchorRef: { current: HTMLElement | null }
    metronome: boolean
    onMetronomeToggle: () => void
    onOpen: (view: SheetView) => void
    onTranspose: () => void
    onClose: () => void
}

/** The More sheet's menu: the note tools for the selection, then the whole score's settings and tools. */
function MoreToolsMenu({ manipulator, words, anchorRef, metronome, onMetronomeToggle, onOpen, onTranspose, onClose }: MoreToolsMenuProps) {
    const tools = new NoteToolStates(manipulator)
    const accidental = tools.accidental
    // The clef / key / time / tempo rows: off while a recording writes into the score, saying so.
    const settingsState = tools.scoreSettings
    const nothingSelected = !manipulator.selectedNote

    return (
        <Popover ariaLabel="More tools" title="More tools" onDismiss={onClose} anchorRef={anchorRef} variant="sheet" className="gap-5">
            <section aria-label="This note" className="flex flex-col gap-2.5">
                <div className="flex items-baseline justify-between gap-3">
                    <Eyebrow>This note</Eyebrow>
                    {nothingSelected && (
                        <span className="font-body text-[12px] leading-tight text-on-surface-variant">Select a note first.</span>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <NoteTile
                        icon={<DottedIcon />}
                        label="Dotted"
                        caption="Half as long again"
                        state={tools.dotted}
                        onClick={() => manipulator.run(TOGGLE_DOT)}
                    />
                    <NoteTile
                        icon={<TupletIcon size={22} />}
                        label="Triplet"
                        caption="Three in the time of two"
                        state={tools.triplet}
                        onClick={() => manipulator.run(TOGGLE_TUPLET)}
                    />
                    <NoteTile
                        icon={<RestIcon height={16} />}
                        label="Rest"
                        caption="A silence instead of a note"
                        state={tools.rest}
                        onClick={() => manipulator.run(TOGGLE_REST)}
                    />
                    <NoteTile
                        icon={<TieIcon size={22} />}
                        label="Tie"
                        caption="Joins to the next note"
                        state={tools.tie}
                        onClick={() => manipulator.run(TOGGLE_TIE)}
                    />
                </div>
                <div className="flex items-center justify-between gap-3">
                    <span className="font-label font-semibold text-[15px] leading-tight text-on-surface">Sharp or flat</span>
                    <Segmented
                        ariaLabel="Sharp or flat"
                        value={accidental.value}
                        disabled={accidental.disabled}
                        disabledReason={accidental.reason}
                        onChange={(value) => manipulator.run(SET_ACCIDENTAL, value)}
                        options={SHEET_ACCIDENTALS.map(({ value, glyph, caption, name }) => ({
                            value,
                            ariaLabel: name,
                            label: (
                                <span className="flex flex-col items-center gap-1">
                                    <span className="text-[16px] leading-none">{glyph}</span>
                                    <span className="font-body font-medium text-[11px] leading-none">{caption}</span>
                                </span>
                            ),
                        }))}
                    />
                </div>
            </section>

            <section aria-label="Whole score" className="flex flex-col gap-1">
                <Eyebrow>Whole score</Eyebrow>
                <div className="flex flex-col -mx-2">
                    <SheetRow
                        label="Clef"
                        ariaLabel={words.clefLabel}
                        value={words.clef}
                        hint={settingsState.reason}
                        disabled={settingsState.disabled}
                        onClick={() => onOpen('clef')}
                    />
                    <SheetRow
                        label="Key"
                        ariaLabel={words.keyLabel}
                        value={words.key}
                        hint={settingsState.reason}
                        disabled={settingsState.disabled}
                        onClick={() => onOpen('key')}
                    />
                    <SheetRow
                        label="Time"
                        ariaLabel={words.timeLabel}
                        value={<span className="font-mono">{words.time}</span>}
                        hint={settingsState.reason}
                        disabled={settingsState.disabled}
                        onClick={() => onOpen('time')}
                    />
                    <SheetRow
                        label="Tempo"
                        ariaLabel={words.tempoLabel}
                        hint={settingsState.reason}
                        disabled={settingsState.disabled}
                        value={
                            <span className="inline-flex items-center gap-1">
                                <BeatUnitIcon duration={words.pulse} size={15} />
                                <span className="font-mono">= {words.pulseBpm}</span>
                            </span>
                        }
                        onClick={() => onOpen('tempo')}
                    />
                    <SheetRow label="Transpose" ariaLabel="Transpose" onClick={onTranspose} />
                    <SheetRow
                        label={SIMPLIFY_LABEL}
                        ariaLabel={SIMPLIFY_LABEL}
                        hint={nothingSelected ? 'Select a note first.' : 'Rewrites notes with the fewest sharps and flats.'}
                        disabled={nothingSelected}
                        action
                        onClick={() => {
                            manipulator.minimizeAccidentals()
                            onClose()
                        }}
                    />
                    <div className="px-2 py-2.5">
                        <Switch
                            checked={metronome}
                            onChange={onMetronomeToggle}
                            label={<SheetLabel>Metronome</SheetLabel>}
                            hint="A steady click while playing and recording."
                        />
                    </div>
                    <SheetRow
                        label="Redo"
                        ariaLabel="Redo"
                        icon="redo"
                        disabled={!manipulator.canRedo}
                        action
                        onClick={() => {
                            manipulator.redo()
                            onClose()
                        }}
                    />
                </div>
            </section>
        </Popover>
    )
}

function SheetLabel({ children }: { children: ReactNode }) {
    return <span className="font-label font-semibold text-[15px] leading-tight text-on-surface">{children}</span>
}

interface NoteTileProps {
    icon: ReactNode
    label: string
    caption: string
    state: ToolState
    onClick: () => void
}

/**
 * A "This note" toggle: its glyph, a 15px name and an 11px plain caption. Off, it stays
 * focusable (aria-disabled); a tool that is off for a reason of its own (Tie, a run of notes)
 * says that reason in place of the caption.
 */
function NoteTile({ icon, label, caption, state, onClick }: NoteTileProps) {
    const captionId = useId()
    // "Select a note first" is the section's caption already; a tile repeats only its own reasons.
    const ownReason = state.reason && state.reason !== NEEDS_A_NOTE ? state.reason : null
    return (
        <button
            type="button"
            aria-label={label}
            aria-pressed={state.active}
            aria-disabled={state.disabled || undefined}
            aria-describedby={captionId}
            onClick={state.disabled ? undefined : onClick}
            className={[
                'min-h-14 flex items-center gap-2.5 px-3 py-2 rounded-lg border-0 text-left',
                'transition-colors duration-150 ease-solkey focus-ring select-none',
                state.active ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-low text-on-surface',
                state.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
            ].join(' ')}>
            <span aria-hidden className="w-6 shrink-0 inline-flex justify-center">
                {icon}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="font-label font-semibold text-[15px] leading-tight">{label}</span>
                <span id={captionId} className="font-body text-[11px] leading-tight opacity-80">
                    {ownReason ?? caption}
                </span>
            </span>
        </button>
    )
}

interface SheetRowProps {
    label: string
    ariaLabel: string
    /** The current value, right-aligned ("Treble", "C major"). */
    value?: ReactNode
    hint?: string
    icon?: IconName
    disabled?: boolean
    /** Acts at once (no chevron) rather than opening a picker. */
    action?: boolean
    onClick: () => void
}

/** A "Whole score" row: a 48px label with its value, opening its picker (chevron) or acting. */
function SheetRow({ label, ariaLabel, value, hint, icon, disabled = false, action = false, onClick }: SheetRowProps) {
    const hintId = useId()
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-describedby={hint ? hintId : undefined}
            aria-disabled={disabled || undefined}
            onClick={disabled ? undefined : onClick}
            className={[
                'min-h-12 flex items-center gap-3 px-2 py-1.5 rounded-md border-0 bg-transparent text-left',
                'transition-colors duration-150 ease-solkey focus-ring',
                disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-surface-container-high',
            ].join(' ')}>
            {icon && <Icon name={icon} size={16} />}
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <SheetLabel>{label}</SheetLabel>
                {hint && (
                    <span id={hintId} className="font-body text-[12px] leading-tight text-on-surface-variant">
                        {hint}
                    </span>
                )}
            </span>
            {value !== undefined && <span className="shrink-0 font-body text-[13px] leading-none text-on-surface-variant">{value}</span>}
            {!action && <Icon name="chevron-right" size={16} />}
        </button>
    )
}
