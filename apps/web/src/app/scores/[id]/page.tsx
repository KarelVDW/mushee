'use client'

import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { type ClefType, type DurationType, Score as ScoreView } from '@/components/notation'
import type { ScorePartwise } from '@/components/notation/types'
import { ChipToggle, ErrorScreen, Icon, showToast, Wordmark } from '@/components/ui'
import { track } from '@/lib/analytics'
import { ApiError, NetworkError } from '@/lib/api'
import { useSaveKeyboardShortcuts, useScoreDocument, useSettings, useUpdateScore } from '@/lib/queries'
import { type RecordingLimitInfo, type RecordingState, RecordingUnsupportedError } from '@/lib/RecordingEngine'
import { RecordingWaveformStore } from '@/lib/RecordingWaveformStore'
import { Transport } from '@/lib/Transport'
import { Instrument, type Note, type Pitch, type Score } from '@/model'
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

// Why the recording was cut short (or refused) — drives which dialog shows.
type RecordingHalt = { kind: 'limit'; info: RecordingLimitInfo } | { kind: 'concurrent' } | null

const TITLE_TYPE = 'font-display font-medium text-[17px] leading-none tracking-[-0.01em]'

// Sizes to its text via an invisible mirror span, so the instrument chip sits right next to
// the title instead of a full-width input pushing it across the header.
function TitleInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="relative min-w-16 max-w-[40%] shrink-0">
            <span aria-hidden className={`${TITLE_TYPE} invisible block overflow-hidden whitespace-pre px-2 py-2`}>
                {value || ' '}
            </span>
            <input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                aria-label="Score title"
                className={[
                    TITLE_TYPE,
                    'absolute inset-0 w-full bg-transparent border-0 outline-0 text-on-surface px-2 py-2 rounded-sm',
                    'hover:bg-surface-container focus:bg-surface-container transition-colors duration-150 ease-sheemu',
                ].join(' ')}
            />
        </div>
    )
}

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
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const saveRetryRef = useRef<ReturnType<typeof setTimeout>>(undefined)
    const transportRef = useRef<Transport | null>(null)
    const playbackCursorRef = useRef<SVGRectElement | null>(null)
    // Live waveform bars: an external store so 30Hz mic samples re-render only
    // the waveform layer inside the score SVG, never this page.
    const [waveformStore] = useState(() => new RecordingWaveformStore())
    const [playbackState, setPlaybackState] = useState<'stopped' | 'playing' | 'paused'>('stopped')
    const [recordingState, setRecordingState] = useState<RecordingState>('idle')
    const [metronome, setMetronome] = useState(false)
    const [instrumentDialogOpen, setInstrumentDialogOpen] = useState(false)
    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    const [recordingHalt, setRecordingHalt] = useState<RecordingHalt>(null)

    const { data: scoreDocument, error: loadError, refetch } = useScoreDocument(id)
    const { mutate: saveScore } = useUpdateScore(id)

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

    const saveToApi = useCallback(
        (changes: { title?: string; score?: Score }) => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
            if (saveRetryRef.current) clearTimeout(saveRetryRef.current)
            saveTimeoutRef.current = setTimeout(() => {
                const body: {
                    title?: string
                    measures?: Record<string, unknown>
                    allMeasures?: unknown[]
                    partList?: Record<string, unknown>
                } = {}
                if (changes.title !== undefined) body.title = changes.title
                if (changes.score) {
                    const dirty = changes.score.flushDirty()
                    if (dirty?.measures) body.measures = dirty.measures
                    if (dirty?.allMeasures) body.allMeasures = dirty.allMeasures
                    if (dirty?.partList) body.partList = dirty.partList
                }
                if (body.title !== undefined || body.measures || body.allMeasures || body.partList) {
                    saveScore(body, {
                        onError: () => {
                            // flushDirty cleared this state before the request
                            // settled — put it back and retry, or these edits
                            // are silently gone until an unrelated later edit.
                            changes.score?.redirty(body)
                            saveRetryRef.current = setTimeout(() => saveToApi(changes), 10_000)
                        },
                    })
                }
            }, 2000)
        },
        [saveScore],
    )

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

    // The Transport owns the shared clock and every playback/recording unit;
    // this page only tells it which mode to enter.
    useEffect(() => {
        const transport = new Transport()
        transportRef.current = transport
        return () => {
            transportRef.current = null
            transport.dispose()
        }
    }, [])

    // Lazy-load only the instruments the score needs (its own + woodblock for the metronome click).
    // Re-runs when the score's selected instrument changes — the picker mutates `score.instrument`
    // in place, but the manipulator's onScoreChange re-render re-evaluates `score?.instrument.id`.
    useEffect(() => {
        if (!score) return
        const player = transportRef.current?.midiPlayer
        if (!player) return
        void player.loadInstruments([score.instrument, Instrument.Woodblock])
    }, [score, score?.instrument.id])

    const stopAll = useCallback(() => {
        transportRef.current?.stop()
        setPlaybackState('stopped')
    }, [])

    // Selecting a note stops any ongoing playback/recording and previews its pitch.
    // The Note holds written pitch; convert to sounding before passing to the player.
    // Skipped while a range is selected, so dragging across notes doesn't chatter.
    // A cleared selection changes nothing — the recording flow deselects as it
    // starts, and stopping here would kill the take it is setting up.
    useEffect(() => {
        if (!activeNote) return
        stopAll()
        const written = activeNote.pitch?.toMidi()
        const player = transportRef.current?.midiPlayer
        if (written === undefined || !player || !score || manipulator.selectedNotes.length > 1) return
        const sounding = written + score.instrument.chromaticTranspose
        player.preview(sounding, 0.75, score.instrument)
    }, [activeNote, stopAll, score, manipulator])

    const handleInstrumentChange = useCallback(
        (instrument: Instrument) => {
            stopAll()
            manipulator.setInstrument(instrument)
            setInstrumentDialogOpen(false)
        },
        [manipulator, stopAll],
    )

    // Sync the metronome toggle to the transport. Recording is unaffected — a
    // take always keeps its click; the toggle only governs playback passes.
    useEffect(() => {
        transportRef.current?.setMetronomeEnabled(metronome)
    }, [metronome])

    const handlePlayToggle = useCallback(() => {
        if (!score) return
        const transport = transportRef.current
        if (!transport) return

        if (playbackState === 'playing') {
            transport.pause()
            setPlaybackState('paused')
            return
        }

        if (playbackState === 'paused') {
            transport.resume()
            setPlaybackState('playing')
            return
        }

        const cursorEl = playbackCursorRef.current
        if (!cursorEl) return

        const resolvePosition = (pos: { measureIndex: number; beat: number }) => {
            const measure = score.measures[pos.measureIndex]
            const row = score.layout.rowFor(measure)
            const measureX = row.getMeasureX(measure)
            return { x: measureX + measure.layout.getXForBeat(pos.beat), rowY: score.layout.getYForRow(row) }
        }

        // Launching from a stop begins at the selected note (falling back to the top of the
        // score when nothing is selected); resume/pause above keep their place instead.
        transport.playScore({
            score,
            startNote: activeNote,
            cursorEl,
            resolvePosition,
            onFinish: () => setPlaybackState('stopped'),
        })
        setPlaybackState('playing')
    }, [score, activeNote, playbackState])

    const handleRecordToggle = useCallback(async () => {
        if (!score || !activeNote) return
        const transport = transportRef.current
        if (!transport) return

        if (transport.isRecording) {
            stopAll()
            return
        }

        const cursorEl = playbackCursorRef.current
        if (!cursorEl) return

        // Stop any ongoing playback before beginning a recording session.
        stopAll()

        let measureIndex = activeNote.measure.index
        manipulator.select(null)
        waveformStore.reset()
        const startIndex = measureIndex
        score.addMeasure(measureIndex++).complete()
        saveToApi({ score })

        const resolvePosition = (measureIndex: number, beat: number) => {
            const measure = score.measures[measureIndex]
            if (!measure) return null
            const row = score.layout.rowFor(measure)
            const measureX = row.getMeasureX(measure)
            return { x: measureX + measure.layout.getXForBeat(beat), rowY: score.layout.getYForRow(row) }
        }

        // Every recording belongs to a score; the gateway requires the id up front.
        const wsUrl =
            (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4200').replace(/^http/, 'ws') +
            `/recording?scoreId=${encodeURIComponent(id)}`

        try {
            await transport.record({
                score,
                startMeasureIndex: startIndex,
                cursorEl,
                resolvePosition,
                wsUrl,
                onStateChange: (state) => {
                    setRecordingState(state)
                    // The take ended: whatever bars are still waiting for their
                    // notes animate out together.
                    if (state === 'idle') waveformStore.clearAll()
                },
                onSample: (sample) => {
                    waveformStore.add({
                        id: sample.timeMs,
                        measureIndex: sample.measureIndex,
                        beat: sample.beat,
                        amp: sample.amp,
                    })
                },
                onNeedNewMeasure: () => {
                    score.addMeasure(measureIndex++).complete()
                    saveToApi({ score })
                },
                onScoreUpdate: ({ measures }) => {
                    for (const [key, mxmlMeasure] of Object.entries(measures)) {
                        const absIndex = startIndex + Number(key)
                        const measure = score.measures[absIndex]
                        if (!measure?.firstNote) continue
                        const notes = ScoreDeserializer.mxmlMeasureToNotes(mxmlMeasure)
                        if (!notes.length) continue
                        score.replace([measure.firstNote], notes)
                        // The staff now shows real notes up to the end of the last
                        // pitched note in this measure — their waveform bars have
                        // done their job and can animate out.
                        let beat = 0
                        let coveredBeats = 0
                        for (const note of notes) {
                            const span = note.duration.effectiveBeats
                            if (!note.isRest) coveredBeats = beat + span
                            beat += span
                        }
                        if (coveredBeats > 0) waveformStore.clearCovered(absIndex, coveredBeats)
                    }
                    saveToApi({ score })
                },
                onLimitReached: (info) => {
                    stopAll()
                    setRecordingHalt({ kind: 'limit', info })
                },
                onConnectionLost: () => {
                    stopAll()
                    showToast('The recording connection was lost. Notes transcribed so far are kept — try recording again.')
                },
                onRecordingError: (code) => {
                    stopAll()
                    if (code === 'concurrent-recording') setRecordingHalt({ kind: 'concurrent' })
                    // Belt-and-braces: AuthGate keeps unapproved beta users off
                    // this page, but the gateway enforces it too.
                    if (code === 'beta-pending') {
                        showToast('Your beta access is still awaiting approval.')
                        router.push('/beta')
                    }
                },
            })
        } catch (err) {
            console.error('Recording failed to start', err)
            if (err instanceof RecordingUnsupportedError) {
                showToast("This browser can't record audio. Use a recent Chrome, Edge, Firefox, or Safari over HTTPS.")
            } else if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
                showToast('Microphone access was blocked. Allow the microphone for this site, then try again.')
            } else {
                showToast("Recording couldn't start. Check your microphone permission and connection, then try again.")
            }
            stopAll()
            return
        }

        track('recording_started')
    }, [manipulator, score, activeNote, stopAll, saveToApi, id, router, waveformStore])

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
            <div className="flex-1 overflow-y-auto min-h-0 px-8 bg-surface">
                <div ref={scoreAreaRef} className="mx-auto max-w-240 min-h-full bg-surface-container-lowest p-10 tonal-layer-glow manuscript-canvas">
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
