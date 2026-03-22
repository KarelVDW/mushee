'use client'

import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { type DurationType, Score as ScoreView } from '@/components/notation'
import type { ScorePartwise } from '@/components/notation/types'
import { loadScore, updateScore } from '@/lib/api'
import { Duration, type Note, Pitch, Score } from '@/model'

import { ControlBar } from './ControlBar'

export default function ScoreEditorPage() {
    const { id } = useParams<{ id: string }>()
    const router = useRouter()
    const [score, setScore] = useState<Score | null>(null)
    const [, setUpdatedAt] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [activeNote, setActiveNote] = useState<Note | undefined>()
    const containerRef = useRef<HTMLDivElement>(null)
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    useEffect(() => {
        async function load() {
            try {
                const data = await loadScore(id)
                const s = Score.fromInput(data as unknown as ScorePartwise, () => setUpdatedAt(s.touchedAt))
                setScore(s)
                setActiveNote(s.firstMeasure?.firstNote ?? undefined)
            } catch {
                setError('Failed to load score')
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [id])

    const saveToApi = useCallback((changes: { title?: string; score?: Score }) => {
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
    }, [id])

    const handleNoteChange = useCallback(
        (note: Note, newPitch: Pitch) => {
            if (!score) return
            const newNote = note.clone({ pitch: newPitch })
            score.replace([note], [newNote])
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
                    const newNote = activeNote.clone({ pitch: activeNote.pitch?.raised() })
                    score.replace([activeNote], [newNote])
                    setActiveNote(newNote)
                    saveToApi({ score })
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (activeNote) {
                    const newNote = activeNote.clone({ pitch: activeNote.pitch?.lowered() })
                    score.replace([activeNote], [newNote])
                    setActiveNote(newNote)
                    saveToApi({ score })
                }
            } else if (e.key === 'Backspace') {
                e.preventDefault()
                if (activeNote) {
                    const newNote = activeNote.clone({ pitch: undefined })
                    score.replace([activeNote], [newNote])
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
            const newNote = activeNote.clone({ pitch: activeNote.pitch?.withAccidental(acc) })
            score.replace([activeNote], [newNote])
            setActiveNote(newNote)
            saveToApi({ score })
        },
        [activeNote, score, saveToApi],
    )

    const handleDurationChange = useCallback(
        (newDuration: DurationType) => {
            if (!activeNote || !score) return
            const newNote = activeNote.clone({ duration: new Duration({ type: newDuration }) })
            score.replace([activeNote], [newNote])
            setActiveNote(newNote)
            saveToApi({ score })
        },
        [activeNote, score, saveToApi],
    )

    const handleDotToggle = useCallback(() => {
        if (!activeNote || !score) return
        const newDots = activeNote.duration.dots > 0 ? 0 : 1
        const newNote = activeNote.clone({ duration: new Duration({ type: activeNote.duration.type, dots: newDots, ratio: activeNote.duration.ratio }) })
        score.replace([activeNote], [newNote])
        setActiveNote(newNote)
        saveToApi({ score })
    }, [activeNote, score, saveToApi])

    const handleTieToggle = useCallback(() => {
        if (!activeNote || !score) return
        const newTie = activeNote.tiesForward ? undefined : 'start' as const
        const newNote = activeNote.clone({ tie: newTie })
        score.replace([activeNote], [newNote])
        setActiveNote(newNote)
        saveToApi({ score })
    }, [activeNote, score, saveToApi])

    const handleRestToggle = useCallback(() => {
        if (!activeNote || !score) return
        const newPitch = activeNote.isRest ? new Pitch({ name: 'B', octave: 4 }) : undefined
        const newNote = activeNote.clone({ pitch: newPitch })
        score.replace([activeNote], [newNote])
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
        score.touch()
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

    const handleNoteSelect = useCallback(
        (note: Note) => setActiveNote(note),
        [],
    )

    const handleAddMeasure = useCallback(() => {
        if (!score) return
        score.addMeasure().complete()
        saveToApi({ score })
    }, [score, saveToApi])

    const handleRemoveMeasure = useCallback(() => {
        if (!score) return
        score.removeLastMeasure()
        setActiveNote(score.lastMeasure?.lastNote || undefined)
        saveToApi({ score })
    }, [score, saveToApi])

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
                    <button
                        type="button"
                        onClick={() => router.push('/scores')}
                        className="mt-4 text-sm text-blue-600 hover:underline"
                    >
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
                onBack={() => router.push('/scores')}
            />
            <div className="flex-1 overflow-y-auto min-h-full px-8">
                <div className="mx-auto max-w-4xl min-h-full bg-white shadow p-6">
                    <ScoreView
                        score={score}
                        selectedNoteId={activeNote?.id}
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
