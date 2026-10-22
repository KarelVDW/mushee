import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AnnouncementClock, EditorAnnouncer } from '@/app/scores/[id]/EditorAnnouncer'
import { ScoreManipulator } from '@/app/scores/[id]/ScoreManipulator'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('AnnouncementClock', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('publishes a burst as its last line once it settles for 150ms', () => {
        const published: string[] = []
        const clock = new AnnouncementClock((text) => published.push(text))
        clock.say('Count-in')
        vi.advanceTimersByTime(100)
        clock.say('Recording')
        vi.advanceTimersByTime(149)
        expect(published).toEqual([])
        vi.advanceTimersByTime(1)
        expect(published).toEqual(['Recording'])
    })

    it('republishes the same line so it reads again, and cancels a pending one', () => {
        const published: string[] = []
        const clock = new AnnouncementClock((text) => published.push(text))
        clock.say('Recording')
        vi.advanceTimersByTime(150)
        clock.say('Recording')
        vi.advanceTimersByTime(150)
        expect(published).toEqual(['Recording', 'Recording' + String.fromCharCode(0xa0)])
        clock.say('Recording stopped.')
        clock.cancel()
        vi.advanceTimersByTime(500)
        expect(published).toHaveLength(2)
    })
})

describe('EditorAnnouncer', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        vi.useFakeTimers()
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.useRealTimers()
    })

    it("is one always-mounted polite region, not a status role, fed by the manipulator's announce()", () => {
        const manipulator = new ScoreManipulator()
        act(() => root.render(createElement(EditorAnnouncer, { manipulator })))
        const region = container.querySelector('[aria-live="polite"]')
        expect(region?.getAttribute('role')).toBeNull()
        expect(region?.className).toContain('sr-only')
        expect(region?.textContent).toBe('')

        act(() => {
            manipulator.announce('Count-in')
            vi.advanceTimersByTime(150)
        })
        expect(region?.textContent).toBe('Count-in')

        act(() => root.unmount())
        expect(manipulator.onAnnounce).toBeUndefined()
        root = createRoot(container)
    })
})
