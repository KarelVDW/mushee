'use client'

import {
    type ClefClickEvent,
    type ClefType,
    type DurationType,
    type KeySignatureClickEvent,
    Score as ScoreView,
    type ScoreHighlight,
    type SelectionMenuEvent,
    type TempoClickEvent,
    type TimeSignatureClickEvent,
} from '@mushee/notation/components'
import type { ScorePartwise } from '@mushee/notation/components/types'
import { Instrument, type Note, type Pitch, TimeSignature } from '@mushee/notation/model'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import { useParams, useRouter } from 'next/navigation'
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'

import { ClefPopover } from '@/components/editor/ClefPopover'
import { KeySignaturePopover } from '@/components/editor/KeySignaturePopover'
import { SelectionPopover } from '@/components/editor/SelectionPopover'
import { TempoPopover } from '@/components/editor/TempoPopover'
import { TimeSignaturePopover } from '@/components/editor/TimeSignaturePopover'
import { TransposePopover } from '@/components/editor/TransposePopover'
import { ChipToggle, ErrorScreen, Icon, Wordmark } from '@/components/ui'
import { ApiError, NetworkError } from '@/lib/api'
import { useSaveKeyboardShortcuts, useScoreDocument, useSettings } from '@/lib/queries'
import { useMediaQuery } from '@/lib/useMediaQuery'

import {
    CHANGE_PITCH,
    LOWER_PITCH,
    MOVE_NEXT,
    MOVE_PREVIOUS,
    RAISE_PITCH,
    REMOVE_NOTE,
    SET_ACCIDENTAL,
    SET_CLEF,
    SET_DURATION,
    SET_KEY,
    SET_TEMPO,
    TOGGLE_DOT,
    TOGGLE_REST,
    TOGGLE_TIE,
    TOGGLE_TUPLET,
} from './actions'
import { ChangeInstrumentDialog } from './ChangeInstrumentDialog'
import { COMPACT_POPOVER_SHEET, MobileEditorActions, NoteToolDock, TransportControls } from './EditorControls'
import { ExportMenu } from './ExportMenu'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { ConcurrentRecordingDialog, MicModeGuideDialog, RecordingLimitDialog } from './RecordingDialogs'
import { ScoreManipulator } from './ScoreManipulator'
import { TitleInput } from './TitleInput'
import { usePlayback } from './usePlayback'
import { useRecording } from './useRecording'
import { useScoreAutosave } from './useScoreAutosave'

