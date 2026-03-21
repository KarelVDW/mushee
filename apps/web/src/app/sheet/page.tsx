'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { type DurationType, Score as ScoreView } from '@/components/notation'
import { Duration, type Note, Pitch } from '@/model'

import { ControlBar } from './ControlBar'
import { useScore } from './useScore'

export default function Sheet() {
    const score = useScore()
    const [activeNote, setActiveNote] = useState<Note | undefined>(() => score.firstMeasure?.firstNote ?? undefined)
    const containerRef = useRef<HTMLDivElement>(null)

    const handleNoteChange = useCallback(
        (note: Note, newPitch: Pitch) => {
            const newNote = note.clone({ pitch: newPitch })
            score.replace([note], [newNote])
            setActiveNote(newNote)
        },
        [score],
    )

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
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
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                if (activeNote) {
                    const newNote = activeNote.clone({ pitch: activeNote.pitch?.lowered() })
                    score.replace([activeNote], [newNote])
                    setActiveNote(newNote)
                }
            } else if (e.key === 'Backspace') {
                e.preventDefault()
                if (activeNote) {
                    const newNote = activeNote.clone({ pitch: undefined })
                    score.replace([activeNote], [newNote])
                    setActiveNote(newNote)
                }
            }
        },
        [activeNote],
    )

    const handleAccidentalChange = useCallback(
        (acc: string | undefined) => {
            if (!activeNote) return
            const newNote = activeNote.clone({ pitch: activeNote.pitch?.withAccidental(acc) })
            score.replace([activeNote], [newNote])
            setActiveNote(newNote)
        },
        [activeNote],
    )

    const handleDurationChange = useCallback(
        (newDuration: DurationType) => {
            if (!activeNote) return
            const newNote = activeNote.clone({ duration: new Duration({ type: newDuration }) })
            score.replace([activeNote], [newNote])
            setActiveNote(newNote)
        },
        [activeNote],
    )

    const handleTempoToggle = useCallback(() => {
        if (!activeNote) return
        const measure = activeNote.measure
        const beat = measure.beatOffsetOf(activeNote)
        const existing = measure.tempoAtBeat(beat)
        if (existing) {
            measure.removeTempo(beat)
        } else {
            measure.addTempo(beat, 120)
        }
        score.touch()
    }, [activeNote, score])

    const handleTempoChange = useCallback(
        (measureIndex: number, beatPosition: number, bpm: number) => {
            const measure = score.measures[measureIndex]
            if (!measure) return
            measure.setTempo(beatPosition, bpm)
        },
        [score],
    )

    const handleNoteSelect = useCallback(
        (note: Note) => setActiveNote(note),
        [score],
    )

    const handleAddMeasure = useCallback(() => {
        score.addMeasure().complete()
    }, [score])

    const handleRemoveMeasure = useCallback(() => {
        score.removeLastMeasure()
        // Clamp activeNote: if the note no longer exists, select the last note
        setActiveNote(score.lastMeasure?.lastNote || undefined)
    }, [score])

    useEffect(() => {
        const el = containerRef.current
        if (!el) return
        el.addEventListener('keydown', handleKeyDown)
        el.focus()
        return () => el.removeEventListener('keydown', handleKeyDown)
    }, [handleKeyDown])

    return (
        <div ref={containerRef} tabIndex={0} className="flex flex-col min-h-screen max-h-screen bg-gray-100 outline-none">
            <ControlBar
                accidental={activeNote?.pitch?.accidental}
                duration={activeNote?.duration.type}
                accidentalDisabled={activeNote?.isRest ?? true}
                onAccidentalChange={handleAccidentalChange}
                onDurationChange={handleDurationChange}
                tempo={activeNote ? activeNote.measure.tempoAtBeat(activeNote.measure.beatOffsetOf(activeNote)) : undefined}
                onTempoToggle={handleTempoToggle}
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
