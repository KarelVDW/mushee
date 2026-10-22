'use client'

/*
 * The score editor route. Where editor files live: components/editor/ holds the page-agnostic
 * popovers; this folder holds the page plus its page-wired views, hooks and controllers; and
 * components/ holds what two or more routes use (ExportMenu also serves the share page).
 */

import { type AttributeClickEvent, type MeasureButtonsRect, ScoreView, type SelectionMenuEvent } from '@mushee/notation/components'
import type { Instrument, Note, Pitch } from '@mushee/notation/model'
import { ScoreDeserializer } from '@mushee/notation/model/io/ScoreDeserializer'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'

import { SelectionPopover } from '@/components/editor/SelectionPopover'
import { dismissToast, ErrorScreen, LoadingScreen, PopoverSheetHost, showToast, TertiaryButton } from '@/components/ui'
import { ApiError, NetworkError } from '@/lib/api'
import { withPlan } from '@/lib/plans'
import { useScoreDocument } from '@/lib/queries'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useMediaQuery } from '@/lib/useMediaQuery'

import { settingsTabPath } from '../../settings/settingsTabs'
import { CHANGE_PITCH, LOWER_PITCH, MOVE_NEXT, MOVE_PREVIOUS, RAISE_PITCH } from './actions'
import { ChangeInstrumentDialog } from './ChangeInstrumentDialog'
import { PLAY_PAUSE_COMMAND, RECORD_COMMAND } from './commands'
import { EditorAnnouncer, KeyboardHelp } from './EditorAnnouncer'
import { EditorEmptyState } from './EditorEmptyState'
import { EditorHeader, UNTITLED_SCORE } from './EditorHeader'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { MeasureControls } from './MeasureControls'
import { NoteToolDock } from './NoteToolDock'
import { OneTimeHint, SELECTION_TIP_KEY } from './OneTimeHint'
import { ConcurrentRecordingDialog, MicBlockedDialog, MicModeGuideDialog, RecordingLimitDialog } from './RecordingDialogs'
import { RecordingStrip } from './RecordingStrip'
import { AttributeHoverTip, ScoreAttributePopover } from './ScoreAttributePopover'
import { ScoreManipulator } from './ScoreManipulator'
import { MobileEditorActions, RECORD_BUTTON_SELECTOR, RecordButton, type TransportControlsProps } from './TransportControls'
import { useAccountKeybindings } from './useAccountKeybindings'
import { usePitchHighlight } from './usePitchHighlight'
import { usePlayback } from './usePlayback'
import { useRecording } from './useRecording'
import { useScoreAutosave } from './useScoreAutosave'

