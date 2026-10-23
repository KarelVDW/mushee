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
import { TOOLTIP_HOVER_DELAY_MS } from '@/components/ui/Tooltip'

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
    onplaying: (() => void) | null = null
    onpause: (() => void) | null = null
    currentTime = 0
    duration = Number.NaN
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
    /** Animation frames waiting to run, by id — the frame loop's whole state. */
    let frames: Map<number, FrameRequestCallback>

    beforeEach(() => {
        FakeAudio.instances = []
        showToast.mockClear()
        vi.stubGlobal('Audio', FakeAudio)
        frames = new Map()
        let nextFrame = 1
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            const id = nextFrame++
            frames.set(id, callback)
            return id
        })
        vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
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
        expect(labels()).toEqual(['Pause recording', 'Play recording'])

        await click(1)
        expect(labels()).toEqual(['Play recording', 'Pause recording'])
        expect(showToast).not.toHaveBeenCalled()
        // The replaced element is detached, so a late event can't touch the list.
        const [first] = FakeAudio.instances
        expect(first?.onerror).toBeNull()
        expect(first?.onended).toBeNull()
    })

    it('stopping the playing take is silent', async () => {
        await click(0)
        await click(0)
        expect(labels()).toEqual(['Play recording', 'Play recording'])
        expect(showToast).not.toHaveBeenCalled()
    })

    it('a real play failure on the current take resets the row and toasts', async () => {
        await click(0)
        await settle(() => FakeAudio.instances[0]?.failPlay('NotAllowedError'))
        expect(labels()).toEqual(['Play recording', 'Play recording'])
        expect(showToast).toHaveBeenCalledWith("This recording's audio couldn't be played.")
    })

    it('a load error on the current take resets the row and toasts', async () => {
        await click(1)
        await settle(() => FakeAudio.instances[0]?.onerror?.())
        expect(labels()).toEqual(['Play recording', 'Play recording'])
        expect(showToast).toHaveBeenCalledWith("This recording's audio couldn't be loaded.")
    })

    it('ending the current take resets its row', async () => {
        await click(0)
        await settle(() => FakeAudio.instances[0]?.onended?.())
        expect(labels()).toEqual(['Play recording', 'Play recording'])
    })

    /** Runs the frames now queued (each may queue the next). */
    const runFrame = () =>
        act(() => {
            const due = [...frames.values()]
            frames.clear()
            for (const callback of due) callback(0)
        })
    const row = (index: number) => container.querySelectorAll('li')[index]
    const progressLayer = (index: number) => row(index)?.querySelector<HTMLElement>('.origin-left') ?? null

    it("shows the replay's progress while it plays: a sweep behind the row and the clock '0:02 / 0:05'", async () => {
        await click(0)
        const audio = FakeAudio.instances[0]
        expect(audio).toBeDefined()
        if (!audio) return
        // Nothing heard yet: the row is the playing one, the clock at its start out of the take's
        // recorded length (the element doesn't know its duration yet), no frame loop yet.
        expect(row(0)?.textContent).toContain('0:00 / 0:12')
        expect(progressLayer(0)?.style.transform).toBe('scaleX(0)')
        expect(frames.size).toBe(0)

        audio.duration = 5
        await settle(() => audio.onplaying?.())
        expect(frames.size).toBe(1)
        audio.currentTime = 2
        runFrame()
        expect(progressLayer(0)?.style.transform).toBe('scaleX(0.4)')
        expect(progressLayer(0)?.getAttribute('aria-hidden')).toBe('true')
        // The clock counts out of the same length the sweep measures: the audio's own 5 seconds.
        expect(row(0)?.textContent).toContain('0:02 / 0:05')
        // Only the playing row sweeps.
        expect(progressLayer(1)).toBeNull()
        expect(row(1)?.textContent).not.toContain(' / ')
    })

    it('runs the frame loop only while the audio plays: a pause, the end, a stop and unmounting each cancel it', async () => {
        await click(0)
        const first = FakeAudio.instances[0]
        await settle(() => first?.onplaying?.())
        expect(frames.size).toBe(1)
        await settle(() => first?.onpause?.())
        expect(frames.size).toBe(0)

        await settle(() => first?.onplaying?.())
        await settle(() => first?.onended?.())
        expect(frames.size).toBe(0)
        expect(progressLayer(0)).toBeNull()
        expect(row(0)?.textContent).not.toContain(' / ')

        await click(1)
        await settle(() => FakeAudio.instances[1]?.onplaying?.())
        expect(frames.size).toBe(1)
        await click(1)
        expect(frames.size).toBe(0)

        await click(0)
        await settle(() => FakeAudio.instances[2]?.onplaying?.())
        expect(frames.size).toBe(1)
        act(() => root.unmount())
        expect(frames.size).toBe(0)
        // afterEach unmounts again: give it a fresh root.
        root = createRoot(container)
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

    it('leads each cross-score row with its number within its score, so two from the same minute differ', () => {
        const later = (id: string, scoreId: string, second: number): RecordingSummary => ({
            ...take(id),
            scoreId,
            startedAt: new Date(2026, 9, 22, 14, 3, second).toISOString(),
        })
        // Newest first, as the API lists them: two in score-1 made in the same minute, one elsewhere.
        const takes = [later('c', 'score-1', 40), later('b', 'score-2', 30), later('a', 'score-1', 10), take('z')]
        act(() => root.render(createElement(TakesList, { takes, scoreTitleFor: () => 'Shots scratch' })))
        const firstLines = [...container.querySelectorAll('li')].map((row) => row.querySelector('.text-pretty')?.textContent ?? '')
        expect(firstLines.map((line) => line.split(' · ')[0])).toEqual(['Recording 3', 'Recording 1', 'Recording 2', 'Recording 1'])
        expect(firstLines[0]).not.toBe(firstLines[2])
    })

    it('never ellipsizes the date that tells two takes apart: a narrow row breaks between number and date', () => {
        act(() => root.render(createElement(TakesList, { takes: [take('a')], scoreTitleFor: () => 'Scale Study' })))
        const title = container.querySelector('li .text-pretty')
        expect(title?.classList.contains('truncate')).toBe(false)
        const unbroken = [...(title?.querySelectorAll('.whitespace-nowrap') ?? [])].map((part) => part.textContent)
        expect(unbroken).toHaveLength(2)
        expect(unbroken[0]).toBe('Recording 1 ·')
        expect(title?.textContent).toBe(`Recording 1 · ${unbroken[1]}`)
    })

    it('keeps the score link out of the truncating date line, so its focus ring is never clipped', () => {
        act(() => root.render(createElement(TakesList, { takes: [take('a')], scoreTitleFor: () => 'Scale Study' })))
        const link = container.querySelector('a')
        // The link truncates its own name; no ancestor clips it (or its ring) with overflow.
        expect(link?.parentElement?.closest('.truncate')).toBeNull()
        expect(link?.querySelector('.truncate')?.textContent).toBe('Scale Study')
    })

    it("says 'recording' everywhere, never 'take' (the glossary), on the cross-score list too", () => {
        act(() => root.render(createElement(TakesList, { takes: [take('a')], scoreTitleFor: () => 'Scale Study' })))
        expect(container.querySelector('ul')?.getAttribute('aria-label')).toBe('Recordings')
        act(() => container.querySelector<HTMLButtonElement>('[aria-label="Delete recording"]')?.click())
        expect(rowText(0)).toContain('Delete this recording? Your notes stay.')
        expect(rowText(0)).not.toMatch(/\btake\b/i)
        const names = [...container.querySelectorAll('[aria-label], [title]')].map(
            (el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`,
        )
        expect(names.join(' ')).not.toMatch(/\btakes?\b/i)
    })

    it('keeps an audio-less row focusable and says why it cannot play, in the same words', () => {
        vi.stubGlobal('Audio', FakeAudio)
        FakeAudio.instances = []
        try {
            act(() => root.render(createElement(TakesList, { takes: [{ ...take('a'), hasAudio: false }] })))
            const play = container.querySelector<HTMLButtonElement>('[aria-label="Play recording"]')
            expect(play?.disabled).toBe(false)
            expect(play?.getAttribute('aria-disabled')).toBe('true')
            expect(play?.hasAttribute('title')).toBe(false)
            const description = play?.getAttribute('aria-describedby')
            expect(description && document.getElementById(description)?.textContent).toBe('No audio was kept for this recording')
            // Its click does nothing.
            act(() => play?.click())
            expect(FakeAudio.instances).toHaveLength(0)
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('names play and delete in a tooltip on hover', () => {
        vi.useFakeTimers()
        try {
            act(() => root.render(createElement(TakesList, { takes: [take('a')] })))
            /** What the portalled tooltip card says: <body>'s children other than the list's own host. */
            const tooltipText = () => [...document.body.children].filter((el) => el !== container).map((el) => el.textContent)
            for (const name of ['Play recording', 'Delete recording']) {
                const button = container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)
                act(() => {
                    button?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }))
                })
                act(() => {
                    vi.advanceTimersByTime(TOOLTIP_HOVER_DELAY_MS)
                })
                expect(tooltipText()).toContain(name)
                act(() => {
                    button?.dispatchEvent(
                        new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: document.body }),
                    )
                })
                expect(tooltipText()).not.toContain(name)
            }
        } finally {
            vi.useRealTimers()
        }
    })

    it('shows no score name on a per-score list', () => {
        act(() => root.render(createElement(TakesList, { takes: [take('a')] })))
        expect(container.querySelector('a')).toBeNull()
        expect(rowText(0)).not.toContain('·')
    })
})

describe('TakesList on a per-score panel', () => {
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

    const at = (id: string, minute: number, seconds: number): RecordingSummary => ({
        ...take(id),
        startedAt: new Date(2026, 9, 22, 12, minute).toISOString(),
        seconds,
    })
    const rows = () => [...container.querySelectorAll('li')]

    it('numbers the recordings oldest-first while listing them newest-first, length and date below', () => {
        const takes = [at('c', 43, 4), at('b', 42, 9), at('a', 10, 61)]
        act(() => root.render(createElement(TakesList, { takes, numbered: true })))
        expect(container.querySelector('ul')?.getAttribute('aria-label')).toBe('Recordings')
        expect(rows().map((row) => row.querySelector('.truncate')?.textContent)).toEqual(['Recording 3', 'Recording 2', 'Recording 1'])
        expect(rows()[2]?.textContent).toContain('1:01 · ')
        expect(rows()[0]?.querySelector('button')?.getAttribute('aria-label')).toBe('Play recording')
    })

    it('asks before deleting, says the notes stay, focuses Keep, and hands focus back to the bin', () => {
        act(() => root.render(createElement(TakesList, { takes: [at('a', 1, 4)], numbered: true })))
        const bin = () => container.querySelector<HTMLButtonElement>('[aria-label="Delete recording"]')
        act(() => bin()?.click())
        expect(rows()[0]?.textContent).toContain('Delete this recording? Your notes stay.')
        const keep = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Keep')
        expect(document.activeElement).toBe(keep)
        act(() => keep?.click())
        expect(rows()[0]?.textContent).not.toContain('Your notes stay')
        expect(document.activeElement).toBe(bin())
    })
})
