import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RecordingSummary } from '@/lib/api'

const { showToast, mutate } = vi.hoisted(() => ({ showToast: vi.fn(), mutate: vi.fn() }))

vi.mock('@mushee/ui', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@mushee/ui')>()),
    showToast,
    Toaster: () => null,
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('@/lib/queries', () => ({ useDeleteRecording: () => ({ isPending: false, mutate }) }))

import { TakesList } from '@/components/TakesList'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Stand-in for HTMLAudioElement with a controllable `play()` promise. Like a
 * real element, pausing while `play()` is pending rejects it with AbortError.
 */
class FakeAudio {
    static instances: FakeAudio[] = []
    onended: (() => void) | null = null
    onerror: (() => void) | null = null
    private rejectPlay: ((err: unknown) => void) | null = null

    constructor(readonly src: string) {
        FakeAudio.instances.push(this)
    }

    play(): Promise<void> {
        return new Promise((_resolve, reject) => {
            this.rejectPlay = reject
        })
    }

    pause() {
        this.failPlay('AbortError')
    }

    failPlay(name: string) {
        this.rejectPlay?.(new DOMException('play failed', name))
        this.rejectPlay = null
    }
}

const take = (id: string): RecordingSummary => ({
    id,
    scoreId: 'score-1',
    startedAt: new Date(2026, 9, 22, 14, 2).toISOString(),
    endedAt: null,
    seconds: 12,
    hasAudio: true,
})

describe('TakesList playback', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        FakeAudio.instances = []
        showToast.mockClear()
        vi.stubGlobal('Audio', FakeAudio)
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        act(() => root.render(createElement(TakesList, { takes: [take('a'), take('b')] })))
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        vi.unstubAllGlobals()
    })

    const rowButton = (row: number) => container.querySelectorAll('li')[row]?.querySelector<HTMLButtonElement>('button')
    const labels = () => [0, 1].map((row) => rowButton(row)?.getAttribute('aria-label'))
    /** Runs `fn` inside act and lets the play() rejections it triggers settle. */
    const settle = async (fn: () => void) => {
        await act(async () => {
            fn()
            await Promise.resolve()
        })
    }
    const click = (row: number) => settle(() => rowButton(row)?.click())

    it('switching takes keeps the new row playing despite the old AbortError', async () => {
        await click(0)
        expect(labels()).toEqual(['Pause take', 'Play take'])

        await click(1)
        expect(labels()).toEqual(['Play take', 'Pause take'])
        expect(showToast).not.toHaveBeenCalled()
        // The replaced element is detached, so a late event can't touch the list.
        const [first] = FakeAudio.instances
        expect(first?.onerror).toBeNull()
        expect(first?.onended).toBeNull()
    })

    it('stopping the playing take is silent', async () => {
        await click(0)
        await click(0)
        expect(labels()).toEqual(['Play take', 'Play take'])
        expect(showToast).not.toHaveBeenCalled()
    })

    it('a real play failure on the current take resets the row and toasts', async () => {
        await click(0)
        await settle(() => FakeAudio.instances[0]?.failPlay('NotAllowedError'))
        expect(labels()).toEqual(['Play take', 'Play take'])
        expect(showToast).toHaveBeenCalledWith("This take's audio couldn't be played.")
    })

    it('a load error on the current take resets the row and toasts', async () => {
        await click(1)
        await settle(() => FakeAudio.instances[0]?.onerror?.())
        expect(labels()).toEqual(['Play take', 'Play take'])
        expect(showToast).toHaveBeenCalledWith("This take's audio couldn't be loaded.")
    })

    it('ending the current take resets its row', async () => {
        await click(0)
        await settle(() => FakeAudio.instances[0]?.onended?.())
        expect(labels()).toEqual(['Play take', 'Play take'])
    })
})

describe('TakesList score names', () => {
    let container: HTMLElement
    let root: Root

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const orphan: RecordingSummary = { ...take('c'), scoreId: 'gone' }
    const rowText = (row: number) => container.querySelectorAll('li')[row]?.textContent

    it('links each row to its score on a cross-score list, and names a gone one in plain text', () => {
        const titles = new Map([['score-1', 'Scale Study']])
        act(() =>
            root.render(createElement(TakesList, { takes: [take('a'), orphan], scoreTitleFor: (t) => titles.get(t.scoreId) ?? null })),
        )
        const links = [...container.querySelectorAll('a')]
        expect(links).toHaveLength(1)
        expect(links[0]?.textContent).toBe('Scale Study')
        expect(links[0]?.getAttribute('href')).toBe('/scores/score-1')
        expect(rowText(0)).toContain(' · Scale Study')
        expect(rowText(1)).toContain(' · Deleted score')
        expect(container.querySelectorAll('li')[1]?.querySelector('a')).toBeNull()
    })

    it('keeps the score link out of the truncating date line, so its focus ring is never clipped', () => {
        act(() => root.render(createElement(TakesList, { takes: [take('a')], scoreTitleFor: () => 'Scale Study' })))
        const link = container.querySelector('a')
        // The link truncates its own name; no ancestor clips it (or its ring) with overflow.
        expect(link?.parentElement?.closest('.truncate')).toBeNull()
        expect(link?.querySelector('.truncate')?.textContent).toBe('Scale Study')
    })

    it('shows no score name on a per-score list', () => {
        act(() => root.render(createElement(TakesList, { takes: [take('a')] })))
        expect(container.querySelector('a')).toBeNull()
        expect(rowText(0)).not.toContain('·')
    })
})
