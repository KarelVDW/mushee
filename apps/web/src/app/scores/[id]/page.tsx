'use client'

import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { type DurationType, Score as ScoreView } from '@/components/notation'
import type { ScorePartwise } from '@/components/notation/types'
import { Icon, Pill, SecondaryButton, Wordmark } from '@/components/ui'
import { getScore, loadScore, updateScore } from '@/lib/api'
import { CursorManager } from '@/lib/CursorManager'
import { Metronome } from '@/lib/Metronome'
import { MidiPlayer } from '@/lib/MidiPlayer'
import { RecordingEngine, type RecordingState } from '@/lib/RecordingEngine'
import { ScoreScheduler } from '@/lib/ScoreScheduler'
import { Ticker } from '@/lib/Ticker'
import { Duration, Instrument, type Note, Pitch, Score } from '@/model'
import { ScoreDeserializer } from '@/model/util/ScoreDeserializer'

import { ChangeInstrumentDialog } from './ChangeInstrumentDialog'
import { ControlBar } from './ControlBar'

export default function ScoreEditorPage() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    const [score, setScore] = useState<Score | null>(null)
    const [title, setTitle] = useState('Untitled composition')
    const [, setUpdatedAt] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeNote, setActiveNote] = useState<Note | null>(null)
    const containerRef = useRef<HTMLDivElement>(null)
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

    useEffect(() => {
        async function load() {
            try {
                const [meta, data] = await Promise.all([getScore(id), loadScore(id)])
                setTitle(meta.title)
                const deserializer = new ScoreDeserializer(data as unknown as ScorePartwise)
                const s = deserializer.toScore(() => setUpdatedAt(Date.now()))
                setScore(s)
                setActiveNote(s.firstMeasure?.firstNote ?? null)
            } catch (err) {
                console.log(err)
                setError('Failed to load score')
            } finally {
                setLoading(false)
            }
        }
        void load()
    }, [id])

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
                if (body.title !== undefined || body.measures || body.allMeasures || body.partList) void updateScore(id, body)
            }, 2000)
        },
        [id],
    )

    const handleNoteChange = useCallback(
        (note: Note, newPitch: Pitch) => {
            if (!score) return
            const [newNote] = score.replace([note], [note.clone({ pitch: newPitch })])
            setActiveNote(newNote)
            saveToApi({ score })
        },
        [score, saveToApi],
    )

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (!score) return
            if (e.key === 'ArrowRight') {
                e.preventDefault()
                const next = activeNote?.getNext()
                if (next) setActiveNote(next)
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault()
                const prev = activeNote?.getPrevious()
                if (prev) setActiveNote(prev)
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                if (activeNote) {
                    const [newNote] = score.replace([activeNote], [activeNote.clone({ pitch: activeNote.pitch?.raised() })])
                    setActiveNote(newNote)
                    saveToApi({ score })
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (activeNote) {
                    const [newNote] = score.replace([activeNote], [activeNote.clone({ pitch: activeNote.pitch?.lowered() })])
                    setActiveNote(newNote)
                    saveToApi({ score })
                }
            } else if (e.key === 'Backspace') {
                e.preventDefault()
                if (activeNote) {
                    const [newNote] = score.replace([activeNote], [activeNote.clone({ pitch: undefined })])
                    setActiveNote(newNote)
                    saveToApi({ score })
                }
            }
        },
        [activeNote, score, saveToApi],
    )

    const handleAccidentalChange = useCallback(
        (acc: string | undefined) => {
            if (!activeNote || !score) return
            const [newNote] = score.replace([activeNote], [activeNote.clone({ pitch: activeNote.pitch?.withAccidental(acc) })])
            setActiveNote(newNote)
            saveToApi({ score })
        },
        [activeNote, score, saveToApi],
    )

    const handleDurationChange = useCallback(
        (newDuration: DurationType) => {
            if (!activeNote || !score) return
            const [newNote] = score.replace([activeNote], [activeNote.clone({ duration: new Duration({ type: newDuration }) })])
            setActiveNote(newNote)
            saveToApi({ score })
        },
        [activeNote, score, saveToApi],
    )

    const handleDotToggle = useCallback(() => {
        if (!activeNote || !score) return
        const newDots = activeNote.duration.dots > 0 ? 0 : 1
        const [newNote] = score.replace(
            [activeNote],
            [
                activeNote.clone({
                    duration: new Duration({ type: activeNote.duration.type, dots: newDots, ratio: activeNote.duration.ratio }),
                }),
            ],
        )
        setActiveNote(newNote)
        saveToApi({ score })
    }, [activeNote, score, saveToApi])

    const handleTieToggle = useCallback(() => {
        if (!activeNote || !score) return
        const newTie = activeNote.tiesForward ? undefined : ('start' as const)
        const [newNote] = score.replace([activeNote], [activeNote.clone({ tie: newTie })])
        setActiveNote(newNote)
        saveToApi({ score })
    }, [activeNote, score, saveToApi])

    const handleRestToggle = useCallback(() => {
        if (!activeNote || !score) return
        const newPitch = activeNote.isRest ? new Pitch({ name: 'B', octave: 4 }) : undefined
        const [newNote] = score.replace([activeNote], [activeNote.clone({ pitch: newPitch })])
        setActiveNote(newNote)
        saveToApi({ score })
    }, [activeNote, score, saveToApi])

    const handleTempoSet = useCallback(
        (bpm: number) => {
            if (!activeNote || !score) return
            score.setTempo(activeNote, bpm)
            saveToApi({ score })
        },
        [activeNote, score, saveToApi],
    )

    const handleTempoChange = useCallback(
        (measureIndex: number, beatPosition: number, bpm: number) => {
            if (!score) return
            const measure = score.measures[measureIndex]
            if (!measure) return
            score.setTempo(measure.noteAtBeat(beatPosition), bpm)
            saveToApi({ score })
        },
        [score, saveToApi],
    )

    const handleNoteSelect = useCallback((note: Note) => setActiveNote(note), [])

    const handleAddMeasure = useCallback(() => {
        if (!score) return
        score.addMeasure().complete()
        saveToApi({ score })
    }, [score, saveToApi])

    const handleRemoveMeasure = useCallback(() => {
        if (!score) return
        score.removeLastMeasure()
        setActiveNote(score.lastMeasure?.lastNote || null)
        saveToApi({ score })
    }, [score, saveToApi])

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
    // in place but `setUpdatedAt` triggers a re-render that re-evaluates `score?.instrument.id`.
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
    useEffect(() => {
        stopAll()
        const written = activeNote?.pitch?.toMidi()
        const player = midiPlayerRef.current
        if (written === undefined || !player || !score) return
        const sounding = written + score.instrument.chromaticTranspose
        player.preview(sounding, 0.75, score.instrument)
    }, [activeNote, stopAll, score])

    const handleInstrumentChange = useCallback(
        (instrument: Instrument) => {
            if (!score) return
            stopAll()
            // Capture the active note's position; setInstrument rewrites all notes through `replace`,
            // so the existing ref becomes stale. Re-resolve at the same (measure, index) afterwards.
            const measureIdx = activeNote ? activeNote.measure.index : null
            const noteIdx = activeNote ? activeNote.measure.notes.indexOf(activeNote) : null
            score.setInstrument(instrument)
            if (measureIdx !== null && noteIdx !== null && noteIdx >= 0) {
                setActiveNote(score.measures[measureIdx]?.notes[noteIdx] ?? null)
            }
            setInstrumentDialogOpen(false)
            saveToApi({ score })
        },
        [score, activeNote, stopAll, saveToApi],
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
            const row = score.getRowForMeasure(measure)
            const measureX = row.layout.getMeasureX(measure)
            return { x: measureX + measure.layout.getXForBeat(pos.beat), rowY: score.layout.getYForRow(row) }
        }

        scheduler.score = score
        met.score = score
        cursor.bind(cursorEl, resolvePosition)

        midiPlayer?.start()
        ticker.play(() => setPlaybackState('stopped'))
        setPlaybackState('playing')
    }, [score, playbackState])

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
        setActiveNote(null)
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
            const row = score.getRowForMeasure(measure)
            const measureX = row.layout.getMeasureX(measure)
            return { x: measureX + measure.layout.getXForBeat(beat), rowY: score.layout.getYForRow(row) }
        }

        const wsUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/^http/, 'ws') + '/recording'

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
            })
        } catch (err) {
            console.error('Recording failed to start', err)
            stopAll()
            return
        }

        midiPlayer.start()
        ticker.play(() => setRecordingState('idle'))
    }, [score, activeNote, stopAll, saveToApi])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        el.addEventListener('keydown', handleKeyDown)
        el.focus()
        return () => el.removeEventListener('keydown', handleKeyDown)
    }, [handleKeyDown])

    if (loading) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="text-center flex flex-col items-center gap-2">
                    <Wordmark size={28} />
                    <span className="font-body font-normal text-[13px] leading-none text-on-surface-variant">Loading score…</span>
                </div>
            </div>
        )
    }

    if (error || !score) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="text-center flex flex-col items-center gap-4">
                    <Wordmark size={28} />
                    <p className="font-body font-normal text-[14px] leading-normal text-error m-0">{error ?? 'Score not found'}</p>
                    <SecondaryButton onClick={() => router.push('/scores')}>← Back to library</SecondaryButton>
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
            </header>
            <ControlBar
                accidental={activeNote?.pitch?.accidental}
                duration={activeNote?.duration.type}
                accidentalDisabled={activeNote?.isRest ?? true}
                onAccidentalChange={handleAccidentalChange}
                onDurationChange={handleDurationChange}
                dotted={(activeNote?.duration.dots ?? 0) > 0}
                onDotToggle={handleDotToggle}
                tie={activeNote?.tiesForward ?? false}
                onTieToggle={handleTieToggle}
                rest={activeNote?.isRest ?? false}
                onRestToggle={handleRestToggle}
                bpm={score.bpmAt(activeNote)}
                onTempoSet={handleTempoSet}
                tempoDisabled={!activeNote}
                playbackState={playbackState}
                onPlayToggle={handlePlayToggle}
                onStop={stopAll}
                recordingState={recordingState}
                onRecordToggle={() => void handleRecordToggle()}
                metronome={metronome}
                onMetronomeToggle={() => setMetronome((m) => !m)}
            />
            <div className="flex-1 overflow-y-auto min-h-0 px-8 py-6 bg-surface">
                <div className="mx-auto max-w-240 min-h-full bg-surface-container-lowest p-10 tonal-layer-glow">
                    <ScoreView
                        score={score}
                        layoutId={score.layout.id}
                        selectedNote={activeNote}
                        playbackCursorRef={playbackCursorRef}
                        recordingWaveformRef={recordingWaveformRef}
                        onNoteSelect={handleNoteSelect}
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
        </div>
    )
}
