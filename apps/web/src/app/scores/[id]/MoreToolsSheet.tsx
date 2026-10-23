'use client'

import { AccidentalIcon, BeatUnitIcon } from '@mushee/notation/components'
import type { Accidental } from '@mushee/notation/model'
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

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
    Keycap,
    Popover,
    Segmented,
    SHEET_SYSTEM_ROOM,
    Switch,
    type TooltipShortcut,
    usePickConfirmation,
} from '@/components/ui'
import { shortcutText, useKeyboardLayout } from '@/components/ui/Tooltip'

import { SET_ACCIDENTAL, TOGGLE_DOT, TOGGLE_REST, TOGGLE_TIE, TOGGLE_TUPLET } from './actions'
import {
    DOCK_UNIT_WELL,
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
        <div ref={anchorRef} className="relative flex">
            {/* A one-control dock well (see DOCK_UNIT_WELL), the same 46px silhouette as its neighbours. */}
            <div className={`${DOCK_UNIT_WELL} py-(--well-pad) px-1`}>
                <ChipToggle plain size="dock" popup active={open} onClick={() => setOpen(!open)} ariaLabel="More note tools">
                    <span className="inline-flex items-center gap-1">
                        More
                        <Icon name="chevron-up" size={14} />
                    </span>
                </ChipToggle>
            </div>
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
                            state={tools.simplify}
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
    const layout = useKeyboardLayout()
    const keys = shortcutText(shortcut, undefined, layout)
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
            {keys && <Keycap className="shrink-0">{keys}</Keycap>}
        </button>
    )
}

// --- Phones: the tool row's More tile, opening the "More tools" sheet ---

/** What the More sheet's body shows: its menu, or one picker swapped in (sheets never stack). */
type SheetView = 'menu' | 'clef' | 'key' | 'time' | 'tempo'

/**
 * The sharp-or-flat picker's options on the sheet, each drawn glyph (AccidentalIcon, by its
 * alteration) captioned in words — None first. The natural's name keeps its caption and the
 * word the dock and shortcuts use: "None (natural)".
 */
const SHEET_ACCIDENTALS: { value: Accidental | undefined; alter: -1 | 0 | 1; caption: string; name: string }[] = [
    { value: undefined, alter: 0, caption: 'None', name: 'None (natural)' },
    { value: 'b', alter: -1, caption: 'Flat', name: 'Flat' },
    { value: '#', alter: 1, caption: 'Sharp', name: 'Sharp' },
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
    /**
     * The menu (not a picker) opened or closed — the page then scrolls the selected note's row
     * into the strip the menu leaves clear above it. Keep referentially stable.
     */
    onMenuOpenChange?: (open: boolean) => void
}

/**
 * The phone dock's "More" tile and the sheet it opens: everything that isn't Undo or a note
 * length, each with a text label and its current value. "This note" holds the note tools
 * (Dotted, Triplet, Rest, Tie and Sharp or flat, each captioned in plain words); "Whole score"
 * Redo first (in reach without scrolling), then the clef / key / time / tempo pickers,
 * Transpose, Simplify sharps and flats and the metronome. A picker swaps in for the menu with a Back link — sheets never stack — and a pick
 * shows its fill for a beat before the sheet closes. With a note selected the menu stops about
 * one staff system short of the header (scrolling inside), so the note being fixed stays in
 * view while its tiles keep the sheet open.
 */
