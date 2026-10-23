import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dismissToast, showToast, Toaster, type ToastItem, ToastQueue, toasts, ToastStage } from '../src/Toast'

const render = () => renderToStaticMarkup(createElement(Toaster))
const messages = () => toasts.visible.map((t) => t.message)

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    toasts.clear()
    vi.useRealTimers()
})

describe('Toaster regions', () => {
    it('mounts both live regions while nothing is showing', () => {
        const html = render()
        expect(html).toContain('<div role="status" aria-live="polite"')
        expect(html).toContain('<div role="alert"')
        expect(html).not.toContain('Dismiss')
    })

    it('routes info toasts to the status region and errors to the alert region', () => {
        showToast('Link copied.', 'info')
        showToast('Microphone access was blocked.')
        const html = render()
        const status = html.slice(html.indexOf('role="status"'), html.indexOf('role="alert"'))
        const alert = html.slice(html.indexOf('role="alert"'))
        expect(status).toContain('Link copied.')
        expect(status).not.toContain('Microphone')
        expect(alert).toContain('Microphone access was blocked.')
    })

    it('draws an opaque card that rises in, never glass', () => {
        showToast('Saved.', 'info', 'check')
        const classes = card(render()).split(' ')
        expect(classes).toEqual(
            expect.arrayContaining([
                'bg-surface-container-lowest',
                'shadow-overlay',
                'rounded-lg',
                'animate-[toast-in_200ms_var(--ease-solkey)]',
            ]),
        )
        expect(classes.some((c) => c.includes('backdrop-blur') || c.includes('/85') || c === 'editorial-shadow')).toBe(false)
    })

    it('gives each tone its well: red for errors, cyan-soft for info, neutral for a notice', () => {
        showToast('Could not save.')
        showToast('Saved.', 'info', 'check')
        const html = render()
        expect(html).toContain(
            'w-7 h-7 rounded-full shrink-0 inline-flex items-center justify-center bg-error-container text-on-error-container',
        )
        expect(html).toContain('w-7 h-7 rounded-full shrink-0 inline-flex items-center justify-center bg-primary-soft text-on-primary-soft')
        expect(html).not.toContain('bg-primary-container text-on-primary-container')
        toasts.clear()
        showToast('The connection dropped.', 'notice', 'wifi-off')
        const notice = render()
        const status = notice.slice(notice.indexOf('role="status"'), notice.indexOf('role="alert"'))
        expect(status).toContain('bg-surface-container-high text-on-surface-variant')
        expect(status).toContain('The connection dropped.')
    })

    it('reads the --toast-bottom offset, never under the safe-area inset', () => {
        expect(render()).toContain('bottom-[max(var(--toast-bottom,1.5rem),env(safe-area-inset-bottom))]')
    })

    it('renders an action as a 40px button with its own accessible name', () => {
        showToast('Deleted 3 notes.', 'info', { action: { label: 'Undo', ariaLabel: 'Undo delete', onClick: () => {} } })
        const html = render()
        expect(html).toMatch(/<button type="button" aria-label="Undo delete" class="[^"]*h-10[^"]*text-primary[^"]*">Undo<\/button>/)
    })

    it('renders two actions as text buttons in order, before the dismiss ×', () => {
        showToast('Added bars 3–6.', 'info', {
            actions: [
                { label: 'Hear it back', onClick: () => {} },
                { label: 'Undo', ariaLabel: 'Undo this recording', onClick: () => {} },
            ],
        })
        const html = render()
        const hear = html.indexOf('>Hear it back</button>')
        const undo = html.indexOf('aria-label="Undo this recording"')
        expect(hear).toBeGreaterThan(-1)
        expect(undo).toBeGreaterThan(hear)
        expect(html.indexOf('aria-label="Dismiss"')).toBeGreaterThan(undo)
        // The unlabelled action carries no aria-label attribute at all.
        expect(html).toMatch(/<button type="button" class="[^"]*h-10[^"]*">Hear it back<\/button>/)
    })

    it('wraps a two-button toast below sm into two rows: icon, message and × first, the buttons under the message', () => {
        showToast('Added bars 3–6. Tap any note to fix it.', 'info', {
            actions: [
                { label: 'Hear it back', onClick: () => {} },
                { label: 'Undo', ariaLabel: 'Undo this recording', onClick: () => {} },
            ],
        })
        const html = render()
        expect(card(html).split(' ')).toEqual(
            expect.arrayContaining(['flex', 'max-sm:grid', 'max-sm:grid-cols-[1fr_auto]', 'max-sm:gap-y-1', 'sm:max-w-xl']),
        )
        expect(messageRow(html).split(' ')).toEqual(
            expect.arrayContaining(['min-w-0', 'flex-auto', 'max-sm:col-start-1', 'max-sm:row-start-1']),
        )
        // The group dissolves into the grid below sm: the buttons span the second row, their text
        // under the message's; the × keeps its DOM place after them and sits at the first row's end.
        expect(html).toMatch(
            /<span class="[^"]*ml-auto[^"]*max-sm:contents"><span class="[^"]*max-sm:col-span-2 max-sm:row-start-2 max-sm:justify-start max-sm:pl-7"><button[^>]*>Hear it back<\/button><button[^>]*>Undo<\/button><\/span><span class="inline-flex max-sm:row-start-1 max-sm:col-start-2 max-sm:self-start"><button[^>]*aria-label="Dismiss"/,
        )
    })

    it('keeps a one-button toast on one line, its message free to wrap between the icon and the button', () => {
        showToast('Deleted 3 notes.', 'info', { action: { label: 'Undo', ariaLabel: 'Undo delete', onClick: () => {} } })
        const html = render()
        expect(card(html)).not.toContain('grid')
        expect(html).not.toContain('max-sm:contents')
        expect(messageRow(html)).not.toContain('row-start')
        expect(html).toMatch(/<span class="min-w-0 wrap-break-word [^"]*">Deleted 3 notes\.<\/span>/)
    })
})

