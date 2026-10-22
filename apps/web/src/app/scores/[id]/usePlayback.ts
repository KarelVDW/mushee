'use client'

import type { Note, Score } from '@mushee/notation/model'
import { useCallback, useEffect, useState } from 'react'

import { useTransport } from '@/lib/useTransport'

import type { ScoreManipulator } from './ScoreManipulator'

/**
 * Playback for the editor: the shared {@link useTransport} binding (with the metronome
 * click's samples), plus note preview on selection and the metronome toggle. `instrumentsReady`
 * gates the editor's initial render: the record button must not exist until the metronome
 * click is guaranteed audible. Exposes `stopAll` for anything (like recording) that must halt
 * playback first.
 */
export function usePlayback({
    score,
    activeNote,
    manipulator,
}: {
    score: Score | null
    activeNote: Note | null
    manipulator: ScoreManipulator
}) {
    const { transportRef, playbackCursorRef, state: playbackState, ready, toggle, stop: stopAll } = useTransport(score, { metronome: true })
    const [metronome, setMetronome] = useState(false)

    // Selecting a note stops any ongoing playback/recording and previews its pitch.
    // The Note holds written pitch; the instrument gives the pitch it sounds at.
    // Skipped while a range is selected, so dragging across notes doesn't chatter.
    // A cleared selection changes nothing — the recording flow deselects as it
    // starts, and stopping here would kill the take it is setting up.
    useEffect(() => {
        if (!activeNote) return
        stopAll()
        const transport = transportRef.current
        if (!activeNote.pitch || !transport || !score || manipulator.selectedNotes.length > 1) return
        transport.preview(score, activeNote)
    }, [activeNote, stopAll, score, manipulator])

    // Sync the metronome toggle to the transport. Recording is unaffected — a
    // take always keeps its click; the toggle only governs playback passes.
    useEffect(() => {
        transportRef.current?.setMetronomeEnabled(metronome)
    }, [metronome])

    // Launching from a stop begins at the selected note (falling back to the top of the
    // score when nothing is selected); pause/resume keep their place instead.
    const handlePlayToggle = useCallback(() => toggle(activeNote), [toggle, activeNote])
    const toggleMetronome = useCallback(() => setMetronome((on) => !on), [])

    return { transportRef, playbackCursorRef, playbackState, metronome, toggleMetronome, stopAll, handlePlayToggle, instrumentsReady: ready }
}
