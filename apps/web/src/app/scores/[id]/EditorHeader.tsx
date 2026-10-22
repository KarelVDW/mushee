'use client'

import { useRouter } from 'next/navigation'
import { type KeyboardEvent, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { PitchScope } from '@/components/editor/pitchScope'
import { ExportMenu } from '@/components/ExportMenu'
import { ChipToggle, Icon, Tooltip, Wordmark } from '@/components/ui'

import { SHOW_SHORTCUTS_KEY } from './commands'
import { HistoryTools } from './HistoryTools'
import { PitchTools } from './PitchTools'
import { RecordingsMenu } from './RecordingsMenu'
import type { ScoreManipulator } from './ScoreManipulator'
import { ShareMenu } from './ShareMenu'
import { TransportControls, type TransportControlsProps } from './TransportControls'
import type { ScoreAutosave } from './useScoreAutosave'

/** What an empty title field shows, and what the tab calls an untitled score. */
export const UNTITLED_SCORE = 'Untitled score'

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

/** The fade the phone header's chips make while the title is being edited (instant under reduced motion). */
const EDIT_FADE = 'transition-opacity duration-150 ease-solkey motion-reduce:transition-none'

/**
 * The editor's slim header: back to the library, the title, the instrument chip and the save
 * status; the transport centred; then the document-level chrome — pitch and history tools,
 * keyboard shortcuts, and the Share / Recordings / Export chips.
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

    return (
        <header className="relative z-10 flex items-center gap-2 sm:gap-4 px-3 sm:px-5 py-2">
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow"
            />
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1">
                <button
                    onClick={() => router.push('/scores')}
                    aria-label="Back to library"
                    className={[
                        'bg-transparent border-0 cursor-pointer text-on-surface-variant size-10 -ml-2.5 shrink-0',
                        'inline-flex items-center justify-center rounded-full',
                        'hover:text-on-surface transition-colors duration-150 ease-solkey',
                        'focus-ring',
                    ].join(' ')}>
                    <Icon name="arrow-left" size={20} />
                </button>
                <Wordmark size={19} className="max-[52rem]:hidden" />
                <div className="w-px h-5 bg-outline-variant/15 max-[52rem]:hidden" />
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
                        autosave={autosave}
                        compact={compact}
                    />
                </div>
            </div>
            {!compact && <TransportControls {...transport} />}
            <div inert={takenOver} className={`flex items-center gap-2 shrink-0 sm:flex-1 justify-end ${fade}`}>
                {/* Pitch and history tools are document-level chrome (see PitchTools /
                    HistoryTools); on phones they move into the dock instead. */}
                {!compact && (
                    <PitchTools
                        manipulator={manipulator}
                        transposeOpen={transposeOpen}
                        onTransposeOpenChange={onTransposeOpenChange}
                        onTransposeAim={onTransposeAim}
                    />
                )}
                {!compact && <HistoryTools manipulator={manipulator} />}
                {!compact && (
                    <ChipToggle
                        active={shortcutsOpen}
                        onClick={onOpenShortcuts}
                        ariaLabel="Keyboard shortcuts"
                        shortcut={[SHOW_SHORTCUTS_KEY.label]}
                        tooltipSide="bottom">
                        <Icon name="keyboard" size={16} />
                    </ChipToggle>
                )}
                <ShareMenu scoreId={scoreId} shareToken={shareToken} compact={compact} />
                <RecordingsMenu scoreId={scoreId} compact={compact} />
                <ExportMenu score={score} title={title} compact={compact} getSvg={getSvg} />
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
    // ellipsizes instead of running under the transport.
    return (
        <div className="flex min-w-24 max-w-[min(32rem,40vw)] shrink [&>span]:min-w-0 [&>span]:shrink">
            <Tooltip label="Rename" side="bottom">
                <div ref={wrapperRef} className="group relative min-w-0 w-full">
                    <span
                        aria-hidden
                        className={`${TITLE_TYPE} invisible block overflow-hidden whitespace-pre px-2 py-2 pointer-fine:pr-6`}>
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
    autosave: EditorHeaderProps['autosave']
    compact: boolean
}

/**
 * The instrument chip and, after it, where the save stands — subscribed to the autosave's
 * status on its own, so a save re-renders this slot rather than the page. Phones show the
 * status only when it needs attention, and then in the chip's place: the header has no
 * room for both.
 */
function InstrumentSlot({ instrumentName, onChangeInstrument, autosave, compact }: InstrumentSlotProps) {
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
                <InstrumentChip name={instrumentName} onClick={onChangeInstrument} />
                <Tooltip hint="Try again now" side="bottom">
                    {retry}
                </Tooltip>
            </>
        )
    }
    return (
        <>
            <InstrumentChip name={instrumentName} onClick={onChangeInstrument} />
            {!compact &&
                (state === 'saving' ? (
                    <span className="shrink-0 font-body font-normal text-[12px] leading-none text-on-surface-variant whitespace-nowrap">
                        Saving…
                    </span>
                ) : (
                    // A save that just landed says so in a word; the check alone stays after.
                    <SavedMark key={landed} justLanded={landed > 0} />
                ))}
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

/** The instrument pill: its identity tone, a 13px name and a chevron that says it opens something. */
function InstrumentChip({ name, onClick }: { name: string; onClick: () => void }) {
    return (
        <Tooltip label="Change instrument" side="bottom">
            <button
                type="button"
                onClick={onClick}
                aria-label={`Change instrument (current: ${name})`}
                className={[
                    'shrink-0 inline-flex items-center gap-1 border-0 rounded-full px-3 min-h-8 pointer-coarse:min-h-10 cursor-pointer',
                    'font-label font-semibold text-[13px] leading-none whitespace-nowrap',
                    'max-md:max-w-28 min-w-0',
                    'bg-secondary-soft/70 text-on-secondary-soft hover:bg-secondary-soft',
                    'transition-colors duration-150 ease-solkey',
                    'focus-ring',
                ].join(' ')}>
                <span className="truncate">{name}</span>
                <Icon name="chevron-down" size={12} className="shrink-0" />
            </button>
        </Tooltip>
    )
}
