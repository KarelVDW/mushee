'use client'

/*
 * The score editor route. Where editor files live: components/editor/ holds the page-agnostic
 * popovers; this folder holds the page plus its page-wired views, hooks and controllers; and
 * components/ holds what two or more routes use (ExportMenu also serves the share page).
 */

import { type AttributeClickEvent, ScoreView, type SelectionMenuEvent } from '@mushee/notation/components'
import type { Instrument, Note, Pitch } from '@mushee/notation/model'
import { ScoreDeserializer } from '@mushee/notation/model/io/ScoreDeserializer'
import { dismissToast } from '@mushee/ui'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { SelectionPopover } from '@/components/editor/SelectionPopover'
import { ErrorScreen, PopoverSheetHost, showToast, Wordmark } from '@/components/ui'
import { ApiError, NetworkError } from '@/lib/api'
import { useScoreDocument } from '@/lib/queries'
import { useMediaQuery } from '@/lib/useMediaQuery'

import { CHANGE_PITCH, LOWER_PITCH, MOVE_NEXT, MOVE_PREVIOUS, RAISE_PITCH } from './actions'
import { ChangeInstrumentDialog } from './ChangeInstrumentDialog'
import { EditorHeader } from './EditorHeader'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { NoteToolDock } from './NoteToolDock'
import { OneTimeHint, SELECTION_TIP_KEY } from './OneTimeHint'
import { ConcurrentRecordingDialog, MicModeGuideDialog, RecordingLimitDialog } from './RecordingDialogs'
import { AttributeHoverTip, ScoreAttributePopover } from './ScoreAttributePopover'
import { ScoreManipulator } from './ScoreManipulator'
import { MobileEditorActions, type TransportControlsProps } from './TransportControls'
import { useAccountKeybindings } from './useAccountKeybindings'
import { usePitchHighlight } from './usePitchHighlight'
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
    const { highlight: pitchHighlight, aim: aimTranspose } = usePitchHighlight(manipulator)
    // Phone-sized chrome: transport moves into the dock (thumb reach), the keyboard
    // shortcuts entry point disappears, and header/dock controls tighten up.
    const isMobile = useMediaQuery('(max-width: 767px)')

    const { data: scoreDocument, error: loadError, refetch } = useScoreDocument(id)

    useAccountKeybindings(manipulator.keybindings)

    const saveToApi = useScoreAutosave(id)

    // The query owns fetching; this effect turns the fetched document into the live, mutable
    // Score the manipulator works on, wiring its re-render hook and (debounced) autosave.
    // It is keyed on the document alone, never on the whole query result: a share toggle
    // rewrites the cached meta (keeping `document`'s reference), and re-running here would
    // re-attach the load-time document over every edit made since. The title is seeded in
    // the same effect for the same reason — once per load, not on every meta change.
    // A raw (non-JSON) stored document is never deserialized: it takes the load-error path
    // below, so an autosave can't write a reconstruction back over the stored MusicXML.
    const loaded = scoreDocument?.document
    const unreadable = loaded !== undefined && 'raw' in loaded
    useEffect(() => {
        if (!scoreDocument || !loaded || 'raw' in loaded) return
        setTitle(scoreDocument.meta.title)
        const deserializer = new ScoreDeserializer(loaded)
        const s = deserializer.toScore(manipulator.onScoreChange)
        // The save callback takes the score as a parameter (not a closure over `s`):
        // undo/redo swap the manipulator's Score instance, and the autosave must follow.
        manipulator.attach(s, (score) => saveToApi({ score }))
    }, [loaded, manipulator, saveToApi])

    // The score view's listeners are thin: each maps a mouse/touch event to a manipulator
    // dispatch, and stays referentially stable because ScoreView is memoized. The actions live
    // in ./actions; the manipulator owns selection, autosave and re-rendering. The dock and the
    // header tools dispatch to the manipulator themselves, and keyboard input is bound directly
    // to manipulator.handleKeyDown.
    const handleNoteChange = useCallback((_note: Note, newPitch: Pitch) => manipulator.run(CHANGE_PITCH, newPitch), [manipulator])

    // Phones: the first time someone picks a note, one tip says where its actions are — gone
    // after 6s, the next tap, or the actions opening. Once per device.
    const [selectionTip] = useState(() => new OneTimeHint(SELECTION_TIP_KEY))
    const selectionTipToast = useRef<number | null>(null)
    const dismissSelectionTip = useCallback(() => {
        if (selectionTipToast.current === null) return
        dismissToast(selectionTipToast.current)
        selectionTipToast.current = null
    }, [])
    const showSelectionTip = useCallback(() => {
        if (!selectionTip.pending) return
        selectionTip.markSeen()
        selectionTipToast.current = showToast('Tap the note again to copy or delete it.', 'info', { duration: 6000 })
        // The tap that selected the note is still in flight: listen from the next one on.
        setTimeout(() => document.addEventListener('pointerdown', dismissSelectionTip, { once: true }), 0)
    }, [selectionTip, dismissSelectionTip])
    const handleSelectionStart = useCallback(
        (note: Note) => {
            manipulator.select(note)
            if (isMobile) showSelectionTip()
        },
        [manipulator, isMobile, showSelectionTip],
    )
    const handleSelectionExtend = useCallback((note: Note) => manipulator.extendSelectionTo(note), [manipulator])
    const handleAddMeasure = useCallback(() => manipulator.addMeasure(), [manipulator])
    const handleRemoveMeasure = useCallback(() => manipulator.removeMeasure(), [manipulator])

    // The transpose shortcut opens the transpose popover — view state the manipulator can't
    // own, so the command reaches back through this registration.
    useEffect(() => {
        manipulator.onTransposeRequest = () => setTransposeOpen(true)
        return () => {
            manipulator.onTransposeRequest = undefined
        }
    }, [manipulator])

    // In-score attribute glyphs (tempo / clef / key / time): the ScoreView reports the click,
    // and ScoreAttributePopover opens the matching popover and applies the change. A mouse
    // hovering one is told what a click does ("Change key").
    const [attributePopover, setAttributePopover] = useState<AttributeClickEvent | null>(null)
    const closeAttributePopover = useCallback(() => setAttributePopover(null), [])
    const [attributeHover, setAttributeHover] = useState<AttributeClickEvent | null>(null)

    // The floating selection-actions bar: opened by the score's selection-menu gestures
    // (touch: long-press, double-tap, a second tap on the selected note, lifting a range drag;
    // mouse: right-click, lifting a range drag) and from the keyboard (Shift+F10, the Menu
    // key). Selection-scoped actions (copy/paste/delete/select all) live here, never as
    // dedicated dock buttons. Opened from the keyboard, focus moves in and comes back after.
    const [selectionMenu, setSelectionMenu] = useState<'pointer' | 'keyboard' | null>(null)
    const returnFocusFromMenu = useRef(false)
    const openSelectionMenu = useCallback(
        (via: 'pointer' | 'keyboard') => {
            returnFocusFromMenu.current = via === 'keyboard'
            dismissSelectionTip()
            setSelectionMenu(via)
        },
        [dismissSelectionTip],
    )
    const closeSelectionMenu = useCallback(() => {
        setSelectionMenu(null)
        if (!returnFocusFromMenu.current) return
        returnFocusFromMenu.current = false
        containerRef.current?.focus()
    }, [])
    const handleSelectionMenu = useCallback((_event: SelectionMenuEvent) => openSelectionMenu('pointer'), [openSelectionMenu])
    useEffect(() => {
        manipulator.onSelectionMenuRequest = () => openSelectionMenu('keyboard')
        return () => {
            manipulator.onSelectionMenuRequest = undefined
        }
    }, [manipulator, openSelectionMenu])
    const selectionMenuOpen = selectionMenu !== null
    const scrollAreaRef = useRef<HTMLDivElement>(null)
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

    const { transportRef, playbackCursorRef, playbackState, metronome, toggleMetronome, stopAll, handlePlayToggle, instrumentsReady } =
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
        dismissRecordingHalt,
        toggleRecording,
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

    // One transport prop bag for the header (desktop) and the dock's action row (mobile), so
    // the two can't drift. A take records into the selected note's measure, so Record needs
    // one to start — the take itself clears the selection, which must not lock its own stop.
    const transport: TransportControlsProps = {
        playbackState,
        onPlayToggle: handlePlayToggle,
        onStop: stopAll,
        recordingState,
        onRecordToggle: toggleRecording,
        recordDisabled: recordingState === 'idle' && !activeNote,
        metronome,
        onMetronomeToggle: toggleMetronome,
    }

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

    // Phone sheets live between the header and the dock (Popover's sheet frame reads
    // --app-header-h / --dock-h): measured, and re-measured whenever either bar changes size.
    const dockRef = useRef<HTMLDivElement>(null)
    const editorReady = !!score && instrumentsReady
    useEffect(() => {
        const root = containerRef.current
        const header = root?.querySelector('header')
        const dock = dockRef.current
        if (!root || !header || !dock) return
        const measure = () => {
            root.style.setProperty('--app-header-h', `${header.offsetHeight}px`)
            root.style.setProperty('--dock-h', `${dock.offsetHeight}px`)
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(header)
        observer.observe(dock)
        return () => observer.disconnect()
    }, [editorReady])

    if (loadError || unreadable) {
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
        <div
            ref={containerRef}
            tabIndex={0}
            className="relative flex flex-col h-dvh bg-surface text-on-surface outline-none"
            // A context menu aimed at the editor itself came from the keyboard (Shift+F10, the
            // Menu key — the focused element is the target): ours, not the browser's.
            onContextMenu={(e) => {
                if (e.target !== e.currentTarget) return
                e.preventDefault()
                manipulator.requestSelectionMenu()
            }}>
            <PopoverSheetHost>
                <EditorHeader
                    scoreId={id}
                    shareToken={scoreDocument?.meta.shareToken ?? null}
                    manipulator={manipulator}
                    title={title}
                    onTitleChange={(v) => {
                        setTitle(v)
                        saveToApi({ title: v })
                    }}
                    onChangeInstrument={() => setInstrumentDialogOpen(true)}
                    compact={isMobile}
                    transport={transport}
                    transposeOpen={transposeOpen}
                    onTransposeOpenChange={setTransposeOpen}
                    onTransposeAim={aimTranspose}
                    shortcutsOpen={shortcutsOpen}
                    onOpenShortcuts={() => setShortcutsOpen(true)}
                    getSvg={() => scoreAreaRef.current?.querySelector('svg') ?? null}
                />
                {/* flex-col + grow (not min-h-full): the canvas must fill the scroll viewport
                even when the score is short, and a percentage min-height can't resolve
                against a flex-sized (height-less) scroll container. */}
                <div ref={scrollAreaRef} className="flex-1 overflow-y-auto min-h-0 px-2 sm:px-8 bg-surface flex flex-col">
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
                                onSelectionMenu={handleSelectionMenu}
                                onNoteChange={handleNoteChange}
                                onAddMeasure={handleAddMeasure}
                                onRemoveMeasure={handleRemoveMeasure}
                                canRemoveMeasure={score.measures.length > 1}
                                onAttributeClick={setAttributePopover}
                                onAttributeHover={setAttributeHover}
                            />
                            <AttributeHoverTip event={attributePopover ? null : attributeHover} />
                            {selectionMenuAnchor && activeNote && (
                                <SelectionPopover
                                    x={selectionMenuAnchor.x}
                                    y={selectionMenuAnchor.y}
                                    viewport={scrollAreaRef}
                                    autoFocus={selectionMenu === 'keyboard'}
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
                                        manipulator.deleteSelection()
                                        closeSelectionMenu()
                                    }}
                                    // Stays open, like the OS menu: growing the selection is a step
                                    // toward copying or deleting it, not an end in itself.
                                    onSelectAll={() => manipulator.selectAll()}
                                    onDismiss={closeSelectionMenu}
                                />
                            )}
                            {/* Desktop: anchored at the glyph. Phones: the same sheet as the dock's
                            More pickers, portalled into the editor's one sheet host. */}
                            {attributePopover && (
                                <ScoreAttributePopover
                                    event={attributePopover}
                                    manipulator={manipulator}
                                    placement={isMobile ? 'sheet' : 'anchored'}
                                    onClose={closeAttributePopover}
                                />
                            )}
                        </div>
                    </div>
                </div>
                <div ref={dockRef} className="relative shrink-0">
                    <NoteToolDock
                        manipulator={manipulator}
                        compact={isMobile}
                        metronome={metronome}
                        onMetronomeToggle={toggleMetronome}
                        transposeOpen={transposeOpen}
                        onTransposeOpenChange={setTransposeOpen}
                        onTransposeAim={aimTranspose}
                        footer={
                            isMobile ? (
                                <MobileEditorActions
                                    transport={transport}
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

                {instrumentDialogOpen && (
                    <ChangeInstrumentDialog
                        current={score.instrument}
                        onCancel={() => setInstrumentDialogOpen(false)}
                        onConfirm={handleInstrumentChange}
                    />
                )}

                {shortcutsOpen && <KeyboardShortcutsDialog keybindings={manipulator.keybindings} onClose={() => setShortcutsOpen(false)} />}

                {recordingHalt?.kind === 'limit' && (
                    <RecordingLimitDialog
                        info={recordingHalt.info}
                        onUpgrade={() => router.push('/settings')}
                        onClose={dismissRecordingHalt}
                    />
                )}
                {recordingHalt?.kind === 'concurrent' && <ConcurrentRecordingDialog onClose={dismissRecordingHalt} />}
                {micModeGuideOpen && <MicModeGuideDialog onConfirm={confirmMicModeGuide} onClose={dismissMicModeGuide} />}
            </PopoverSheetHost>
        </div>
    )
}