// Layout is measured in a browser; these pin the classes that shape it.
function card(html: string) {
    return html.match(/<div class="(flex items-center gap-3 max-w-full [^"]*)">/)?.[1] ?? ''
}
function messageRow(html: string) {
    return html.match(/<span class="([^"]*)"><span class="w-7 h-7/)?.[1] ?? ''
}

describe('ToastStage', () => {
    const item = (id: number, message = `Toast ${id}.`): ToastItem => ({ id, message, tone: 'info', actions: [] })

    it('keeps a removed toast in its place as a leaving ghost and adds new toasts at the end', () => {
        const a = item(1)
        const b = item(2)
        const c = item(3)
        const shown = ToastStage.next([], [a, b])
        expect(shown).toEqual([
            { toast: a, leaving: false },
            { toast: b, leaving: false },
        ])
        // The cap evicts the oldest as a third arrives: it stays, leaving, where it was.
        expect(ToastStage.next(shown, [b, c])).toEqual([
            { toast: a, leaving: true },
            { toast: b, leaving: false },
            { toast: c, leaving: false },
        ])
    })

    it('takes a refreshed toast’s latest content in place', () => {
        const shown = ToastStage.next([], [item(1, 'Moved.')])
        const refreshed = { ...item(1, 'Moved.'), icon: 'check' as const }
        expect(ToastStage.next(shown, [refreshed])).toEqual([{ toast: refreshed, leaving: false }])
    })

    it('drops a ghost once its exit has played, and only ghosts', () => {
        const staged = ToastStage.next(ToastStage.next([], [item(1), item(2)]), [item(2)])
        expect(ToastStage.drop(staged, 1)).toEqual([{ toast: item(2), leaving: false }])
        expect(ToastStage.drop(staged, 2)).toEqual(staged)
        expect(ToastStage.GHOST_MAX_MS).toBe(300)
    })

    it('leaves the queue itself untouched: a dismissed toast is gone at once', () => {
        const id = showToast('Link copied.', 'info')
        dismissToast(id)
        expect(messages()).toEqual([])
        // The first render after a removal has nothing to ghost from: it starts from the queue.
        expect(render()).not.toContain('Link copied.')
    })
})

describe('ToastQueue.actionsFor', () => {
    const a = { label: 'A', onClick: () => {} }
    const b = { label: 'B', onClick: () => {} }
    const c = { label: 'C', onClick: () => {} }

    it('treats action as the one-button shorthand and defaults to none', () => {
        expect(ToastQueue.actionsFor()).toEqual([])
        expect(ToastQueue.actionsFor({ action: a })).toEqual([a])
        expect(ToastQueue.actionsFor({ actions: [a, b] })).toEqual([a, b])
    })

    it('puts action first and keeps at most two buttons', () => {
        expect(ToastQueue.actionsFor({ action: c, actions: [a, b] })).toEqual([c, a])
        expect(ToastQueue.actionsFor({ actions: [a, b, c] })).toEqual([a, b])
    })
})

