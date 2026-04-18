'use client'

import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { type DurationType, Score as ScoreView } from '@/components/notation'
import type { ScorePartwise } from '@/components/notation/types'
import { loadScore, updateScore } from '@/lib/api'
import { CursorManager } from '@/lib/CursorManager'
import { Metronome } from '@/lib/Metronome'
import { MidiPlayer } from '@/lib/MidiPlayer'
import { ScoreScheduler } from '@/lib/ScoreScheduler'
import { Ticker } from '@/lib/Ticker'
import { Duration, type Note, Pitch, Score } from '@/model'
import { ScoreDeserializer } from '@/model/util/ScoreDeserializer'

import { ControlBar } from './ControlBar'

export default function ScoreEditorPage() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    const [score, setScore] = useState<Score | null>(null)
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
    const playbackCursorRef = useRef<SVGRectElement | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [metronome, setMetronome] = useState(false)

    useEffect(() => {
        async function load() {
            try {
                const data = await loadScore(id)
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
                const body: { title?: string; measures?: Record<string, unknown>; allMeasures?: unknown[] } = {}
                if (changes.title !== undefined) body.title = changes.title
                if (changes.score) {
                    const dirty = changes.score.flushDirty()
                    if (dirty?.measures) body.measures = dirty.measures
                    if (dirty?.allMeasures) body.allMeasures = dirty.allMeasures
                }
                if (body.title !== undefined || body.measures || body.allMeasures) void updateScore(id, body)
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
        const [newNote] = score.replace([activeNote], [activeNote.clone({
            duration: new Duration({ type: activeNote.duration.type, dots: newDots, ratio: activeNote.duration.ratio }),
        })])
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

    const handleTempoToggle = useCallback(() => {
        if (!activeNote || !score) return
        const measure = activeNote.measure
        const beat = measure.beatOffsetOf(activeNote)
        const existing = measure.tempoAtBeat(beat)
        if (existing) {
            measure.removeTempo(beat)
        } else {
            measure.addTempo(beat, 120)
        }
        saveToApi({ score })
    }, [activeNote, score, saveToApi])

    const handleTempoChange = useCallback(
        (measureIndex: number, beatPosition: number, bpm: number) => {
            if (!score) return
            const measure = score.measures[measureIndex]
            if (!measure) return
            measure.setTempo(beatPosition, bpm)
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
        const cursor = new CursorManager(scheduler)
        const ticker = new Ticker(midiPlayer)

        ticker.addTickable(scheduler)
        ticker.addTickable(met)
        ticker.addTickable(cursor)

        midiPlayerRef.current = midiPlayer
        tickerRef.current = ticker
        schedulerRef.current = scheduler
        metronomeRef.current = met
        cursorRef.current = cursor

        midiPlayer.loadSamples().catch(() => {
            // Samples failed to load — will fall back to oscillator synthesis
        })
        return () => {
            ticker.stop()
            midiPlayer.stopPreview()
        }
    }, [])

    // Preview the selected note's pitch
    useEffect(() => {
        const midi = activeNote?.pitch?.toMidi()
        const player = midiPlayerRef.current
        if (midi === undefined || !player) return
        player.preview(midi, 0.75)
    }, [activeNote])

    // Sync metronome toggle so it takes effect mid-playback
    useEffect(() => {
        if (metronomeRef.current && tickerRef.current) {
            if (metronome) tickerRef.current.addTickable(metronomeRef.current)
            else tickerRef.current.removeTickable(metronomeRef.current)
        }
    }, [metronome])

    const handlePlayToggle = useCallback(() => {
        if (!score) return
        const ticker = tickerRef.current
        const scheduler = schedulerRef.current
        const met = metronomeRef.current
        const cursor = cursorRef.current
        if (!ticker || !scheduler || !met || !cursor) return

        if (ticker.isPlaying) {
            ticker.stop()
            setIsPlaying(false)
        } else {
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

            ticker.play(() => {
                setIsPlaying(false)
            })
            setIsPlaying(true)
        }
    }, [score])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        el.addEventListener('keydown', handleKeyDown)
        el.focus()
        return () => el.removeEventListener('keydown', handleKeyDown)
    }, [handleKeyDown])

    if (loading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-100">
                <p className="text-gray-500">Loading score...</p>
            </div>
        )
    }

    if (error || !score) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-100">
                <div className="text-center">
                    <p className="text-red-600">{error ?? 'Score not found'}</p>
                    <button type="button" onClick={() => router.push('/scores')} className="mt-4 text-sm text-blue-600 hover:underline">
                        Back to scores
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div ref={containerRef} tabIndex={0} className="flex flex-col min-h-screen max-h-screen bg-gray-100 outline-none">
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
                tempo={activeNote ? activeNote.measure.tempoAtBeat(activeNote.measure.beatOffsetOf(activeNote)) : undefined}
                onTempoToggle={handleTempoToggle}
                isPlaying={isPlaying}
                onPlayToggle={handlePlayToggle}
                metronome={metronome}
                onMetronomeToggle={() => setMetronome((m) => !m)}
                onBack={() => router.push('/scores')}
            />
            <div className="flex-1 overflow-y-auto min-h-full px-8">
                <div className="mx-auto max-w-4xl min-h-full bg-white shadow p-6">
                    <ScoreView
                        score={score}
                        layoutId={score.layout.id}
                        selectedNote={activeNote}
                        playbackCursorRef={playbackCursorRef}
                        onNoteSelect={handleNoteSelect}
                        onNoteChange={handleNoteChange}
                        onAddMeasure={handleAddMeasure}
                        onRemoveMeasure={handleRemoveMeasure}
                        canRemoveMeasure={score.measures.length > 1}
                        onTempoChange={handleTempoChange}
                    />
                </div>
            </div>
        </div>
    )
}
