'use client'

import { Instrument } from '@mushee/notation/model/Instrument'
import type { Score } from '@mushee/notation/model/Score'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Transport } from '@/lib/Transport'

export type SharedPlaybackState = 'stopped' | 'playing' | 'paused'

/**
 * Playback for a read-only score (the share page): the editor's Transport,
 * minus selection, recording and the metronome. Always starts from the top —
 * there is no selected note to start from — and pauses/resumes in place.
 */
export function useSharedPlayback(score: Score | null) {
    const transportRef = useRef<Transport | null>(null)
    const playbackCursorRef = useRef<SVGRectElement | null>(null)
    const [state, setState] = useState<SharedPlaybackState>('stopped')
    const [ready, setReady] = useState(false)

    useEffect(() => {
        const transport = new Transport()
        transportRef.current = transport
        return () => {
            transportRef.current = null
            transport.dispose()
        }
    }, [])

    // Samples for the score's instrument; a failed download plays degraded rather than never.
    useEffect(() => {
        if (!score) return
        const player = transportRef.current?.midiPlayer
        if (!player) return
        void player
            .loadInstruments([score.instrument, Instrument.Woodblock])
            .catch(() => {})
            .then(() => setReady(true))
    }, [score])

    const stop = useCallback(() => {
        transportRef.current?.stop()
        setState('stopped')
    }, [])

    const toggle = useCallback(() => {
        const transport = transportRef.current
        if (!transport || !score) return
        if (state === 'playing') {
            transport.pause()
            setState('paused')
            return
        }
        if (state === 'paused') {
            transport.resume()
            setState('playing')
            return
        }
        const cursorEl = playbackCursorRef.current
        if (!cursorEl) return
        transport.playScore({
            score,
            startNote: null,
            cursorEl,
            resolvePosition: (pos) => {
                const measure = score.measures[pos.measureIndex]
                const row = score.layout.rowFor(measure)
                return { x: row.getMeasureX(measure) + measure.layout.getXForBeat(pos.beat), rowY: score.layout.getYForRow(row) }
            },
            onFinish: () => setState('stopped'),
        })
        setState('playing')
    }, [score, state])

    return { playbackCursorRef, state, ready, toggle, stop }
}