export function MoreToolsSheet({
    manipulator,
    metronome,
    onMetronomeToggle,
    transposeOpen,
    onTransposeOpenChange,
    onTransposeAim,
    onMenuOpenChange,
}: MoreToolsSheetProps) {
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const anchorRef = useRef<HTMLDivElement>(null)
    const [view, setView] = useState<SheetView | null>(null)
    const open = view !== null || transposeOpen
    const menuOpen = view === 'menu' && !transposeOpen
    useEffect(() => onMenuOpenChange?.(menuOpen), [menuOpen, onMenuOpenChange])
    // Gone with the dock's tool row (a take folds it away): the menu is closed then too.
    useEffect(() => () => onMenuOpenChange?.(false), [onMenuOpenChange])
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
                        instrument={score.instrument}
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
        // As tall as the note values' well beside it (the tool row stretches it), a capsule like every other unit.
        <div ref={anchorRef} className="shrink-0 self-stretch flex">
            <button
                type="button"
                aria-label="More tools"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => (open ? closeAll() : setView('menu'))}
                className={[
                    'self-stretch min-w-13 px-3.5 inline-flex flex-col items-center justify-center gap-0.5 rounded-full border-0 cursor-pointer',
                    'font-label font-semibold text-[11px] leading-none select-none [-webkit-touch-callout:none]',
                    'transition-[background-color,color] duration-150 ease-solkey focus-ring',
                    // Open is a tone darker, never cyan: it is open, not chosen — the sheet shows that.
                    open
                        ? 'bg-surface-container-high tonal-layer-glow text-on-surface'
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

/**
 * A section label in the More sheet's body ('This note', 'Whole score'): it pins to the top of the
 * scrolling body on the sheet's white, so a scrolled sheet always names its section. A flex row,
 * so the label's box is its own 11px line, not a 24px body line box.
 */
const STICKY_EYEBROW = 'sticky top-0 z-1 flex -mx-4 px-4 py-1.5 bg-surface-container-lowest'

/**
 * A place the folded menu may end: `peek` px past `row`'s bottom — room in which the 16px bottom
 * fade falls on blank space or on the next row's bare top, never across a filled control (the
 * sharp-or-flat track) or a label.
 */
interface MenuFold {
    row: Element | null
    peek: number
}

/** Past Redo: the top of the next row (Clef), under the fade. */
const PEEK_NEXT_ROW_PX = 20
/** Past 'This note': the gap before 'Whole score' (the body's gap-5), blank under the fade. */
const PEEK_SECTION_GAP_PX = 20
/** Past the tile grid: the 16px gap above the sharp-or-flat row (gap-2.5 plus its mt-1.5), blank under the fade. */
const PEEK_TRACK_GAP_PX = 16
/** Past the first tile row: the 8px grid gap and the next tiles' bare 8px top padding, under the fade. */
const PEEK_TILE_TOP_PX = 16

/**
 * The More sheet's own fit, set on its panel (the Popover's dialog) as the body's content and
 * its frame change size:
 * - the top fade sits under the pinned section label (`--sheet-fade-top`, its height), so the
 *   label is never washed out;
 * - with a note selected the sheet folds at the deepest of these that the room under the
 *   one-system strip ({@link SHEET_SYSTEM_ROOM}) actually holds: past `redo`, the first 'Whole
 *   score' row; past the end of 'This note' (`section`); past its `tileGrid`; past the grid's
 *   first row (`--sheet-peek-h`: that row's bottom plus its {@link MenuFold} peek). So the sheet
 *   ends on a whole row on any phone, never partway through one, and the body scrolls to the rest.
 */
function useMenuSheetFold(
    section: HTMLElement | null,
    tileGrid: HTMLElement | null,
    redo: Element | null,
    eyebrow: HTMLElement | null,
    fold: boolean,
) {
    useLayoutEffect(() => {
        const panel = section?.closest<HTMLElement>('[role="dialog"]')
        if (!section || !panel) return
        const body = section.closest<HTMLElement>('[data-popover-body]')
        const frame = panel.parentElement
        const folds: MenuFold[] = [
            { row: redo, peek: PEEK_NEXT_ROW_PX },
            { row: section, peek: PEEK_SECTION_GAP_PX },
            { row: tileGrid, peek: PEEK_TRACK_GAP_PX },
            { row: tileGrid?.firstElementChild ?? null, peek: PEEK_TILE_TOP_PX },
        ]
        const measure = () => {
            if (eyebrow) panel.style.setProperty('--sheet-fade-top', `${eyebrow.offsetHeight}px`)
            if (!fold || !redo) {
                panel.style.removeProperty('--sheet-peek-h')
                panel.style.removeProperty('max-height')
                return
            }
            const top = panel.getBoundingClientRect().top - (body?.scrollTop ?? 0)
            const room = (frame?.getBoundingClientRect().height ?? Infinity) - SHEET_SYSTEM_ROOM.px
            const heights = folds.flatMap(({ row, peek }) => (row ? [Math.ceil(row.getBoundingClientRect().bottom - top + peek)] : []))
            // The deepest fold that fits; on a phone too short for any, the shallowest.
            const height = heights.find((h) => h <= room) ?? heights[heights.length - 1]
            panel.style.setProperty('--sheet-peek-h', `${height}px`)
            panel.style.maxHeight = `min(100% - ${SHEET_SYSTEM_ROOM.px}px, var(--sheet-peek-h))`
        }
        measure()
        // 'This note' changing height (a reason line coming and going) moves the fold rows; the
        // frame changing height (the viewport, the dock) changes which of them fits.
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
        observer?.observe(section)
        if (frame) observer?.observe(frame)
        // The fit stays on the panel as it closes: its leaving copy keeps the same height.
        return () => observer?.disconnect()
    }, [section, tileGrid, redo, eyebrow, fold])
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
    const [thisNote, setThisNote] = useState<HTMLElement | null>(null)
    const [eyebrow, setEyebrow] = useState<HTMLElement | null>(null)
    const [tileGrid, setTileGrid] = useState<HTMLElement | null>(null)
    const [wholeScoreRows, setWholeScoreRows] = useState<HTMLElement | null>(null)
    const tools = new NoteToolStates(manipulator)
    const accidental = tools.accidental
    // The clef / key / time / tempo rows: off while a recording writes into the score, saying so.
    const settingsState = tools.scoreSettings
    const nothingSelected = !manipulator.selectedNote
    // Folded after Redo, the first 'Whole score' row, where the room allows; else at the deepest
    // whole part of 'This note' that fits.
    useMenuSheetFold(thisNote, tileGrid, wholeScoreRows?.firstElementChild ?? null, eyebrow, !nothingSelected)
    // A score of rests has nothing to transpose yet.
    const emptyScore = !manipulator.score?.hasPitchedNotes

    return (
        <Popover
            ariaLabel="More tools"
            title="More tools"
            onDismiss={onClose}
            anchorRef={anchorRef}
            variant="sheet"
            // The note being fixed stays in view above the sheet ("This note" leads, so it is whole).
            leaveRoomAbove={!nothingSelected}
            className="gap-5">
            <section ref={setThisNote} aria-label="This note" className="flex flex-col gap-2.5">
                <div ref={setEyebrow} className={`flex items-baseline justify-between gap-3 ${STICKY_EYEBROW}`}>
                    <Eyebrow>This note</Eyebrow>
                    {nothingSelected && (
                        <span className="font-body text-[12px] leading-tight text-on-surface-variant">Select a note first.</span>
                    )}
                </div>
                <div ref={setTileGrid} className="grid grid-cols-2 gap-2">
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
                {/* 16px under the tiles, so a sheet folded at the tiles ends in blank space, not across the track. */}
                <div className="mt-1.5 flex items-center justify-between gap-3">
                    <span className="flex flex-col gap-0.5 min-w-0">
                        <span className="font-label font-semibold text-[15px] leading-tight text-on-surface">Sharp or flat</span>
                        {/* On touch a reason is said inline; "Select a note first" is the section's caption already. */}
                        {accidental.reason && accidental.reason !== NEEDS_A_NOTE && (
                            <span className="font-body text-[11px] leading-tight text-on-surface-variant">{accidental.reason}</span>
                        )}
                    </span>
                    <Segmented
                        ariaLabel="Sharp or flat"
                        value={accidental.value}
                        disabled={accidental.disabled}
                        disabledReason={accidental.reason}
                        onChange={(value) => manipulator.run(SET_ACCIDENTAL, value)}
                        options={SHEET_ACCIDENTALS.map(({ value, alter, caption, name }) => ({
                            value,
                            ariaLabel: name,
                            label: (
                                <span className="flex flex-col items-center gap-1">
                                    <AccidentalIcon alter={alter} size={18} />
                                    <span className="font-body font-medium text-[11px] leading-none">{caption}</span>
                                </span>
                            ),
                        }))}
                    />
                </div>
            </section>

            <section aria-label="Whole score" className="flex flex-col gap-1">
                <div className={STICKY_EYEBROW}>
                    <Eyebrow>Whole score</Eyebrow>
                </div>
                <div ref={setWholeScoreRows} className="flex flex-col -mx-2">
                    {/* First, in reach without scrolling: one Undo too many after fixing notes is
                        taken back from here (Undo itself leads the tool row). */}
                    <SheetRow
                        label="Redo"
                        ariaLabel="Redo"
                        icon="redo"
                        hint={manipulator.canRedo ? 'Bring back what Undo took away.' : 'Nothing to redo yet.'}
                        disabled={!manipulator.canRedo}
                        action
                        onClick={() => {
                            manipulator.redo()
                            onClose()
                        }}
                    />
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
                    <SheetRow
                        label="Transpose"
                        ariaLabel="Transpose"
                        hint={emptyScore ? 'Record or add some notes first.' : undefined}
                        disabled={emptyScore}
                        onClick={onTranspose}
                    />
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
 * A "This note" toggle: its glyph, a 15px name and an 11px plain caption. The glyph's 18px box
 * sits on the name's line and the block hangs from the top, so the names in a row share a line
 * however their captions wrap. At rest it is a tile (the tile fill); pressed it takes the dock's
 * loud pressed fill — these are the dock's live toggles, not picked values. Off, it stays
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
                'min-h-16 flex items-start gap-2.5 px-3 py-2 rounded-lg border-0 text-left',
                'transition-colors duration-150 ease-solkey focus-ring select-none',
                state.active
                    ? 'bg-primary-container text-on-primary-container'
                    : `bg-(--tile-fill) text-on-surface ${state.disabled ? '' : 'hover:bg-(--tile-fill-hover)'}`,
                state.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
            ].join(' ')}>
            <span aria-hidden className="w-6 h-4.5 mt-px shrink-0 inline-flex items-center justify-center">
                {icon}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                <span className="font-label font-semibold text-[15px] leading-tight">{label}</span>
                <span id={captionId} className="font-body text-[11px] leading-tight opacity-80 text-pretty">
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