describe('toast actions', () => {
    it('keeps each action with its own handler, in order', () => {
        const ran: string[] = []
        showToast('Added bars 3–6.', 'info', {
            actions: [
                { label: 'Hear it back', onClick: () => ran.push('hear') },
                { label: 'Undo', onClick: () => ran.push('undo') },
            ],
        })
        expect(toasts.visible[0].actions.map((x) => x.label)).toEqual(['Hear it back', 'Undo'])
        toasts.visible[0].actions[1].onClick()
        expect(ran).toEqual(['undo'])
    })

    it('refreshing an identical toast takes the newer actions', () => {
        const first = { label: 'Undo', onClick: () => {} }
        const second = { label: 'Undo', onClick: () => {} }
        showToast('Moved 2 half steps higher.', 'info', { action: first })
        showToast('Moved 2 half steps higher.', 'info', { actions: [second] })
        expect(toasts.visible).toHaveLength(1)
        expect(toasts.visible[0].actions[0]).toBe(second)
    })
})

describe('ToastQueue.durationFor', () => {
    it('gives info and notices 6 s and errors max(8 s, 0.3 s per word)', () => {
        expect(ToastQueue.durationFor('Link copied.', 'info')).toBe(6000)
        expect(ToastQueue.durationFor('The connection dropped. Your take so far is saved.', 'notice')).toBe(6000)
        expect(ToastQueue.durationFor('Could not copy.', 'error')).toBe(8000)
        const thirtyWords = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ')
        expect(ToastQueue.durationFor(thirtyWords, 'error')).toBe(9000)
    })

    it('lets duration override and persist never expire', () => {
        expect(ToastQueue.durationFor('Saved.', 'info', { duration: 2000 })).toBe(2000)
        expect(ToastQueue.durationFor('Try recording again.', 'error', { persist: true })).toBeNull()
    })
})

describe('toast lifetime', () => {
    it('dismisses info after 6 s and errors after their reading time', () => {
        showToast('Link copied.', 'info')
        showToast('Could not save.')
        vi.advanceTimersByTime(6000)
        expect(messages()).toEqual(['Could not save.'])
        vi.advanceTimersByTime(2000)
        expect(messages()).toEqual([])
    })

    it('keeps a persistent toast until it is dismissed', () => {
        const id = showToast('Try recording again.', 'error', { persist: true })
        vi.advanceTimersByTime(60_000)
        expect(messages()).toEqual(['Try recording again.'])
        dismissToast(id)
        expect(messages()).toEqual([])
    })

    it('pauses while hovered or focused and resumes with the time that was left', () => {
        const id = showToast('Link copied.', 'info')
        vi.advanceTimersByTime(4000)
        toasts.pause(id, 'hover')
        toasts.pause(id, 'focus')
        vi.advanceTimersByTime(20_000)
        expect(messages()).toEqual(['Link copied.'])
        toasts.resume(id, 'hover')
        vi.advanceTimersByTime(20_000)
        expect(messages()).toEqual(['Link copied.'])
        toasts.resume(id, 'focus')
        vi.advanceTimersByTime(1999)
        expect(messages()).toEqual(['Link copied.'])
        vi.advanceTimersByTime(1)
        expect(messages()).toEqual([])
    })

    it('refreshes an identical toast with its new duration instead of stacking it', () => {
        const first = showToast('Could not save.')
        vi.advanceTimersByTime(7000)
        const again = showToast('Could not save.', 'error', { duration: 3000 })
        expect(again).toBe(first)
        expect(messages()).toEqual(['Could not save.'])
        vi.advanceTimersByTime(2999)
        expect(messages()).toEqual(['Could not save.'])
        vi.advanceTimersByTime(1)
        expect(messages()).toEqual([])
    })

    it('shows at most two toasts; a third replaces the oldest', () => {
        showToast('One.', 'info')
        showToast('Two.', 'info')
        showToast('Three.')
        expect(messages()).toEqual(['Two.', 'Three.'])
        vi.advanceTimersByTime(6000)
        expect(messages()).toEqual(['Three.'])
    })

    it('keeps the original glyph argument working', () => {
        showToast('Created “Scale Study”.', 'info', 'check')
        expect(toasts.visible[0].icon).toBe('check')
    })

    it('notifies subscribers and stops after unsubscribing', () => {
        const seen: string[][] = []
        const unsubscribe = toasts.subscribe((items) => seen.push(items.map((t) => t.message)))
        showToast('One.', 'info')
        unsubscribe()
        showToast('Two.', 'info')
        expect(seen).toEqual([['One.']])
    })

    it('ignores dismissing a toast that is already gone', () => {
        const id = showToast('One.', 'info')
        dismissToast(id)
        const seen: number[] = []
        toasts.subscribe((items) => seen.push(items.length))
        dismissToast(id)
        expect(seen).toEqual([])
    })
})