export default function ScoreEditorPage() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    // The manipulator owns the active note + the live score and is the single dispatch
    // point for every edit. It is a useSyncExternalStore source: re-render on selection or
    // score changes, then read the current values straight off the instance.
    const [manipulator] = useState(() => new ScoreManipulator())
    useSyncExternalStore(manipulator.subscribe, manipulator.getSnapshot, manipulator.getSnapshot)
    const score = manipulator.score
    const activeNote = manipulator.selectedNote

    const [title, setTitle] = useState('Untitled composition')
    const containerRef = useRef<HTMLDivElement>(null)
    const scoreAreaRef = useRef<HTMLDivElement>(null)
    const [instrumentDialogOpen, setInstrumentDialogOpen] = useState(false)
    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    const [transposeOpen, setTransposeOpen] = useState(false)
    const transposeAnchorRef = useRef<HTMLDivElement>(null)
    // Transient magenta emphasis on the canvas: a pulse over the open transpose popover's
    // target range, replaced by a fading flash the moment a pitch operation lands.
    const [pitchHighlight, setPitchHighlight] = useState<ScoreHighlight | null>(null)
    const highlightSeq = useRef(0)
    const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Phone-sized chrome: transport moves into the dock (thumb reach), the keyboard
    // shortcuts entry point disappears, and header/dock controls tighten up.
    const isMobile = useMediaQuery('(max-width: 767px)')

    const { data: scoreDocument, error: loadError, refetch } = useScoreDocument(id)

    // Keyboard shortcuts follow the account: adopt the server's override set once it loads
    // (or push this device's up when the account has none yet), then mirror every change.
    const { data: settings } = useSettings()
    const { mutate: saveShortcuts } = useSaveKeyboardShortcuts()
    const shortcutsSyncedRef = useRef(false)
    useEffect(() => {
        const keybindings = manipulator.keybindings
        if (settings && !shortcutsSyncedRef.current) {
            shortcutsSyncedRef.current = true
            if (settings.keyboardShortcuts) keybindings.hydrate(settings.keyboardShortcuts)
            else if (keybindings.hasCustomizations) saveShortcuts(keybindings.toStored())
        }
        keybindings.onDidChange = (stored) => saveShortcuts(stored)
        return () => {
            keybindings.onDidChange = undefined
        }
    }, [settings, manipulator, saveShortcuts])

    const saveToApi = useScoreAutosave(id)

    // The query owns fetching; this effect turns the fetched document into the live, mutable
    // Score the manipulator works on, wiring its re-render hook and (debounced) autosave.
    useEffect(() => {
        if (!scoreDocument) return
        setTitle(scoreDocument.meta.title)
        const deserializer = new ScoreDeserializer(scoreDocument.document as unknown as ScorePartwise)
        const s = deserializer.toScore(manipulator.onScoreChange)
        // The save callback takes the score as a parameter (not a closure over `s`):
        // undo/redo swap the manipulator's Score instance, and the autosave must follow.
        manipulator.attach(s, (score) => saveToApi({ score }))
    }, [scoreDocument, manipulator, saveToApi])

    // Listeners are thin: each maps a control-bar callback or mouse event to a manipulator
    // dispatch. The actions themselves live in ./actions; the manipulator owns selection,
    // autosave, and re-rendering. (Keyboard input is bound directly to manipulator.handleKeyDown.)
    const handleNoteChange = useCallback((_note: Note, newPitch: Pitch) => manipulator.run(CHANGE_PITCH, newPitch), [manipulator])
    const handleSelectionStart = useCallback((note: Note) => manipulator.select(note), [manipulator])
    const handleSelectionExtend = useCallback((note: Note) => manipulator.extendSelectionTo(note), [manipulator])
    const handleAccidentalChange = useCallback((acc: string | undefined) => manipulator.run(SET_ACCIDENTAL, acc), [manipulator])
    const handleDurationChange = useCallback((duration: DurationType) => manipulator.run(SET_DURATION, duration), [manipulator])
    const handleDotToggle = useCallback(() => manipulator.run(TOGGLE_DOT), [manipulator])
    const handleTupletToggle = useCallback(() => manipulator.run(TOGGLE_TUPLET), [manipulator])
    const handleTieToggle = useCallback(() => manipulator.run(TOGGLE_TIE), [manipulator])
    const handleRestToggle = useCallback(() => manipulator.run(TOGGLE_REST), [manipulator])
    const handleTempoSet = useCallback((bpm: number) => manipulator.run(SET_TEMPO, bpm), [manipulator])
    const handleClefSet = useCallback((type: ClefType) => manipulator.run(SET_CLEF, type), [manipulator])
    const handleKeySet = useCallback((fifths: number) => manipulator.run(SET_KEY, fifths), [manipulator])
    const handleTimeSet = useCallback(
        (beatAmount: number, beatType: number) => {
            const measure = manipulator.selectedNote?.measure
            if (measure) manipulator.setTimeSignatureAt(measure.index, beatAmount, beatType)
        },
        [manipulator],
    )
    const handleAddMeasure = useCallback(() => manipulator.addMeasure(), [manipulator])
    const handleRemoveMeasure = useCallback(() => manipulator.removeMeasure(), [manipulator])
    const handleUndo = useCallback(() => manipulator.undo(), [manipulator])
    const handleRedo = useCallback(() => manipulator.redo(), [manipulator])
    const handleMinimizeAccidentals = useCallback(() => manipulator.minimizeAccidentals(), [manipulator])
    const handleTransposeApply = useCallback(
        (chromatic: number, diatonic: number, scope: 'score' | 'selection') => {
            manipulator.transpose(chromatic, diatonic, scope)
            setTransposeOpen(false)
        },
        [manipulator],
    )
    const closeTranspose = useCallback(() => setTransposeOpen(false), [])

    // The open transpose popover aims a gentle pulse at its target range; closing clears it
    // — but never a flash that an Apply just set (the popover closes right after applying).
    const handleTransposeAim = useCallback(
        (scope: 'score' | 'selection' | null) => {
            setPitchHighlight((current) => {
                if (scope === null) return current?.kind === 'pulse' ? null : current
                return { kind: 'pulse', notes: scope === 'selection' ? manipulator.selectedNotes : 'all', id: ++highlightSeq.current }
            })
        },
        [manipulator],
    )

    // The transpose shortcut opens this popover — view state the manipulator can't own, so
    // the command reaches back through this registration. The highlight hook flashes the
    // range a pitch operation (transpose apply / minimize accidentals) just rewrote.
    useEffect(() => {
        manipulator.onTransposeRequest = () => setTransposeOpen(true)
        manipulator.onPitchHighlight = (notes) => {
            if (highlightTimer.current) clearTimeout(highlightTimer.current)
            setPitchHighlight({ kind: 'flash', notes, id: ++highlightSeq.current })
            highlightTimer.current = setTimeout(() => setPitchHighlight(null), 900)
        }
        return () => {
            manipulator.onTransposeRequest = undefined
            manipulator.onPitchHighlight = undefined
            if (highlightTimer.current) clearTimeout(highlightTimer.current)
        }
    }, [manipulator])

    // In-score attribute glyphs (tempo / clef / key): the ScoreView only reports the
    // click; this page owns the popover it opens and applies the change through the
    // manipulator. The admin console renders the same ScoreView with no callbacks —
    // that's what keeps its score page read-only.
    const [attributePopover, setAttributePopover] = useState<
        | ({ kind: 'tempo' } & TempoClickEvent)
        | ({ kind: 'clef' } & ClefClickEvent)
        | ({ kind: 'key' } & KeySignatureClickEvent)
        | ({ kind: 'time' } & TimeSignatureClickEvent)
        | null
    >(null)
    const closeAttributePopover = useCallback(() => setAttributePopover(null), [])
    const handleTempoClick = useCallback((event: TempoClickEvent) => setAttributePopover({ kind: 'tempo', ...event }), [])
    const handleClefClick = useCallback((event: ClefClickEvent) => setAttributePopover({ kind: 'clef', ...event }), [])
    const handleKeySignatureClick = useCallback((event: KeySignatureClickEvent) => setAttributePopover({ kind: 'key', ...event }), [])
    const handleTimeSignatureClick = useCallback((event: TimeSignatureClickEvent) => setAttributePopover({ kind: 'time', ...event }), [])

    // The open attribute popover's panel. Rendered from two spots so it matches the dock's
    // equivalent popovers: on desktop anchored at the clicked glyph (clamped inside the
    // score wrapper), on mobile as the same full-width sheet above the dock that the dock's
    // own clef/key/time/tempo chips open — anchored panels clip at the viewport edge.
    const renderAttributePopover = (className: string) => {
        if (!attributePopover) return null
        switch (attributePopover.kind) {
            case 'tempo':
                return (
                    <TempoPopover
                        className={className}
                        initialBpm={attributePopover.bpm}
                        timeSignature={score?.measures[attributePopover.measureIndex]?.timeSignature ?? DEFAULT_TIME_SIGNATURE}
                        onSubmit={(bpm) => {
                            manipulator.setTempoAt(attributePopover.measureIndex, attributePopover.beatPosition, bpm)
                            closeAttributePopover()
                        }}
                        onDismiss={closeAttributePopover}
                    />
                )
            case 'clef':
                return (
                    <ClefPopover
                        active={attributePopover.clef}
                        className={className}
                        onSelect={(type) => {
                            manipulator.setClefAt(attributePopover.measureIndex, type)
                            closeAttributePopover()
                        }}
                        onDismiss={closeAttributePopover}
                    />
                )
            case 'key':
                return (
                    <KeySignaturePopover
                        active={attributePopover.fifths}
                        className={className}
                        onSelect={(fifths) => {
                            manipulator.setKeyAt(attributePopover.measureIndex, fifths)
                            closeAttributePopover()
                        }}
                        onDismiss={closeAttributePopover}
                    />
                )
            case 'time':
                return (
                    <TimeSignaturePopover
                        active={{ beatAmount: attributePopover.beatAmount, beatType: attributePopover.beatType }}
                        className={className}
                        onSelect={(beatAmount, beatType) => {
                            manipulator.setTimeSignatureAt(attributePopover.measureIndex, beatAmount, beatType)
                            closeAttributePopover()
                        }}
                        onDismiss={closeAttributePopover}
                    />
                )
        }
    }

    // The floating selection-actions bar (mobile): opened by the score's selection-menu
    // gestures — long-press, double-tap, or lifting a range drag. Selection-scoped actions
    // (copy/paste/delete/select all) live here, never as dedicated dock buttons.
    const [selectionMenuOpen, setSelectionMenuOpen] = useState(false)
    const closeSelectionMenu = useCallback(() => setSelectionMenuOpen(false), [])
    const handleSelectionMenu = useCallback((_event: SelectionMenuEvent) => setSelectionMenuOpen(true), [])
    // Position is derived from the live selection (not the gesture point) every render, so
    // the bar tracks a growing selection — e.g. Select all moves it over the first row.
    // The layout anchor is in layout units; the SVG renders scaled-to-fit, so scale into
    // wrapper pixels (the SVG sits at the wrapper's origin).
    const selectionMenuAnchor = (() => {
        if (!selectionMenuOpen || !score) return null
        const anchor = score.layout.selectionMenuAnchor(manipulator.selectedNotes)
        const svg = scoreAreaRef.current?.querySelector('svg')
        if (!anchor || !svg) return null
        const scale = svg.getBoundingClientRect().width / score.layout.scoreWidth
        return { x: anchor.x * scale, y: anchor.y * scale }
    })()

    const { transportRef, playbackCursorRef, playbackState, metronome, setMetronome, stopAll, handlePlayToggle, instrumentsReady } =
        usePlayback({
            score,
            activeNote,
            manipulator,
        })

    const handleInstrumentChange = useCallback(
        (instrument: Instrument) => {
            stopAll()
            manipulator.setInstrument(instrument)
            setInstrumentDialogOpen(false)
        },
        [manipulator, stopAll],
    )

    const {
        waveformStore,
        recordingState,
        recordingHalt,
        setRecordingHalt,
        handleRecordToggle,
        micModeGuideOpen,
        confirmMicModeGuide,
        dismissMicModeGuide,
    } = useRecording({
        id,
        manipulator,
        score,
        activeNote,
        transportRef,
        playbackCursorRef,
        stopAll,
        saveToApi,
    })

    // A live take streams transcription into the score; undoing then would swap the Score
    // instance out from under the transport's refs, so history travel is locked for the
    // take's duration. The finished take folds into one undoable step (see the manager).
    useEffect(() => {
        manipulator.historyLocked = recordingState !== 'idle'
    }, [manipulator, recordingState])

    // Route keyboard input through the manipulator. Re-runs once the editor chrome (and so the
    // container) mounts — which happens only after the score AND its instruments load, hence
    // both deps — attaching the listener and focusing for capture. Suspended while a dialog is
    // up so its keystrokes can't edit the score; when the dialog closes, re-attaching also puts
    // focus back on the editor.
    const dialogOpen = instrumentDialogOpen || shortcutsOpen || recordingHalt !== null || micModeGuideOpen
    useEffect(() => {
        const el = containerRef.current
        if (!el || dialogOpen) return
        el.addEventListener('keydown', manipulator.handleKeyDown)
        el.focus()
        return () => el.removeEventListener('keydown', manipulator.handleKeyDown)
    }, [manipulator, score, dialogOpen, instrumentsReady])

    if (loadError) {
        const serverDown = loadError instanceof NetworkError
        const notFound = loadError instanceof ApiError && loadError.status === 404
        return (
            <ErrorScreen
                title={serverDown ? "Can't reach the server" : notFound ? 'Score not found' : "This score couldn't be loaded"}
                message={
                    serverDown
                        ? 'Solkey could not connect to its server, so this score can’t be opened right now. Check your internet connection, or try again in a moment.'
                        : notFound
                          ? 'This score doesn’t exist (anymore), or it belongs to a different account.'
                          : 'Something went wrong while loading this score. Try again, and if it keeps happening, come back in a few minutes.'
                }
                onRetry={notFound ? undefined : () => void refetch()}
                onBack={() => router.push('/scores')}
                backLabel="Back to library"
            />
        )
    }

    // Hold the loading screen until the playback samples (score instrument + metronome
    // woodblock) are in memory: pressing record must click instantly, and a half-ready
    // editor whose transport buttons play nothing reads as broken.
    if (!score || !instrumentsReady) {
        return (
            <div className="min-h-dvh bg-surface flex items-center justify-center">
                <div className="text-center flex flex-col items-center gap-2">
                    <Wordmark size={28} />
                    <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant">Loading score…</span>
                </div>
            </div>
        )
    }

    return (
        <div ref={containerRef} tabIndex={0} className="relative flex flex-col h-dvh bg-surface text-on-surface outline-none">
            <header className="flex items-center gap-2 sm:gap-4 px-3 sm:px-5 py-2 bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow z-10">
                <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1">
                    <button
                        onClick={() => router.push('/scores')}
                        aria-label="Back to library"
                        className={[
                            'bg-transparent border-0 cursor-pointer text-on-surface-variant p-1.5 -ml-1.5 inline-flex rounded-full',
                            'hover:text-on-surface transition-colors duration-150 ease-solkey',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                        ].join(' ')}>
                        <Icon name="arrow-left" size={20} />
                    </button>
                    <Wordmark size={19} className="max-[52rem]:hidden" />
                    <div className="w-px h-5 bg-outline-variant/15 max-[52rem]:hidden" />
                    <TitleInput
                        value={title}
                        onChange={(v) => {
                            setTitle(v)
                            saveToApi({ title: v })
                        }}
                    />
                    <button
                        type="button"
                        onClick={() => setInstrumentDialogOpen(true)}
                        aria-label={`Change instrument (current: ${score.instrument.displayName})`}
                        className={[
                            'shrink-0 inline-flex items-center gap-1 border-0 rounded-full px-2.5 py-1.5 cursor-pointer',
                            'font-label font-semibold text-[11px] leading-none whitespace-nowrap',
                            'max-md:max-w-28 min-w-0',
                            'bg-secondary-soft/70 text-on-secondary-soft hover:bg-secondary-soft',
                            'transition-colors duration-150 ease-solkey',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                        ].join(' ')}>
                        <span className="truncate">{score.instrument.displayName}</span>
                        <Icon name="sliders-horizontal" size={11} />
                    </button>
                </div>
                {!isMobile && (
                    <TransportControls
                        playbackState={playbackState}
                        onPlayToggle={handlePlayToggle}
                        onStop={stopAll}
                        recordingState={recordingState}
                        onRecordToggle={() => void handleRecordToggle()}
                        metronome={metronome}
                        onMetronomeToggle={() => setMetronome((m) => !m)}
                    />
                )}
                <div className="flex items-center gap-2 shrink-0 sm:flex-1 justify-end">
                    {/* Undo/redo sit in the header, not the tool dock: the dock's tools edit the
                        selection, while history travel is a document-level (meta) operation —
                        like export, it belongs with the chrome. On phones the pair moves into
                        the dock's tool strip instead (thumb reach, and there is no ⌘Z). */}
                    {/* Pitch operations follow the same rule: minimize-accidentals and transpose act on
                        the whole score by default (a multi-note selection narrows them), so they live
                        with the document-level chrome. On phones they join the dock's settings well. */}
                    {!isMobile && (
                        <div role="group" aria-label="Pitch" className="flex items-center gap-1">
                            <ChipToggle onClick={handleMinimizeAccidentals} disabled={!activeNote} ariaLabel="Minimize accidentals">
                                <Icon name="natural" size={16} />
                            </ChipToggle>
                            <div ref={transposeAnchorRef} className="relative">
                                <ChipToggle active={transposeOpen} onClick={() => setTransposeOpen((o) => !o)} ariaLabel="Transpose">
                                    <Icon name="transpose" size={16} />
                                </ChipToggle>
                                {transposeOpen && (
                                    <TransposePopover
                                        score={score}
                                        selectedNotes={manipulator.selectedNotes}
                                        anchorRef={transposeAnchorRef}
                                        className="right-0 top-[calc(100%+0.5rem)]"
                                        onApply={handleTransposeApply}
                                        onDismiss={closeTranspose}
                                        onScopeChange={handleTransposeAim}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                    {!isMobile && (
                        <div role="group" aria-label="History" className="flex items-center gap-1">
                            <ChipToggle onClick={handleUndo} disabled={!manipulator.canUndo} ariaLabel="Undo">
                                <Icon name="undo" size={16} />
                            </ChipToggle>
                            <ChipToggle onClick={handleRedo} disabled={!manipulator.canRedo} ariaLabel="Redo">
                                <Icon name="redo" size={16} />
                            </ChipToggle>
                        </div>
                    )}
                    {!isMobile && (
                        <ChipToggle active={shortcutsOpen} onClick={() => setShortcutsOpen(true)} ariaLabel="Keyboard shortcuts">
                            <Icon name="keyboard" size={16} />
                        </ChipToggle>
                    )}
                    <ExportMenu
                        score={score}
                        title={title}
                        compact={isMobile}
                        getSvg={() => scoreAreaRef.current?.querySelector('svg') ?? null}
                    />
                </div>
            </header>
            {/* flex-col + grow (not min-h-full): the canvas must fill the scroll viewport
                even when the score is short, and a percentage min-height can't resolve
                against a flex-sized (height-less) scroll container. */}
            <div className="flex-1 overflow-y-auto min-h-0 px-2 sm:px-8 bg-surface flex flex-col">
                <div
                    ref={scoreAreaRef}
                    className="mx-auto w-full max-w-240 grow bg-surface-container-lowest p-3 pt-6 sm:p-10 tonal-layer-glow manuscript-canvas">
                    {/* The click events carry coordinates relative to the ScoreView's own
                        container, so the popovers anchor inside this exact wrapper. */}
                    <div className="relative">
                        <ScoreView
                            score={score}
                            layoutId={score.layout.id}
                            selectedNote={activeNote}
                            selectedNotes={manipulator.selectedNotes}
                            highlight={pitchHighlight}
                            playbackCursorRef={playbackCursorRef}
                            waveformStore={waveformStore}
                            onSelectionStart={handleSelectionStart}
                            onSelectionExtend={handleSelectionExtend}
                            onSelectionMenu={isMobile ? handleSelectionMenu : undefined}
                            onNoteChange={handleNoteChange}
                            onAddMeasure={handleAddMeasure}
                            onRemoveMeasure={handleRemoveMeasure}
                            canRemoveMeasure={score.measures.length > 1}
                            onTempoClick={handleTempoClick}
                            onClefClick={handleClefClick}
                            onKeySignatureClick={handleKeySignatureClick}
                            onTimeSignatureClick={handleTimeSignatureClick}
                        />
                        {selectionMenuAnchor && activeNote && (
                            <SelectionPopover
                                x={selectionMenuAnchor.x}
                                y={selectionMenuAnchor.y}
                                canPaste={manipulator.canPaste}
                                onCopy={() => {
                                    manipulator.copy()
                                    closeSelectionMenu()
                                }}
                                onPaste={() => {
                                    manipulator.paste()
                                    closeSelectionMenu()
                                }}
                                onDelete={() => {
                                    manipulator.run(REMOVE_NOTE)
                                    closeSelectionMenu()
                                }}
                                // Stays open, like the OS menu: growing the selection is a step
                                // toward copying or deleting it, not an end in itself.
                                onSelectAll={() => manipulator.selectAll()}
                                onDismiss={closeSelectionMenu}
                            />
                        )}
                        {attributePopover && !isMobile && (
                            <AttributePopoverAnchor
                                x={attributePopover.x}
                                y={attributePopover.y + (attributePopover.kind === 'tempo' ? -30 : 40)}>
                                {renderAttributePopover('left-0 top-0')}
                            </AttributePopoverAnchor>
                        )}
                    </div>
                </div>
            </div>
            {/* On mobile the in-score attribute popovers render here instead, as the same
                full-width sheet above the dock that the dock's own chips open. */}
            <div className="relative shrink-0">
                {isMobile && renderAttributePopover(COMPACT_POPOVER_SHEET)}
                <NoteToolDock
                    accidental={activeNote?.pitch?.accidentalValue}
                    duration={activeNote?.duration.type}
                    accidentalDisabled={activeNote?.isRest ?? true}
                    onAccidentalChange={handleAccidentalChange}
                    onDurationChange={handleDurationChange}
                    dotted={(activeNote?.duration.dots ?? 0) > 0}
                    onDotToggle={handleDotToggle}
                    tuplet={activeNote?.inTuplet ?? false}
                    tupletDisabled={!activeNote || (!activeNote.inTuplet && !activeNote.duration.tripletDivision())}
                    onTupletToggle={handleTupletToggle}
                    tie={activeNote?.tiesForward ?? false}
                    onTieToggle={handleTieToggle}
                    rest={activeNote?.isRest ?? false}
                    onRestToggle={handleRestToggle}
                    bpm={score.bpmAt(activeNote)}
                    onTempoSet={handleTempoSet}
                    clef={activeNote?.clef.type ?? 'treble'}
                    onClefSet={handleClefSet}
                    keyFifths={activeNote?.keySignature.fifths ?? 0}
                    onKeySet={handleKeySet}
                    time={{
                        beatAmount: activeNote?.measure.timeSignature.beatAmount ?? 4,
                        beatType: activeNote?.measure.timeSignature.beatType ?? 4,
                    }}
                    onTimeSet={handleTimeSet}
                    selectionDisabled={!activeNote}
                    compact={isMobile}
                    pitch={
                        isMobile
                            ? {
                                  onMinimize: handleMinimizeAccidentals,
                                  score,
                                  selectedNotes: manipulator.selectedNotes,
                                  onTranspose: handleTransposeApply,
                                  onTransposeAim: handleTransposeAim,
                              }
                            : undefined
                    }
                    metronome={isMobile ? { active: metronome, onToggle: () => setMetronome((m) => !m) } : undefined}
                    history={
                        isMobile
                            ? { canUndo: manipulator.canUndo, canRedo: manipulator.canRedo, onUndo: handleUndo, onRedo: handleRedo }
                            : undefined
                    }
                    footer={
                        isMobile ? (
                            <MobileEditorActions
                                transport={{
                                    playbackState,
                                    onPlayToggle: handlePlayToggle,
                                    onStop: stopAll,
                                    recordingState,
                                    onRecordToggle: () => void handleRecordToggle(),
                                    metronome,
                                    onMetronomeToggle: () => setMetronome((m) => !m),
                                }}
                                onPrevious={() => manipulator.run(MOVE_PREVIOUS)}
                                onNext={() => manipulator.run(MOVE_NEXT)}
                                onPitchUp={() => manipulator.run(RAISE_PITCH)}
                                onPitchDown={() => manipulator.run(LOWER_PITCH)}
                                disabled={!activeNote}
                            />
                        ) : undefined
                    }
                />
            </div>

            <ChangeInstrumentDialog
                open={instrumentDialogOpen}
                current={score.instrument}
                onCancel={() => setInstrumentDialogOpen(false)}
                onConfirm={handleInstrumentChange}
            />

            <KeyboardShortcutsDialog open={shortcutsOpen} keybindings={manipulator.keybindings} onClose={() => setShortcutsOpen(false)} />

            {recordingHalt?.kind === 'limit' && (
                <RecordingLimitDialog
                    info={recordingHalt.info}
                    onUpgrade={() => router.push('/settings')}
                    onClose={() => setRecordingHalt(null)}
                />
            )}
            {recordingHalt?.kind === 'concurrent' && <ConcurrentRecordingDialog onClose={() => setRecordingHalt(null)} />}
            {micModeGuideOpen && <MicModeGuideDialog onConfirm={confirmMicModeGuide} onClose={dismissMicModeGuide} />}
        </div>
    )
}

/** Space kept between an anchored attribute popover and the score wrapper's side edges. */
/** Meter assumed for the in-score tempo popover when its measure is gone (the score reloaded underneath it). */
const DEFAULT_TIME_SIGNATURE = new TimeSignature(4, 4)

const POPOVER_EDGE_MARGIN = 8

/**
 * Positions an in-score attribute popover at the clicked glyph, pulled left just enough to
 * stay inside the score wrapper (its offsetParent) — the same measure-and-clamp approach as
 * SelectionPopover. Re-measured every render: the panel's width depends on which popover is
 * inside, and there is no ResizeObserver.
 */
function AttributePopoverAnchor({ x, y, children }: { x: number; y: number; children: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null)
    const [left, setLeft] = useState<number | null>(null)
    useLayoutEffect(() => {
        const el = ref.current
        const parent = el?.offsetParent as HTMLElement | null
        // Measure the popover panel, not the anchor: the panel is absolutely positioned
        // inside it, so the anchor itself has no size.
        const panel = el?.firstElementChild as HTMLElement | null
        if (!el || !parent || !panel) return
        setLeft(Math.min(x, Math.max(POPOVER_EDGE_MARGIN, parent.clientWidth - panel.offsetWidth - POPOVER_EDGE_MARGIN)))
    })
    return (
        <div ref={ref} className="absolute z-50" style={{ left: left ?? x, top: y, visibility: left === null ? 'hidden' : undefined }}>
            {children}
        </div>
    )
}
