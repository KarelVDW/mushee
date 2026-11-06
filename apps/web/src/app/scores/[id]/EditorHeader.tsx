'use client'

import { useRouter } from 'next/navigation'
import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { PitchScope } from '@/components/editor/pitchScope'
import { ExportMenu } from '@/components/ExportMenu'
import { ChipToggle, Icon, Tooltip, Wordmark } from '@/components/ui'

import { SHOW_SHORTCUTS_KEY } from './commands'
import { HistoryMenu, HistoryTools } from './HistoryTools'
import { STOP_RECORDING_FIRST } from './NoteToolParts'
import { PitchTools } from './PitchTools'
import type { ScoreManipulator } from './ScoreManipulator'
import { ShareMenu } from './ShareMenu'
import { TransportControls, type TransportControlsProps } from './TransportControls'
import type { ScoreAutosave } from './useScoreAutosave'

/** What an empty title field shows, and what the tab calls an untitled score. */
export const UNTITLED_SCORE = 'Untitled score'

/**
 * How much room the desktop header has, between the phone header (`compact`) and the full one:
 * the queries the page matches to pick {@link HeaderFit}. Under 1280px the full set of labelled
 * chips no longer fits beside the centred transport (with a long instrument name, the wordmark
 * and a title at its floor, the full header needs about 1260px); under 1024px (iPad portrait,
 * half a laptop) not even with Share and Export icon-only.
 */
export const HEADER_FIT_QUERIES = { medium: '(max-width: 1279px)', narrow: '(max-width: 1023px)' } as const

/**
 * The desktop header's layout step. `full` labels everything. `medium` turns Share and Export
 * icon-only (names in their tooltips) and drops the wordmark. `narrow` also turns
 * Transpose icon-only, folds Undo, Redo and the shortcuts list into one chip, and lets the
 * transport's hidden Stop give up its slot.
 */
export type HeaderFit = 'full' | 'medium' | 'narrow'

/** How long "Saved" stays beside its check before the status shrinks to the check alone. */
const SAVED_WORD_MS = 3000
/** The word's fade, before it goes. */
const SAVED_FADE_MS = 300

interface EditorHeaderProps {
    scoreId: string
    shareToken: string | null
    manipulator: ScoreManipulator
    title: string
    onTitleChange: (title: string) => void
    /** Renaming ended from the keyboard or the phone's Done: the editor takes focus back. */
    onTitleDone: () => void
    onChangeInstrument: () => void
    /** The autosave's status (shown after the instrument chip) and its retry-now. */
    autosave: Pick<ScoreAutosave, 'status' | 'retryNow'>
    /**
     * Phone chrome: the transport and the pitch / history tools move into the dock, the
     * keyboard-shortcuts entry point goes, and the score-level chips turn icon-only.
     */
    compact: boolean
    /** The desktop header's layout step (ignored on phones, which are `compact`). */
    fit?: HeaderFit
    transport: TransportControlsProps
    /** The transpose popover's state, kept by the page (the transpose shortcut opens it too). */
    transposeOpen: boolean
    onTransposeOpenChange: (open: boolean) => void
    onTransposeAim: (scope: PitchScope | null) => void
    shortcutsOpen: boolean
    onOpenShortcuts: () => void
    /** The rendered score SVG, resolved at export time (the PDF's visual snapshot). */
    getSvg: () => SVGSVGElement | null
}

/**
 * The header's padding against the safe-area insets: 8px (20px from sm) at the sides and 8px on
 * top, or the inset where it is larger — the notch, the status bar, a landscape phone's sides.
 */
const HEADER_INSETS = [
    'pt-[max(0.5rem,env(safe-area-inset-top))]',
    'pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]',
    'sm:pl-[max(1.25rem,env(safe-area-inset-left))] sm:pr-[max(1.25rem,env(safe-area-inset-right))]',
].join(' ')

/** The fade the phone header's chips make while the title is being edited (instant under reduced motion). */
const EDIT_FADE = 'transition-opacity duration-150 ease-solkey motion-reduce:transition-none'

