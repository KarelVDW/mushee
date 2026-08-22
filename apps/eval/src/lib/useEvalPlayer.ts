'use client'

import { useEffect, useRef, useState } from 'react'

import { EvalPlayer, type EvalPlayerMode } from './playback/EvalPlayer'

/** One EvalPlayer per mounted page, disposed (mic + audio context) on leave. */
export function useEvalPlayer(): { player: EvalPlayer; mode: EvalPlayerMode } {
    const playerRef = useRef<EvalPlayer | null>(null)
    const [mode, setMode] = useState<EvalPlayerMode>('idle')
    if (!playerRef.current) playerRef.current = new EvalPlayer()
    playerRef.current.onModeChange = setMode

    useEffect(() => {
        const player = playerRef.current
        return () => {
            player?.dispose()
            playerRef.current = null
        }
    }, [])

    return { player: playerRef.current, mode }
}
