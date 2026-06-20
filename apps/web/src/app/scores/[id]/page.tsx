'use client'

import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { type ClefType, type DurationType, Score as ScoreView } from '@/components/notation'
import type { ScorePartwise } from '@/components/notation/types'
import { ErrorScreen, Icon, Pill, showToast, Wordmark } from '@/components/ui'
import { ApiError, NetworkError } from '@/lib/api'
import { CursorManager } from '@/lib/CursorManager'
import { Metronome } from '@/lib/Metronome'
import { MidiPlayer } from '@/lib/MidiPlayer'
import { useScoreDocument, useUpdateScore } from '@/lib/queries'
import { RecordingEngine, type RecordingLimitInfo, type RecordingState } from '@/lib/RecordingEngine'
import { ScoreScheduler } from '@/lib/ScoreScheduler'
import { Ticker } from '@/lib/Ticker'
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
import { ControlBar } from './ControlBar'
import { ExportMenu } from './ExportMenu'
import { ConcurrentRecordingDialog, RecordingLimitDialog } from './RecordingDialogs'
import { ScoreManipulator } from './ScoreManipulator'

// Why the recording was cut short (or refused) — drives which dialog shows.
type RecordingHalt = { kind: 'limit'; info: RecordingLimitInfo } | { kind: 'concurrent' } | null

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
    const tickerRef = useRef<Ticker | null>(null)
    const schedulerRef = useRef<ScoreScheduler | null>(null)
    const metronomeRef = useRef<Metronome | null>(null)
    const cursorRef = useRef<CursorManager | null>(null)
    const midiPlayerRef = useRef<MidiPlayer | null>(null)
    const recordingEngineRef = useRef<RecordingEngine | null>(null)
    const playbackCursorRef = useRef<SVGRectElement | null>(null)
    const recordingWaveformRef = useRef<SVGPathElement | null>(null)
    const [playbackState, setPlaybackState] = useState<'stopped' | 'playing' | 'paused'>('stopped')
    const [recordingState, setRecordingState] = useState<RecordingState>('idle')
    const [metronome, setMetronome] = useState(false)
    const [instrumentDialogOpen, setInstrumentDialogOpen] = useState(false)
    const [recordingHalt, setRecordingHalt] = useState<RecordingHalt>(null)

    const { data: scoreDocument, error: loadError, refetch } = useScoreDocument(id)
    const { mutate: saveScore } = useUpdateScore(id)

    const saveToApi = useCallback(
        (changes: { title?: string; score?: Score }) => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
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
                if (body.title !== undefined || body.measures || body.allMeasures || body.partList) saveScore(body)
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

    // Initialize playback components
    useEffect(() => {
        const midiPlayer = new MidiPlayer()
        const scheduler = new ScoreScheduler(midiPlayer)
        const met = new Metronome(midiPlayer)
        const cursor = new CursorManager(midiPlayer, scheduler)
        const recordingEngine = new RecordingEngine(midiPlayer)
        const ticker = new Ticker()

        ticker.addTickable(scheduler)
        ticker.addTickable(met)
        ticker.addTickable(cursor)
        ticker.addTickable(recordingEngine)

        midiPlayerRef.current = midiPlayer
        tickerRef.current = ticker
        schedulerRef.current = scheduler
        metronomeRef.current = met
        cursorRef.current = cursor
        recordingEngineRef.current = recordingEngine

        return () => {
            ticker.stop()
            recordingEngine.stop()
            midiPlayer.dispose()
        }
    }, [])

    // Lazy-load only the instruments the score needs (its own + woodblock for the metronome click).
    // Re-runs when the score's selected instrument changes — the picker mutates `score.instrument`
    // in place, but the manipulator's onScoreChange re-render re-evaluates `score?.instrument.id`.
    useEffect(() => {
        if (!score) return
        const player = midiPlayerRef.current
        if (!player) return
        void player.loadInstruments([score.instrument, Instrument.Woodblock])
    }, [score, score?.instrument.id])

    const stopAll = useCallback(() => {
        tickerRef.current?.stop()
        recordingEngineRef.current?.stop()
        midiPlayerRef.current?.stop()
        cursorRef.current?.hideCursor()
        setPlaybackState('stopped')
    }, [])

    // Preview the selected note's pitch and stop any ongoing playback/recording.
    // The Note holds written pitch; convert to sounding before passing to the player.
    // Skipped while a range is selected, so dragging across notes doesn't chatter.
    useEffect(() => {
        stopAll()
        const written = activeNote?.pitch?.toMidi()
        const player = midiPlayerRef.current
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

    // Sync metronome toggle to the ticker. Skipped during recording — the recording flow
    // forces the metronome on; when recording ends this effect re-syncs to the user's toggle.
    useEffect(() => {
        const met = metronomeRef.current
        const ticker = tickerRef.current
        if (!met || !ticker) return
        if (recordingState !== 'idle') return
        if (metronome) ticker.addTickable(met)
        else ticker.removeTickable(met)
        met.startMeasureIndex = 0
    }, [metronome, recordingState])

    const handlePlayToggle = useCallback(() => {
        if (!score) return
        const midiPlayer = midiPlayerRef.current
        const ticker = tickerRef.current
        const scheduler = schedulerRef.current
        const met = metronomeRef.current
        const cursor = cursorRef.current
        if (!ticker || !scheduler || !met || !cursor) return

        if (playbackState === 'playing') {
            ticker.stop()
            midiPlayer?.pause()
            setPlaybackState('paused')
            return
        }

        if (playbackState === 'paused') {
            midiPlayer?.resume()
            ticker.resume()
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
        scheduler.score = score
        scheduler.startNote = activeNote
        met.score = score
        met.startMeasureIndex = activeNote?.measure.index ?? 0
        met.startBeat = activeNote ? activeNote.measure.beatOffsetOf(activeNote) : 0
        cursor.bind(cursorEl, resolvePosition)

        midiPlayer?.start()
        ticker.play(() => setPlaybackState('stopped'))
        setPlaybackState('playing')
    }, [score, activeNote, playbackState])

    const handleRecordToggle = useCallback(async () => {
        if (!score || !activeNote) return
        const midiPlayer = midiPlayerRef.current
        const ticker = tickerRef.current
        const engine = recordingEngineRef.current
        const met = metronomeRef.current
        if (!ticker || !engine || !midiPlayer || !met) return

        if (engine.state !== 'idle') {
            stopAll()
            return
        }

        // Stop any ongoing playback before beginning a recording session.
        ticker.stop()
        midiPlayer.stop()
        setPlaybackState('stopped')

        let measureIndex = activeNote.measure.index
        manipulator.select(null)
        const startIndex = measureIndex
        score.addMeasure(measureIndex++).complete()
        saveToApi({ score })

        met.score = score
        met.startMeasureIndex = startIndex
        ticker.addTickable(met)

        const cursorEl = playbackCursorRef.current
        if (!cursorEl) return

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
            await engine.start({
                score,
                startMeasureIndex: startIndex,
                cursorEl,
                waveformEl: recordingWaveformRef.current,
                resolvePosition,
                wsUrl,
                onStateChange: setRecordingState,
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
                    }
                    saveToApi({ score })
                },
                onLimitReached: (info) => {
                    stopAll()
                    setRecordingHalt({ kind: 'limit', info })
                },
                onRecordingError: (code) => {
                    stopAll()
                    if (code === 'concurrent-recording') setRecordingHalt({ kind: 'concurrent' })
                },
            })
        } catch (err) {
            console.error('Recording failed to start', err)
            showToast("Recording couldn't start. Check your microphone permission and connection, then try again.")
            stopAll()
            return
        }

        midiPlayer.start()
        ticker.play(() => setRecordingState('idle'))
    }, [manipulator, score, activeNote, stopAll, saveToApi])

    // Route keyboard input through the manipulator. Re-runs once the editor chrome (and so the
    // container) mounts after the score loads, attaching the listener and focusing for capture.
    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        el.addEventListener('keydown', manipulator.handleKeyDown)
        el.focus()
        return () => el.removeEventListener('keydown', manipulator.handleKeyDown)
    }, [manipulator, score])

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
        <div ref={containerRef} tabIndex={0} className="flex flex-col min-h-screen max-h-screen bg-surface text-on-surface outline-none">
            <header className="flex items-center justify-between gap-4 px-6 py-3.5 bg-surface/85 backdrop-blur-xl tonal-layer-glow z-10">
                <div className="flex items-center gap-4 min-w-0 flex-1">
                    <button
                        onClick={() => router.push('/scores')}
                        aria-label="Back to library"
                        className="bg-transparent border-0 cursor-pointer text-on-surface-variant p-1 inline-flex">
                        <Icon name="arrow-left" size={20} />
                    </button>
                    <Wordmark size={22} />
                    <div className="w-px h-6 bg-outline-variant/15" />
                    <input
                        value={title}
                        onChange={(e) => {
                            const v = e.target.value
                            setTitle(v)
                            saveToApi({ title: v })
                        }}
                        className="bg-transparent border-0 outline-0 font-serif italic text-[22px] text-on-surface p-1 min-w-0 flex-1"
                    />
                    <button
                        type="button"
                        onClick={() => setInstrumentDialogOpen(true)}
                        aria-label={`Change instrument (current: ${score.instrument.displayName})`}
                        className="bg-transparent border-0 p-0 cursor-pointer">
                        <Pill>{score.instrument.displayName}</Pill>
                    </button>
                </div>
                <ExportMenu score={score} title={title} getSvg={() => scoreAreaRef.current?.querySelector('svg') ?? null} />
            </header>
            <ControlBar
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
                playbackState={playbackState}
                onPlayToggle={handlePlayToggle}
                onStop={stopAll}
                recordingState={recordingState}
                onRecordToggle={() => void handleRecordToggle()}
                metronome={metronome}
                onMetronomeToggle={() => setMetronome((m) => !m)}
            />
            <div className="flex-1 overflow-y-auto min-h-0 px-8 py-6 bg-surface">
                <div ref={scoreAreaRef} className="mx-auto max-w-240 min-h-full bg-surface-container-lowest p-10 tonal-layer-glow">
                    <ScoreView
                        score={score}
                        layoutId={score.layout.id}
                        selectedNote={activeNote}
                        selectedNotes={manipulator.selectedNotes}
                        playbackCursorRef={playbackCursorRef}
                        recordingWaveformRef={recordingWaveformRef}
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

            <ChangeInstrumentDialog
                open={instrumentDialogOpen}
                current={score.instrument}
                onCancel={() => setInstrumentDialogOpen(false)}
                onConfirm={handleInstrumentChange}
            />

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
