import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TransportMode } from '@/lib/Transport'
import { useTransport } from '@/lib/useTransport'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A Transport double: the hook only wires onModeChange and disposes it; the test plays the
// transport's side by firing mode changes on the instance the hook created.
const { instances } = vi.hoisted(() => ({ instances: [] as Array<{ onModeChange?: (mode: TransportMode) => void }> }))
vi.mock('@/lib/Transport', () => ({
    Transport: class {
        onModeChange?: (mode: TransportMode) => void
        constructor() {
            instances.push(this)
        }
        prepare() {
            return Promise.resolve()
        }
        dispose() {}
    },
}))

describe('useTransport', () => {
    let container: HTMLElement
    let root: Root
    let playback: ReturnType<typeof useTransport>

    function Harness() {
        playback = useTransport(null, { metronome: false })
        return null
    }

    beforeEach(() => {
        instances.length = 0
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => root.render(createElement(Harness)))
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const fire = (mode: TransportMode) => act(() => instances[0].onModeChange?.(mode))

    it('mirrors the transport mode as the playback state', () => {
        expect(playback.state).toBe('stopped')
        fire('playing')
        expect(playback.state).toBe('playing')
        fire('paused')
        expect(playback.state).toBe('paused')
        fire('stopped')
        expect(playback.state).toBe('stopped')
    })

    it('reads a recording take as stopped, since recording has its own control', () => {
        fire('playing')
        fire('recording')
        expect(playback.state).toBe('stopped')
    })
})
