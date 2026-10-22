'use client'

import type { Note, Score } from '@mushee/notation/model'
import { useCallback, useEffect, useRef, useState } from 'react'

import { type PlaybackState, Transport } from './Transport'

/**
 * The React binding of one {@link Transport}, shared by the editor and the share page: owns
 * the transport's lifecycle, its sample loading, the playback cursor element and the
 * play/pause/resume toggle. The playback state mirrors the transport's own mode (through
 * {@link Transport.onModeChange}), so a pass that plays out, or a stop from anywhere, can't
 * leave the play button showing something else; a recording take reads as 'stopped', since
 * recording has its own control. `metronome: false` skips the click's samples, for a page
 * that never clicks. `transportRef` is exposed for the recording flow, which drives the same
 * transport.
 */
export function useTransport(score: Score | null, { metronome }: { metronome: boolean }) {
    const transportRef = useRef<Transport | null>(null)
    const playbackCursorRef = useRef<SVGRectElement | null>(null)
    const [state, setState] = useState<PlaybackState>('stopped')
    const [ready, setReady] = useState(false)

    useEffect(() => {
        const transport = new Transport()
        transport.onModeChange = (mode) => setState(mode === 'recording' ? 'stopped' : mode)
        transportRef.current = transport
        return () => {
            transportRef.current = null
            transport.onModeChange = undefined
            transport.dispose()
        }
    }, [])

    // Lazy-load only the samples the score needs (its own instrument, plus the metronome click
    // unless the page never clicks). Re-runs when the score's instrument changes — the editor's
    // picker mutates `score.instrument` in place, but its re-render re-evaluates
    // `score?.instrument.id`. `ready` gates playback: scheduling a note whose samples are still
    // downloading is a silent skip. It flips once and stays true — a failed download plays
    // degraded rather than never, and swapping instruments mid-session must not flash the
    // editor back to its loading screen.
    useEffect(() => {
        if (!score) return
        const transport = transportRef.current
        if (!transport) return
        void transport
            .prepare(score.instrument, { metronome })
            .catch(() => {})
            .then(() => setReady(true))
    }, [score, score?.instrument.id, metronome])

    const stop = useCallback(() => transportRef.current?.stop(), [])

    /**
     * Pause a running pass, resume a paused one, or — from a stop — play from `startNote`
     * (null = the top of the score).
     */
    const toggle = useCallback(
        (startNote: Note | null) => {
            const transport = transportRef.current
            if (!transport || !score) return
            if (transport.mode === 'playing') return transport.pause()
            if (transport.mode === 'paused') return transport.resume()
            const cursorEl = playbackCursorRef.current
            if (!cursorEl) return
            transport.playScore({ score, startNote, cursorEl })
        },
        [score],
    )

    return { transportRef, playbackCursorRef, state, ready, toggle, stop }
}
