'use client'

import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { type ClefType, type DurationType, Score as ScoreView } from '@/components/notation'
import type { ScorePartwise } from '@/components/notation/types'
import { ChipToggle, ErrorScreen, Icon, Wordmark } from '@/components/ui'
import { ApiError, NetworkError } from '@/lib/api'
import { useSaveKeyboardShortcuts, useScoreDocument, useSettings } from '@/lib/queries'
import { Instrument, type Note, type Pitch } from '@/model'
import { ScoreDeserializer } from '@/model/util/ScoreDeserializer'

import {
    CHANGE_PITCH,
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
import { NoteToolDock, TransportControls } from './EditorControls'
import { ExportMenu } from './ExportMenu'
import { KeyboardShortcutsDialog } from './KeyboardShortcutsDialog'
import { ConcurrentRecordingDialog, RecordingLimitDialog } from './RecordingDialogs'
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
        manipulator.attach(s, () => saveToApi({ score: s }))
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
    const handleAddMeasure = useCallback(() => manipulator.addMeasure(), [manipulator])
    const handleRemoveMeasure = useCallback(() => manipulator.removeMeasure(), [manipulator])
    const handleTempoChange = useCallback(
        (measureIndex: number, beatPosition: number, bpm: number) => manipulator.setTempoAt(measureIndex, beatPosition, bpm),
        [manipulator],
    )

    const { transportRef, playbackCursorRef, playbackState, metronome, setMetronome, stopAll, handlePlayToggle } = usePlayback({
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

    const { waveformStore, recordingState, recordingHalt, setRecordingHalt, handleRecordToggle } = useRecording({
        id,
        manipulator,
        score,
        activeNote,
        transportRef,
        playbackCursorRef,
        stopAll,
        saveToApi,
    })

    // Route keyboard input through the manipulator. Re-runs once the editor chrome (and so the
    // container) mounts after the score loads, attaching the listener and focusing for capture.
    // Suspended while a dialog is up so its keystrokes can't edit the score; when the dialog
    // closes, re-attaching also puts focus back on the editor.
    const dialogOpen = instrumentDialogOpen || shortcutsOpen || recordingHalt !== null
    useEffect(() => {
        const el = containerRef.current
        if (!el || dialogOpen) return
        el.addEventListener('keydown', manipulator.handleKeyDown)
        el.focus()
        return () => el.removeEventListener('keydown', manipulator.handleKeyDown)
    }, [manipulator, score, dialogOpen])

    if (loadError) {
        const serverDown = loadError instanceof NetworkError
        const notFound = loadError instanceof ApiError && loadError.status === 404
        return (
            <ErrorScreen
                title={serverDown ? "Can't reach the server" : notFound ? 'Score not found' : "This score couldn't be loaded"}
                message={
                    serverDown
                        ? 'Sheemu could not connect to its server, so this score can’t be opened right now. Check your internet connection, or try again in a moment.'
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

    if (!score) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
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
            className="relative flex flex-col min-h-screen max-h-screen bg-surface text-on-surface outline-none">
            <header className="flex items-center gap-4 px-5 py-2 bg-surface-container-low/85 backdrop-blur-xl tonal-layer-glow z-10">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <button
                        onClick={() => router.push('/scores')}
                        aria-label="Back to library"
                        className={[
                            'bg-transparent border-0 cursor-pointer text-on-surface-variant p-1.5 -ml-1.5 inline-flex rounded-full',
                            'hover:text-on-surface transition-colors duration-150 ease-sheemu',
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
                            'bg-secondary-soft/70 text-on-secondary-soft hover:bg-secondary-soft',
                            'transition-colors duration-150 ease-sheemu',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                        ].join(' ')}>
                        {score.instrument.displayName}
                        <Icon name="sliders-horizontal" size={11} />
                    </button>
                </div>
                <TransportControls
                    playbackState={playbackState}
                    onPlayToggle={handlePlayToggle}
                    onStop={stopAll}
                    recordingState={recordingState}
                    onRecordToggle={() => void handleRecordToggle()}
                    metronome={metronome}
                    onMetronomeToggle={() => setMetronome((m) => !m)}
                />
                <div className="flex items-center gap-2 flex-1 justify-end">
                    <ChipToggle active={shortcutsOpen} onClick={() => setShortcutsOpen(true)} ariaLabel="Keyboard shortcuts">
                        <Icon name="keyboard" size={16} />
                    </ChipToggle>
                    <ExportMenu score={score} title={title} getSvg={() => scoreAreaRef.current?.querySelector('svg') ?? null} />
                </div>
            </header>
            {/* flex-col + grow (not min-h-full): the canvas must fill the scroll viewport
                even when the score is short, and a percentage min-height can't resolve
                against a flex-sized (height-less) scroll container. */}
            <div className="flex-1 overflow-y-auto min-h-0 px-8 bg-surface flex flex-col">
                <div ref={scoreAreaRef} className="mx-auto w-full max-w-240 grow bg-surface-container-lowest p-10 tonal-layer-glow manuscript-canvas">
                    <ScoreView
                        score={score}
                        layoutId={score.layout.id}
                        selectedNote={activeNote}
                        selectedNotes={manipulator.selectedNotes}
                        playbackCursorRef={playbackCursorRef}
                        waveformStore={waveformStore}
                        onSelectionStart={handleSelectionStart}
                        onSelectionExtend={handleSelectionExtend}
                        onNoteChange={handleNoteChange}
                        onAddMeasure={handleAddMeasure}
                        onRemoveMeasure={handleRemoveMeasure}
                        canRemoveMeasure={score.measures.length > 1}
                        onTempoChange={handleTempoChange}
                    />
                </div>
            </div>
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
                selectionDisabled={!activeNote}
            />

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
        </div>
    )
}