/**
 * The editor's slim header: back to the library, the title, the instrument chip and the save
 * status; the transport centred; then the document-level chrome — pitch and history tools,
 * keyboard shortcuts, and the Share / Export chips.
 *
 * Its chrome tone and blur sit on a layer of their own (like the dock's): a bar with a
 * backdrop-filter would be the backdrop root of every menu and tooltip opened inside it.
 *
 * On phones, editing the title gives it the whole row: the chips fade out and the field runs
 * to a Done button.
 */
export function EditorHeader({
    scoreId,
    shareToken,
    manipulator,
    title,
    onTitleChange,
    onTitleDone,
    onChangeInstrument,
    autosave,
    compact,
    fit = 'full',
    transport,
    transposeOpen,
    onTransposeOpenChange,
    onTransposeAim,
    shortcutsOpen,
    onOpenShortcuts,
    getSvg,
}: EditorHeaderProps) {
    const router = useRouter()
    const [editingTitle, setEditingTitle] = useState(false)
    const score = manipulator.score
    if (!score) return null
    // Only the phone header hands the row over to the title.
    const takenOver = compact && editingTitle
    const fade = `${EDIT_FADE} ${takenOver ? 'opacity-0 pointer-events-none' : 'opacity-100'}`
    const iconChips = compact || fit !== 'full'
    const narrow = !compact && fit === 'narrow'

    return (
        // Edge to edge on an installed phone (viewport-fit=cover): the bar's tone runs under the
        // notch and the status bar, its content padded clear of them and of the side insets.
        <header className={`relative z-10 flex items-center gap-2 sm:gap-4 pb-2 ${HEADER_INSETS}`}>
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow"
            />
            {/* Desktop: never narrower than its content with the title at its 96px floor (the
                title's mirror wraps, so it can't widen that floor), so a crowded header compacts
                (fit) rather than the transport painting over the title and the instrument chip. */}
            <div className={`flex items-center gap-1.5 sm:gap-2.5 flex-1 ${compact ? 'min-w-0' : ''}`}>
                {/* The arrow's ink (its tip 12.6px into the 40px button) lands on the paper's 8px
                    edge on phones: -12px against the header's 8px padding. */}
                <button
                    onClick={() => router.push('/scores')}
                    aria-label="Back to library"
                    className={[
                        'bg-transparent border-0 cursor-pointer text-on-surface-variant size-10 -ml-3 sm:-ml-2.5 shrink-0',
                        'inline-flex items-center justify-center rounded-full',
                        'hover:text-on-surface transition-colors duration-150 ease-solkey',
                        'focus-ring',
                    ].join(' ')}>
                    <Icon name="arrow-left" size={compact ? 18 : 20} />
                </button>
                {/* Gone below 1280px (HEADER_FIT_QUERIES.medium), where the chips start to compact;
                    the title then sits a little apart from it, no divider between. */}
                <Wordmark size={19} className="max-[80rem]:hidden" />
                <TitleField
                    value={title}
                    onChange={onTitleChange}
                    onDone={onTitleDone}
                    compact={compact}
                    onEditingChange={setEditingTitle}
                />
                <div inert={takenOver} className={`flex items-center gap-2 min-w-0 shrink-0 ${fade}`}>
                    <InstrumentSlot
                        instrumentName={score.instrument.displayName}
                        onChangeInstrument={onChangeInstrument}
                        locked={manipulator.historyLocked}
                        autosave={autosave}
                        compact={compact}
                    />
                </div>
            </div>
            {!compact && <TransportControls {...transport} collapseStop={narrow} />}
            {/* Three groups, a step apart (16px; 8px within each): Transpose, then the history well
                with the shortcuts list (one chip on a narrow header), then Share and Export.
                Phones keep only the last, its round chips 6px apart, each opening a sheet. */}
            <div inert={takenOver} className={`flex items-center shrink-0 sm:flex-1 justify-end ${compact ? 'gap-1.5' : 'gap-4'} ${fade}`}>
                {/* Pitch and history tools are document-level chrome (see PitchTools /
                    HistoryTools); on phones they move into the dock instead. A score of rests
                    has nothing to transpose: the chip — and its jargon — waits for the first note. */}
                {!compact && score.hasPitchedNotes && (
                    <PitchTools
                        manipulator={manipulator}
                        transposeOpen={transposeOpen}
                        onTransposeOpenChange={onTransposeOpenChange}
                        onTransposeAim={onTransposeAim}
                        iconOnly={narrow}
                    />
                )}
                {narrow && <HistoryMenu manipulator={manipulator} onOpenShortcuts={onOpenShortcuts} />}
                {!compact && !narrow && (
                    <div className="flex items-center gap-2">
                        <HistoryTools manipulator={manipulator} />
                        {/* It opens a dialog: open, it takes the tonal open state every popup trigger shares, never the pressed cyan. */}
                        <ChipToggle
                            popup
                            active={shortcutsOpen}
                            onClick={onOpenShortcuts}
                            ariaLabel="Keyboard shortcuts"
                            shortcut={[SHOW_SHORTCUTS_KEY.label]}
                            tooltipSide="bottom">
                            <Icon name="keyboard" size={16} />
                        </ChipToggle>
                    </div>
                )}
                <div className={`flex items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
                    <ShareMenu scoreId={scoreId} shareToken={shareToken} compact={iconChips} sheet={compact} />
                    <ExportMenu score={score} title={title} compact={iconChips} sheet={compact} getSvg={getSvg} />
                </div>
            </div>
        </header>
    )
}

const TITLE_TYPE = 'font-display font-medium text-[17px] leading-none tracking-[-0.01em]'

interface TitleFieldProps {
    value: string
    onChange: (value: string) => void
    onDone: () => void
    compact: boolean
    onEditingChange: (editing: boolean) => void
}

/**
 * The score title, edited in place; every keystroke autosaves. Enter (and the phone's Done)
 * finishes, Escape puts back the title it had when editing began; both hand focus back to
 * the editor. Blur just finishes.
 *
 * Desktop: it sizes to its text through an invisible mirror (so the instrument chip sits right
 * after it), up to min(32rem, 40vw), with an ellipsis at rest and the full title while
 * focused; hovering fills it and fades a pencil in, and names it 'Rename'. Phones: it takes the
 * row's spare width, and while focused it spans the header up to a Done button.
 */
function TitleField({ value, onChange, onDone, compact, onEditingChange }: TitleFieldProps) {
    const wrapperRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const valueAtStart = useRef(value)
    // Phones, while editing: how far the field reaches — from its own left edge to the header's padding.
    const [span, setSpan] = useState<number | null>(null)

    const begin = () => {
        valueAtStart.current = value
        onEditingChange(true)
        const wrapper = wrapperRef.current
        const header = wrapper?.closest('header')
        if (!compact || !wrapper || !header) return
        const padding = parseFloat(getComputedStyle(header).paddingRight) || 0
        setSpan(header.getBoundingClientRect().right - padding - wrapper.getBoundingClientRect().left)
    }
    const end = () => {
        setSpan(null)
        onEditingChange(false)
    }
    const finish = () => {
        inputRef.current?.blur()
        onDone()
    }
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            finish()
        } else if (e.key === 'Escape') {
            e.preventDefault()
            if (value !== valueAtStart.current) onChange(valueAtStart.current)
            finish()
        }
    }

    const input = (
        <input
            ref={inputRef}
            value={value}
            placeholder={UNTITLED_SCORE}
            onChange={(e) => onChange(e.target.value)}
            // Not the tooltip's business: a focused title field says what it is by itself.
            onFocus={(e) => {
                e.stopPropagation()
                begin()
            }}
            onBlur={end}
            onKeyDown={onKeyDown}
            enterKeyHint="done"
            aria-label="Score title"
            className={[
                TITLE_TYPE,
                'w-full min-w-0 bg-transparent border-0 outline-0 text-on-surface placeholder:text-on-surface-variant px-2 py-2 rounded-sm text-ellipsis',
                'hover:bg-surface-container focus:bg-surface-container focus:shadow-[inset_0_-2px_0_var(--color-primary)]',
                'transition-[background-color,box-shadow] duration-150 ease-solkey',
                compact ? '' : 'absolute inset-0 pointer-fine:pr-6',
            ].join(' ')}
        />
    )

    if (compact) {
        return (
            <div ref={wrapperRef} className="relative flex-1 min-w-0 h-10">
                <div
                    className={
                        span === null ? 'absolute inset-0 flex items-center' : 'absolute inset-y-0 left-0 z-10 flex items-center gap-1'
                    }
                    style={span === null ? undefined : { width: span }}>
                    {input}
                    {span !== null && (
                        <button
                            type="button"
                            // Keep focus in the field: the press itself finishes, not the blur.
                            onPointerDown={(e) => e.preventDefault()}
                            onClick={finish}
                            className={[
                                'shrink-0 h-10 px-3 rounded-full bg-transparent border-0 cursor-pointer',
                                'font-label font-semibold text-[14px] leading-none text-primary hover:bg-surface-container',
                                'transition-colors duration-150 ease-solkey focus-ring',
                            ].join(' ')}>
                            Done
                        </button>
                    )}
                </div>
            </div>
        )
    }

    // The outer box is the header's flex item: it gives way (down to 6rem) when the header is
    // crowded, and lets the tooltip's own wrapper (`> span`) shrink with it, so a long title
    // ellipsizes instead of running under the transport. The mirror sizes the field to its text
    // on one line (clamped there) but may break anywhere, so the title adds only its 6rem floor
    // to the header's minimum width, never its whole length.
    return (
        <div className="flex min-w-24 max-w-[min(32rem,40vw)] shrink xl:ml-3 [&>span]:min-w-0 [&>span]:shrink">
            <Tooltip label="Rename" side="bottom">
                <div ref={wrapperRef} className="group relative min-w-0 w-full">
                    <span
                        aria-hidden
                        className={`${TITLE_TYPE} invisible line-clamp-1 whitespace-pre-wrap break-all px-2 py-2 pointer-fine:pr-6`}>
                        {value || UNTITLED_SCORE}
                    </span>
                    {input}
                    <span
                        aria-hidden
                        className={[
                            'pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex text-on-surface-variant pointer-coarse:hidden',
                            'opacity-0 group-hover:opacity-100 group-focus-within:opacity-0 transition-opacity duration-150 ease-solkey',
                        ].join(' ')}>
                        <Icon name="pencil" size={14} />
                    </span>
                </div>
            </Tooltip>
        </div>
    )
}

interface InstrumentSlotProps {
    instrumentName: string
    onChangeInstrument: () => void
    /** A recording is writing into the score: the chip stays, off, and says why. */
    locked: boolean
    autosave: EditorHeaderProps['autosave']
    compact: boolean
}

/**
 * The instrument chip and, after it, where the save stands — subscribed to the autosave's
 * status on its own, so a save re-renders this slot rather than the page. Phones show the
 * status only when it needs attention, and then in the chip's place: the header has no
 * room for both.
 */
function InstrumentSlot({ instrumentName, onChangeInstrument, locked, autosave, compact }: InstrumentSlotProps) {
    const { status, retryNow } = autosave
    const { state, landed } = useSyncExternalStore(status.subscribe, status.getSnapshot, status.getSnapshot)

    if (state === 'retrying') {
        const retry = (
            <button
                type="button"
                onClick={retryNow}
                className={[
                    'shrink-0 inline-flex items-center gap-1 border-0 bg-transparent cursor-pointer rounded-full px-1.5 min-h-8 pointer-coarse:min-h-10',
                    'font-body font-medium text-[12px] leading-tight text-error text-left hover:bg-error/8',
                    'transition-colors duration-150 ease-solkey focus-ring',
                    compact ? 'max-w-28' : 'whitespace-nowrap',
                ].join(' ')}>
                <Icon name="refresh-cw" size={12} className="shrink-0" />
                Not saved yet — retrying
            </button>
        )
        return compact ? (
            retry
        ) : (
            <>
                <InstrumentChip name={instrumentName} onClick={onChangeInstrument} locked={locked} />
                <Tooltip hint="Try again now" side="bottom">
                    {retry}
                </Tooltip>
            </>
        )
    }
    // While a take writes into the score it saves all the time: the status stays quiet (its room
    // kept, so nothing shifts) and comes back when the take ends. A failing save still speaks up.
    return (
        <>
            <InstrumentChip name={instrumentName} onClick={onChangeInstrument} locked={locked} />
            {!compact && (
                <span className={`shrink-0 inline-flex ${locked ? 'invisible' : ''}`}>
                    {state === 'saving' ? (
                        <span className="font-body font-normal text-[12px] leading-none text-on-surface-variant whitespace-nowrap">
                            Saving…
                        </span>
                    ) : (
                        // A save that just landed says so in a word; the check alone stays after.
                        <SavedMark key={landed} justLanded={landed > 0} />
                    )}
                </span>
            )}
        </>
    )
}

/** The saved state: 'Saved' with its check for {@link SAVED_WORD_MS}, then the check alone (still named 'Saved'). */
function SavedMark({ justLanded }: { justLanded: boolean }) {
    const [phase, setPhase] = useState<'word' | 'fading' | 'check'>(justLanded ? 'word' : 'check')
    useEffect(() => {
        if (!justLanded) return
        const fade = setTimeout(() => setPhase('fading'), SAVED_WORD_MS)
        const done = setTimeout(() => setPhase('check'), SAVED_WORD_MS + SAVED_FADE_MS)
        return () => {
            clearTimeout(fade)
            clearTimeout(done)
        }
    }, [justLanded])
    return (
        <span className="shrink-0 inline-flex items-center gap-1 font-body font-normal text-[12px] leading-none text-on-surface-variant whitespace-nowrap">
            <Icon name="check" size={12} />
            <span
                className={[
                    'transition-opacity duration-300 ease-solkey motion-reduce:transition-none',
                    phase === 'check' ? 'sr-only' : phase === 'fading' ? 'opacity-0' : 'opacity-100',
                ].join(' ')}>
                Saved
            </span>
        </span>
    )
}

/**
 * The instrument pill: its identity tone, a 13px name and a chevron that says it opens something.
 * While a recording runs it stays in place but off — still focusable, its tooltip saying why —
 * since a new instrument would rewrite the bars the recording is filling.
 */
function InstrumentChip({ name, onClick, locked }: { name: string; onClick: () => void; locked: boolean }) {
    return (
        <Tooltip label="Change instrument" reason={locked ? STOP_RECORDING_FIRST : undefined} side="bottom">
            <button
                type="button"
                onClick={locked ? undefined : onClick}
                aria-disabled={locked || undefined}
                aria-label={`Change instrument (current: ${name})`}
                className={[
                    'shrink-0 inline-flex items-center gap-1 border-0 rounded-full px-3 min-h-8 pointer-coarse:min-h-10',
                    'font-label font-semibold text-[13px] leading-none whitespace-nowrap',
                    // Long names ellipsize where the header is tight (phones and the narrow desktop step).
                    'max-lg:max-w-28 min-w-0',
                    locked
                        ? 'cursor-not-allowed opacity-40 bg-secondary-soft/70 text-on-secondary-soft'
                        : 'cursor-pointer bg-secondary-soft/70 text-on-secondary-soft hover:bg-secondary-soft',
                    'transition-colors duration-150 ease-solkey',
                    'focus-ring',
                ].join(' ')}>
                <span className="truncate">{name}</span>
                <Icon name="chevron-down" size={12} className="shrink-0" />
            </button>
        </Tooltip>
    )
}
