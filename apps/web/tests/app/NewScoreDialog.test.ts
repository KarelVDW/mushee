import { Instrument, Score, TimeSignature } from '@mushee/notation/model'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ImportScoreDialog, ImportSummary } from '@/app/scores/ImportScoreDialog'
import { defaultScoreTitle, NewScoreDialog } from '@/app/scores/NewScoreDialog'
import { RenameScoreDialog } from '@/app/scores/RenameScoreDialog'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let unmount: (() => void) | undefined

afterEach(() => {
    unmount?.()
    unmount = undefined
    vi.useRealTimers()
})

function mount(element: React.ReactElement): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(element))
    unmount = () => {
        act(() => root.unmount())
        host.remove()
    }
    return host
}

/** The element, or a failed test naming what was missing. */
function required<T>(value: T | null | undefined, what: string): T {
    if (value == null) throw new Error(`missing ${what}`)
    return value
}

const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)
const pick = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="Pick ${name}"]`)
const titleField = () => required(document.querySelector<HTMLInputElement>('input:not([aria-label])'), 'title field')

function type(input: HTMLInputElement, text: string) {
    act(() => {
        Reflect.set(HTMLInputElement.prototype, 'value', text, input)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function pressEnter(input: HTMLInputElement) {
    act(() => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
}

function setPointer(fine: boolean) {
    window.matchMedia = ((query: string) => ({
        matches: query === '(pointer: fine)' ? fine : false,
    })) as unknown as typeof window.matchMedia
}

const newScore = (props: Partial<React.ComponentProps<typeof NewScoreDialog>> = {}) =>
    createElement(NewScoreDialog, {
        title: 'New score',
        subtitle: 'You can change both later.',
        initialInstrument: Instrument.VoiceLead,
        onCancel: () => {},
        onCreate: () => {},
        ...props,
    })

describe('defaultScoreTitle', () => {
    it('is warmer for the very first score', () => {
        expect(defaultScoreTitle(true)).toBe('My first melody')
        expect(defaultScoreTitle(false)).toBe('Untitled score')
    })
})

describe('NewScoreDialog', () => {
    it('creates with the placeholder when the title is left blank — Create is never disabled', () => {
        const onCreate = vi.fn()
        mount(newScore({ titlePlaceholder: 'My first melody', onCreate }))
        expect(titleField().placeholder).toBe('My first melody')
        expect(document.body.textContent).toContain('Optional')
        expect(document.body.textContent).not.toContain('rename it any time')
        const create = required(button('Create score'), 'Create score')
        expect(create.disabled).toBe(false)

        act(() => create.click())
        expect(onCreate).toHaveBeenLastCalledWith('My first melody', Instrument.VoiceLead)

        type(titleField(), '   ')
        pressEnter(titleField())
        expect(onCreate).toHaveBeenLastCalledWith('My first melody', Instrument.VoiceLead)

        type(titleField(), '  Evening tune ')
        pressEnter(titleField())
        expect(onCreate).toHaveBeenLastCalledWith('Evening tune', Instrument.VoiceLead)
    })

    it('defaults the placeholder to “Untitled score”, and creates with the picked instrument', () => {
        const onCreate = vi.fn()
        mount(newScore({ onCreate }))
        expect(titleField().placeholder).toBe('Untitled score')
        act(() => pick('Violin')?.click())
        act(() => button('Create score')?.click())
        expect(onCreate).toHaveBeenLastCalledWith('Untitled score', Instrument.Violin)
    })

    it('follows a default instrument that arrives after opening, until the user picks one', () => {
        const onCreate = vi.fn()
        let setDefault: (instrument: Instrument) => void = () => {}
        function Harness() {
            const [initial, setInitial] = useState<Instrument>(Instrument.VoiceLead)
            setDefault = setInitial
            return newScore({ initialInstrument: initial, onCreate })
        }
        mount(createElement(Harness))
        act(() => setDefault(Instrument.Guitar))
        expect(pick('Guitar')?.getAttribute('aria-pressed')).toBe('true')

        act(() => pick('Flute')?.click())
        act(() => setDefault(Instrument.Piano))
        expect(pick('Flute')?.getAttribute('aria-pressed')).toBe('true')
        act(() => button('Create score')?.click())
        expect(onCreate).toHaveBeenLastCalledWith('Untitled score', Instrument.Flute)
    })

    it('focuses the title on a mouse, but not on touch, where the keyboard would cover the picker', () => {
        vi.useFakeTimers()
        setPointer(true)
        mount(newScore())
        act(() => {
            vi.runAllTimers()
        })
        expect(document.activeElement).toBe(titleField())
        unmount?.()
        unmount = undefined

        setPointer(false)
        mount(newScore())
        act(() => {
            vi.runAllTimers()
        })
        expect(document.activeElement).not.toBe(titleField())
    })

    it('collapses the picker to one row on request, opening it with Change', () => {
        mount(newScore({ picker: 'collapsed', initialInstrument: Instrument.Violin }))
        expect(document.body.textContent).toContain('Instrument: Violin')
        expect(pick('Violin')).toBeNull()
        act(() => button('Change')?.click())
        expect(pick('Violin')?.getAttribute('aria-pressed')).toBe('true')
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Search instruments')
    })
})

describe('ImportSummary', () => {
    // Only the bar count and the first bar's meter matter here.
    const scoreIn = (bars: number, beatAmount: number, beatType: number) =>
        ({
            measures: Array.from({ length: bars }),
            firstMeasure: { timeSignature: new TimeSignature(beatAmount, beatType) },
        }) as unknown as Score

    it('says what it read in plain words, the meter counted in the beats a listener hears', () => {
        expect(new ImportSummary(scoreIn(2, 3, 4)).subtitle).toBe(
            'We read 2 bars in 3/4 — 3 beats in a bar — from your file. Check the title, then create the score.',
        )
        expect(new ImportSummary(scoreIn(1, 6, 8)).subtitle).toBe(
            'We read 1 bar in 6/8 — 2 swaying beats in a bar — from your file. Check the title, then create the score.',
        )
    })
})

describe('ImportScoreDialog', () => {
    it('lists what was simplified under a sentence-case heading, and opens collapsed on the file’s instrument', () => {
        const score = Score.blank(Instrument.Piano)
        mount(
            createElement(ImportScoreDialog, {
                imported: { score, title: 'Imported Air', warnings: ['Drums were left out.'] },
                onCancel: () => {},
                onCreate: () => {},
            }),
        )
        const notice = document.querySelector('[role="status"]')
        expect(notice?.getAttribute('aria-label')).toBe('A few things were simplified')
        expect(notice?.textContent).toContain('Drums were left out.')
        expect(document.body.textContent).toContain('Instrument: Piano')
        // An import carries no chord line, even on a chordal instrument.
        act(() => button('Change')?.click())
        expect(document.body.textContent).not.toContain('one note at a time')
    })

    it('rewrites the score for a newly picked instrument before creating it', () => {
        const score = Score.blank(Instrument.Piano)
        const onCreate = vi.fn()
        mount(
            createElement(ImportScoreDialog, {
                imported: { score, title: 'Imported Air', warnings: [] },
                onCancel: () => {},
                onCreate,
            }),
        )
        expect(document.querySelector('[role="status"]')).toBeNull()
        act(() => button('Change')?.click())
        act(() => pick('Trumpet')?.click())
        act(() => button('Create score')?.click())
        expect(onCreate).toHaveBeenCalledWith('Imported Air', score)
        expect(score.instrument).toBe(Instrument.Trumpet)
    })
})

describe('RenameScoreDialog', () => {
    const score = { id: 's1', title: 'Evening Air', createdAt: '', updatedAt: '' }

    it('renames to the trimmed new title', () => {
        const onRename = vi.fn()
        const onCancel = vi.fn()
        mount(createElement(RenameScoreDialog, { score, onRename, onCancel }))
        const field = required(document.querySelector<HTMLInputElement>('input'), 'title field')
        expect(field.value).toBe('Evening Air')
        type(field, '  Morning Air ')
        pressEnter(field)
        expect(onRename).toHaveBeenCalledWith('Morning Air')
        expect(onCancel).not.toHaveBeenCalled()
    })

    it('keeps the name for a blank or unchanged title', () => {
        const onRename = vi.fn()
        const onCancel = vi.fn()
        mount(createElement(RenameScoreDialog, { score, onRename, onCancel }))
        const field = required(document.querySelector<HTMLInputElement>('input'), 'title field')
        act(() => button('Rename')?.click())
        type(field, '   ')
        act(() => button('Rename')?.click())
        expect(onRename).not.toHaveBeenCalled()
        expect(onCancel).toHaveBeenCalledTimes(2)
    })
})
