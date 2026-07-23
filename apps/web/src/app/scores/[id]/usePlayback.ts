'use client'

import { Instrument, type Note, type Score } from '@mushee/notation/model'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Transport } from '@/lib/Transport'

import type { ScoreManipulator } from './ScoreManipulator'

/**
 * Playback/transport state for the editor: owns the Transport's lifecycle, the playback
 * cursor element, lazy instrument loading, note preview on selection, and the metronome
 * toggle. Exposes `stopAll` for anything (like recording) that must halt playback first.
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
    const transportRef = useRef<Transport | null>(null)
    const playbackCursorRef = useRef<SVGRectElement | null>(null)
    const [playbackState, setPlaybackState] = useState<'stopped' | 'playing' | 'paused'>('stopped')
    const [metronome, setMetronome] = useState(false)
    const [instrumentsReady, setInstrumentsReady] = useState(false)

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
    // `instrumentsReady` gates the editor's initial render: scheduling a note whose samples are
    // still downloading is a silent skip (smplr drops it), so the record button must not exist
    // until the metronome click is guaranteed audible. It flips once and stays true — a failed
    // download plays degraded rather than bricking the editor, and swapping instruments
    // mid-session must not flash the page back to its loading screen.
    useEffect(() => {
        if (!score) return
        const player = transportRef.current?.midiPlayer
        if (!player) return
        void player
            .loadInstruments([score.instrument, Instrument.Woodblock])
            .catch(() => {})
            .then(() => setInstrumentsReady(true))
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

    return { transportRef, playbackCursorRef, playbackState, metronome, setMetronome, stopAll, handlePlayToggle, instrumentsReady }
}
