'use client'

import { useEffect, useState } from 'react'

import { EvalPlayer, type EvalPlayerMode } from './playback/EvalPlayer'

/**
 * One EvalPlayer per mounted page, disposed (mic + audio context) on leave.
 * The instance lives in state and the effect only wires and disposes it, so
 * StrictMode's simulated unmount disposes a player that stays reusable (the
 * audio context and samples come back lazily) instead of orphaning a second
 * one the real unmount never reaches.
 */
export function useEvalPlayer(): { player: EvalPlayer; mode: EvalPlayerMode } {
    const [player] = useState(() => new EvalPlayer())
    const [mode, setMode] = useState<EvalPlayerMode>('idle')

    useEffect(() => {
        player.onModeChange = setMode
        return () => player.dispose()
    }, [player])

    return { player, mode }
}