/** How long the phone's tap-again-for-actions tip stays up (the info toast's own default). */
const SELECTION_TIP_MS = 6000
/** How long a big edit's Undo toast stays. */
const UNDO_TOAST_MS = 6000
/** The gap between the top of the dock and the toast stack above it. */
const TOAST_GAP_PX = 12
/** The engraved score's own <svg> inside the canvas — never a chrome icon's that sits after it. */
const SCORE_SVG = 'svg[data-score-canvas]'

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

    const [title, setTitle] = useState('')
    // The page holds the editor's keydown listener (keys bubble up to it from anywhere in the
    // editor); the canvas — the named 'score editor' application around the score — is where
    // focus goes, so a screen reader landing back on the editor hears the score's name and how
    // its keys work, and enters the application instead of browsing past it.
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLDivElement>(null)
    // Without scrolling: the canvas can be taller than the viewport, and handing the keys back
    // must never move the score away from where the user had it.
    const focusCanvas = useCallback(() => canvasRef.current?.focus({ preventScroll: true }), [])
    const scoreAreaRef = useRef<HTMLDivElement>(null)
    const [instrumentDialogOpen, setInstrumentDialogOpen] = useState(false)
    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    const [transposeOpen, setTransposeOpen] = useState(false)
    const { highlight: pitchHighlight, aim: aimTranspose } = usePitchHighlight(manipulator)
    // Phone-sized chrome: transport moves into the dock (thumb reach), the keyboard
    // shortcuts entry point disappears, and header/dock controls tighten up.
    const isMobile = useMediaQuery('(max-width: 767px)')

    const { data: scoreDocument, error: loadError, refetch, isFetching } = useScoreDocument(id)

    useAccountKeybindings(manipulator.keybindings)

    const autosave = useScoreAutosave(id)
    const saveToApi = autosave.save

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
    // after 6s, the next tap, or the actions opening. Once per device. While it is up, the
    // dock's own first-run hint steps aside: one tip at a time.
    const [selectionTip] = useState(() => new OneTimeHint(SELECTION_TIP_KEY))
    const selectionTipToast = useRef<number | null>(null)
    const [selectionTipUp, setSelectionTipUp] = useState(false)
    const dismissSelectionTip = useCallback(() => {
        if (selectionTipToast.current === null) return
        dismissToast(selectionTipToast.current)
        selectionTipToast.current = null
        setSelectionTipUp(false)
    }, [])
    const showSelectionTip = useCallback(() => {
        if (!selectionTip.pending) return
        selectionTip.markSeen()
        selectionTipToast.current = showToast('Tap the note again to copy or delete it.', 'info', { duration: SELECTION_TIP_MS })
        setSelectionTipUp(true)
        // The tap that selected the note is still in flight: listen from the next one on.
        setTimeout(() => document.addEventListener('pointerdown', dismissSelectionTip, { once: true }), 0)
    }, [selectionTip, dismissSelectionTip])
    useEffect(() => {
        if (!selectionTipUp) return
        // The toast's own clock: the dock hint comes back as the tip times out.
        const timer = setTimeout(() => setSelectionTipUp(false), SELECTION_TIP_MS)
        return () => clearTimeout(timer)
    }, [selectionTipUp])
    const handleSelectionStart = useCallback(
        (note: Note) => {
            manipulator.select(note)
            if (isMobile) showSelectionTip()
        },
        [manipulator, isMobile, showSelectionTip],
    )
    const handleSelectionExtend = useCallback((note: Note) => manipulator.extendSelectionTo(note), [manipulator])
    // Where the canvas's Add bar / Remove last bar go: under the final barline, as the score reports it.
    const [measureButtonsRect, setMeasureButtonsRect] = useState<MeasureButtonsRect | null>(null)

    // The transpose shortcut opens the transpose popover — view state the manipulator can't
    // own, so the command reaches back through this registration. Never while a recording
    // writes into the score (the header's chip is off then too).
    useEffect(() => {
        manipulator.onTransposeRequest = () => {
            if (!manipulator.historyLocked) setTransposeOpen(true)
        }
        return () => {
            manipulator.onTransposeRequest = undefined
        }
    }, [manipulator])
    // '?' opens the shortcuts list the same way — on desktop, the only layout that offers it.
    useEffect(() => {
        if (isMobile) return
        manipulator.onShortcutsRequest = () => setShortcutsOpen(true)
        return () => {
            manipulator.onShortcutsRequest = undefined
        }
    }, [manipulator, isMobile])

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
        focusCanvas()
    }, [focusCanvas])
    const handleSelectionMenu = useCallback((_event: SelectionMenuEvent) => openSelectionMenu('pointer'), [openSelectionMenu])
    useEffect(() => {
        manipulator.onSelectionMenuRequest = () => openSelectionMenu('keyboard')
        return () => {
            manipulator.onSelectionMenuRequest = undefined
        }
    }, [manipulator, openSelectionMenu])
    const selectionMenuOpen = selectionMenu !== null
    const scrollAreaRef = useRef<HTMLDivElement>(null)
    const emptyStateId = useId()
    const keyboardHelpId = useId()
    // Position is derived from the live selection (not the gesture point) every render, so
    // the bar tracks a growing selection — e.g. Select all moves it over the first row.
    // The layout anchor is in layout units; the SVG renders scaled-to-fit, so scale into
    // wrapper pixels (the SVG sits at the wrapper's origin).
    const selectionMenuAnchor = (() => {
        if (!selectionMenuOpen || !score) return null
        const anchor = score.layout.selectionMenuAnchor(manipulator.selectedNotes)
        const svg = scoreAreaRef.current?.querySelector(SCORE_SVG)
        if (!anchor || !svg) return null
        const scale = svg.getBoundingClientRect().width / score.layout.scoreWidth
        return { x: anchor.x * scale, y: anchor.y * scale }
    })()

    const {
        transportRef,
        playbackCursorRef,
        playbackState,
        metronome,
        toggleMetronome,
        stopAll,
        handlePlayToggle,
        playFrom,
        instrumentsReady,
    } = usePlayback({
        score,
        activeNote,
        manipulator,
    })

    // A new instrument stops playback — but never a recording: the header's chip is off while
    // one writes into the score, and a change that slipped through is declined here too.
    const handleInstrumentChange = useCallback(
        (instrument: Instrument) => {
            setInstrumentDialogOpen(false)
            if (manipulator.historyLocked) return
            stopAll()
            manipulator.setInstrument(instrument)
        },
        [manipulator, stopAll],
    )

    const {
        waveformStore,
        recordingState,
        recordingStatus,
        recordingHalt,
        dismissRecordingHalt,
        toggleRecording,
        recordFromBar,
        retryRecording,
        micModeGuideOpen,
        confirmMicModeGuide,
        skipMicModeGuide,
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
        playFrom,
        touch: isMobile,
    })
    const taking = recordingState !== 'idle'

    // Big edits offer an Undo in a toast (the manipulator says which and what to call it). Its
    // Undo takes back exactly that step, and the toast goes as soon as any other step commits —
    // so it can never undo the wrong thing — or the editor closes: the app-wide Toaster outlives
    // the page, and an Undo pressed from the library would edit (and autosave) a score no longer
    // on screen.
    useEffect(() => {
        let live: { toast: number; unwatch: () => void } | null = null
        const retire = () => {
            if (!live) return
            live.unwatch()
            dismissToast(live.toast)
            live = null
        }
        manipulator.onUndoOffer = (offer) => {
            retire()
            const toast = showToast(offer.message, 'info', {
                duration: UNDO_TOAST_MS,
                action: { label: 'Undo', ariaLabel: offer.undoLabel, onClick: () => manipulator.undoStep(offer.step) },
            })
            const unwatch = manipulator.subscribe(() => {
                if (manipulator.editCount !== offer.step) retire()
            })
            live = { toast, unwatch }
        }
        return () => {
            manipulator.onUndoOffer = undefined
            retire()
        }
    }, [manipulator])

    // Playback starting, pausing and stopping, for a screen reader — except a stop that a new
    // selection caused (picking a note stops playback): the note picked is the news then.
    const lastPlayback = useRef({ state: playbackState, note: activeNote })
    useEffect(() => {
        const previous = lastPlayback.current
        if (previous.state === playbackState) return
        lastPlayback.current = { state: playbackState, note: activeNote }
        if (playbackState === 'playing') manipulator.announce('Playing')
        else if (playbackState === 'paused') manipulator.announce('Paused')
        else if (previous.note === activeNote) manipulator.announce('Stopped')
    }, [playbackState, activeNote, manipulator])

    // A save that fails is said once, and so is its recovery — never every save.
    useEffect(() => {
        const status = autosave.status
        let failing = status.state === 'retrying'
        return status.subscribe(() => {
            if (status.state === 'retrying' && !failing) {
                failing = true
                manipulator.announce('Not saved yet — retrying.')
            } else if (status.state === 'saved' && failing) {
                failing = false
                manipulator.announce('Changes saved again.')
            }
        })
    }, [autosave.status, manipulator])

    // The tab carries the score's name, live as it is renamed ('Untitled score' when empty, which
    // is also the route's own title until the score loads — see layout.tsx); a missing score says so.
    const scoreMissing = loadError instanceof ApiError && loadError.status === 404
    useDocumentTitle(scoreDocument ? `${title.trim() || UNTITLED_SCORE} — Solkey` : scoreMissing ? 'Score not found — Solkey' : null)

    // One transport prop bag for the header (desktop) and the dock's action row (mobile), so
    // the two can't drift. Record never waits for a selection: with nothing selected a take
    // carries on after the music. Its tooltips name the live Playback keys.
    const keybindings = manipulator.keybindings
    useSyncExternalStore(keybindings.subscribe, keybindings.getSnapshot, keybindings.getSnapshot)
    const transport: TransportControlsProps = {
        playbackState,
        onPlayToggle: handlePlayToggle,
        onStop: stopAll,
        recordingState,
        onRecordToggle: toggleRecording,
        recordFromBar,
        metronome,
        onMetronomeToggle: toggleMetronome,
        shortcuts: { playPause: keybindings.shortcutFor(PLAY_PAUSE_COMMAND), record: keybindings.shortcutFor(RECORD_COMMAND) },
    }

    // The Playback shortcuts reach the transport through the manipulator (Space, ⇧Space, ⇧R,
    // Escape for a take); each declines — leaving the key to the browser — when it can't act.
    useEffect(() => {
        manipulator.onTransportRequest = (request) => {
            if (!score) return false
            switch (request) {
                case 'toggle':
                    if (taking) stopAll()
                    else handlePlayToggle()
                    return true
                case 'from-start':
                    if (taking) return false
                    playFrom(null)
                    return true
                case 'record':
                    toggleRecording()
                    return true
                case 'stop-recording':
                    if (!taking) return false
                    stopAll()
                    return true
            }
        }
        return () => {
            manipulator.onTransportRequest = undefined
        }
    }, [manipulator, score, taking, stopAll, handlePlayToggle, playFrom, toggleRecording])

    // Route keyboard input through the manipulator. Re-runs once the editor chrome (and so the
    // container) mounts — which happens only after the score AND its instruments load, hence
    // both deps — attaching the listener and focusing the canvas for capture. Suspended while a
    // dialog is up so its keystrokes can't edit the score; when the dialog closes, re-attaching
    // also puts focus back on the canvas.
    const dialogOpen = instrumentDialogOpen || shortcutsOpen || recordingHalt !== null || micModeGuideOpen
    useEffect(() => {
        const el = containerRef.current
        if (!el || dialogOpen) return
        el.addEventListener('keydown', manipulator.handleKeyDown)
        focusCanvas()
        return () => el.removeEventListener('keydown', manipulator.handleKeyDown)
    }, [manipulator, score, dialogOpen, instrumentsReady, focusCanvas])

    // Straight from onboarding (?first=1), focus starts on the empty score's Start recording —
    // once, after the effect above has focused the editor (the keys stay on the editor, which
    // holds the button).
    const startRecordingRef = useRef<HTMLButtonElement>(null)
    const firstVisit = useRef<boolean | null>(null)
    const editorMounted = !!score && instrumentsReady
    useEffect(() => {
        if (!editorMounted) return
        firstVisit.current ??= new URLSearchParams(window.location.search).get('first') === '1'
        if (!firstVisit.current) return
        firstVisit.current = false
        const frame = requestAnimationFrame(() => startRecordingRef.current?.focus())
        return () => cancelAnimationFrame(frame)
    }, [editorMounted])

    // A take swaps the dock's contents: the strip replaces the tools (and, on phones, the footer's
    // Record with the strip's record-as-stop), and the take's end swaps them back. Focus on a
    // control that went (or just turned disabled, like Play mid-take) would drop to <body>, out
    // of reach of the editor's keys — so the record button in the dock takes it (phones), or else
    // the canvas, where Space and Escape still stop the take. Only focus the swap lost (or that
    // sits on the canvas or the editor itself) moves; an open dialog keeps its own. Declared after
    // the listener effect above, which focuses the canvas when the Mic Mode guide closes on the
    // take it starts.
    const dockRef = useRef<HTMLDivElement>(null)
    const stripUp = recordingStatus !== null
    const stripWasUp = useRef(stripUp)
    useEffect(() => {
        if (stripWasUp.current === stripUp) return
        stripWasUp.current = stripUp
        const editor = containerRef.current
        const focused = document.activeElement
        const lost =
            !focused ||
            focused === document.body ||
            focused === editor ||
            focused === canvasRef.current ||
            (focused instanceof HTMLButtonElement && focused.disabled)
        if (dialogOpen || !editor || !lost) return
        const recordButton = dockRef.current?.querySelector<HTMLElement>(RECORD_BUTTON_SELECTOR)
        // Without scrolling: the phone dock's rows are still animating to their new height inside a clipped frame.
        if (recordButton) recordButton.focus({ preventScroll: true })
        else focusCanvas()
    }, [stripUp, dialogOpen, focusCanvas])

    // Phone sheets live between the header and the dock (Popover's sheet frame reads
    // --app-header-h / --dock-h): measured, and re-measured whenever either bar changes size.
    // Toasts rise above the dock the same way (--toast-bottom, read by the app-wide Toaster on
    // the root element), so no toast ever covers the record button or a tool.
    const editorReady = !!score && instrumentsReady
    useEffect(() => {
        const root = containerRef.current
        const header = root?.querySelector('header')
        const dock = dockRef.current
        if (!root || !header || !dock) return
        const measure = () => {
            root.style.setProperty('--app-header-h', `${header.offsetHeight}px`)
            root.style.setProperty('--dock-h', `${dock.offsetHeight}px`)
            document.documentElement.style.setProperty('--toast-bottom', `${dock.offsetHeight + TOAST_GAP_PX}px`)
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(header)
        observer.observe(dock)
        return () => {
            observer.disconnect()
            document.documentElement.style.removeProperty('--toast-bottom')
        }
    }, [editorReady])

    // Unreachable (offline, or the server down) is no fault: a neutral screen that keeps trying
    // by itself (the query polls, and coming back online retries). A missing score, or one that
    // can't be read, is a real fault — with a way back to the library.
    if (loadError instanceof NetworkError && !scoreDocument) {
        return (
            <ErrorScreen
                tone="unreachable"
                title="Can't reach the server"
                message="Solkey isn't answering right now. We'll keep trying every few seconds — your score is safe."
                onRetry={() => void refetch()}
                retrying={isFetching}
                onBack={() => router.push('/scores')}
                backLabel="Back to library"
            />
        )
    }
    if (loadError || unreadable) {
        return (
            <ErrorScreen
                title={scoreMissing ? 'Score not found' : "This score couldn't be loaded"}
                message={
                    scoreMissing
                        ? 'This score doesn’t exist (anymore), or it belongs to a different account.'
                        : 'Something went wrong while loading this score. Try again, and if it keeps happening, come back in a few minutes.'
                }
                onRetry={scoreMissing ? undefined : () => void refetch()}
                onBack={() => router.push('/scores')}
                backLabel="Back to library"
            />
        )
    }

    // Hold the loading screen until the playback samples (score instrument + metronome
    // woodblock) are in memory: pressing record must click instantly, and a half-ready
    // editor whose transport buttons play nothing reads as broken. It says which wait it is.
    if (!score || !instrumentsReady) {
        return (
            <LoadingScreen
                testId="editor-loading"
                message={score ? `Getting the ${score.instrument.displayName.toLowerCase()} sound ready…` : 'Opening your score…'}
                slowAction={<TertiaryButton onClick={() => window.location.reload()}>Try again</TertiaryButton>}
            />
        )
    }

    const emptyScore = !score.hasPitchedNotes && !taking && playbackState === 'stopped'

    return (
        <div
            ref={containerRef}
            // Focusable but never a Tab stop: a click on bare chrome (the header's or the dock's
            // background) lands here instead of on <body>, keeping the keys in the editor — and
            // is handed straight on to the canvas, the editor's one named focus target.
            tabIndex={-1}
            className="relative flex flex-col h-dvh bg-surface text-on-surface outline-none"
            onFocus={(e) => {
                if (e.target === e.currentTarget) focusCanvas()
            }}
            // A context menu aimed at the canvas (or the editor itself) came from the keyboard
            // (Shift+F10, the Menu key — the focused element is the target): ours, not the browser's.
            onContextMenu={(e) => {
                if (e.target !== e.currentTarget && e.target !== canvasRef.current) return
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
                    onTitleDone={focusCanvas}
                    onChangeInstrument={() => {
                        if (!manipulator.historyLocked) setInstrumentDialogOpen(true)
                    }}
                    autosave={autosave}
                    compact={isMobile}
                    transport={transport}
                    transposeOpen={transposeOpen}
                    onTransposeOpenChange={setTransposeOpen}
                    onTransposeAim={aimTranspose}
                    shortcutsOpen={shortcutsOpen}
                    onOpenShortcuts={() => setShortcutsOpen(true)}
                    getSvg={() => scoreAreaRef.current?.querySelector<SVGSVGElement>(SCORE_SVG) ?? null}
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
                            {/* The canvas, named for a screen reader: the score's title, how the keys
                            work, and — while it is empty — what to do first. It wraps the score
                            alone: the bar buttons and the empty state after it stay plain page
                            content, reachable in browse mode. The keys bubble on to the page's
                            listener; the selection and the input cursor show where they go. */}
                            <div
                                ref={canvasRef}
                                tabIndex={0}
                                role="application"
                                aria-roledescription="score editor"
                                aria-label={title.trim() ? `${title.trim()} — score` : UNTITLED_SCORE}
                                aria-describedby={
                                    [emptyScore && emptyStateId, !isMobile && keyboardHelpId].filter(Boolean).join(' ') || undefined
                                }
                                className="outline-none">
                                <ScoreView
                                    score={score}
                                    layoutId={score.layout.id}
                                    // View-only while a take runs: a stray tap can't select a note (which
                                    // would end the take) or open a popover; scrolling stays native.
                                    interactive={!taking}
                                    selectedNote={activeNote}
                                    selectedNotes={manipulator.selectedNotes}
                                    highlight={pitchHighlight}
                                    playbackCursorRef={playbackCursorRef}
                                    waveformStore={waveformStore}
                                    onSelectionStart={handleSelectionStart}
                                    onSelectionExtend={handleSelectionExtend}
                                    onSelectionMenu={handleSelectionMenu}
                                    onNoteChange={handleNoteChange}
                                    onMeasureButtonsLayout={setMeasureButtonsRect}
                                    onAttributeClick={setAttributePopover}
                                    onAttributeHover={setAttributeHover}
                                />
                            </div>
                            {/* Chrome after the score's <svg> in DOM order — the exports and the selection
                                bar take the canvas's first svg — and none of it ever exported. */}
                            {measureButtonsRect && !taking && (
                                <MeasureControls
                                    rect={measureButtonsRect}
                                    canRemove={score.measures.length > 1}
                                    onAdd={() => manipulator.addMeasure()}
                                    onRemove={() => manipulator.removeMeasure()}
                                />
                            )}
                            <EditorEmptyState
                                show={emptyScore}
                                touch={isMobile}
                                // The button goes (inert, then unmounted) the moment the recording starts:
                                // the keys move to the canvas first, so Space and Escape can still stop it.
                                onStartRecording={() => {
                                    focusCanvas()
                                    toggleRecording()
                                }}
                                descriptionId={emptyStateId}
                                startRef={startRecordingRef}
                            />
                            {!isMobile && <KeyboardHelp id={keyboardHelpId} keybindings={manipulator.keybindings} />}
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
                                        manipulator.deleteSelection({ offerUndo: true })
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
                        // One instruction at a time: the phone's selection tip, or on an empty score the
                        // first-melody card, keeps the dock's how-to-move-a-note line out — the only
                        // thing selected there is a rest. It shows on the first selection after.
                        hint={selectionTipUp || emptyScore ? null : undefined}
                        recording={
                            recordingStatus ? (
                                <>
                                    <RecordingStrip status={recordingStatus} touch={isMobile} />
                                    {isMobile && <RecordButton {...transport} large />}
                                </>
                            ) : undefined
                        }
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
                        onUpgrade={(planId) => router.push(withPlan(settingsTabPath('plan'), planId))}
                        onClose={dismissRecordingHalt}
                    />
                )}
                {recordingHalt?.kind === 'concurrent' && <ConcurrentRecordingDialog onClose={dismissRecordingHalt} />}
                {recordingHalt?.kind === 'mic-blocked' && <MicBlockedDialog onRetry={retryRecording} onClose={dismissRecordingHalt} />}
                {micModeGuideOpen && (
                    <MicModeGuideDialog onConfirm={confirmMicModeGuide} onSkip={skipMicModeGuide} onClose={dismissMicModeGuide} />
                )}
            </PopoverSheetHost>
            <EditorAnnouncer manipulator={manipulator} />
        </div>
    )
}
