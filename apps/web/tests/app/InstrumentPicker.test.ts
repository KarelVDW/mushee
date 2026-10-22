import { Instrument } from '@mushee/notation/model'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InstrumentChordHint, InstrumentPicker, PopularInstrumentTiles } from '@/app/scores/InstrumentPicker'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let unmount: (() => void) | undefined

afterEach(() => {
    unmount?.()
    unmount = undefined
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

type PickerProps = Omit<React.ComponentProps<typeof InstrumentPicker>, 'value' | 'onChange'>

/** The picker with its value held in state, as the dialogs hold it. */
function renderPicker(initial: Instrument, props: PickerProps = {}, onChange = vi.fn()): HTMLElement {
    function Harness() {
        const [value, setValue] = useState(initial)
        return createElement(InstrumentPicker, {
            ...props,
            value,
            onChange: (instrument: Instrument) => {
                onChange(instrument)
                setValue(instrument)
            },
        })
    }
    return mount(createElement(Harness))
}

/** The element, or a failed test naming what was missing. */
function required<T>(value: T | null | undefined, what: string): T {
    if (value == null) throw new Error(`missing ${what}`)
    return value
}

const pickButtons = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Pick "]')]
const pickNames = (host: HTMLElement) => pickButtons(host).map((b) => b.getAttribute('aria-label'))
const pick = (host: HTMLElement, name: string) => {
    const button = pickButtons(host).find((b) => b.getAttribute('aria-label') === `Pick ${name}`)
    if (!button) throw new Error(`no 'Pick ${name}' button`)
    return button
}
const allInstruments = (host: HTMLElement) => [...host.querySelectorAll('button')].find((b) => b.textContent === 'All instruments')
const search = (host: HTMLElement) =>
    required(host.querySelector<HTMLInputElement>('input[aria-label="Search instruments"]'), 'search field')

function type(input: HTMLInputElement, text: string) {
    act(() => {
        Reflect.set(HTMLInputElement.prototype, 'value', text, input)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

const CHORD_LINE = 'play the tune one note at a time — Solkey writes melodies.'

describe('InstrumentPicker', () => {
    it('labels the choice in plain words, with what it does', () => {
        const host = renderPicker(Instrument.VoiceLead)
        const group = host.querySelector('[role="group"][aria-labelledby]')
        expect(document.getElementById(group?.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('What will you sing or play?')
        expect(host.textContent).toContain('Sets the playback sound and helps Solkey listen. You can change it later.')
        expect(host.textContent).toContain('Instrument · Voice')
        // The search field has a real name, not just a placeholder.
        expect(search(host).placeholder).toBe('Filter instruments…')
    })

    it('leads with the popular eight as tiles, the voice with its plain subline', () => {
        const host = renderPicker(Instrument.VoiceLead)
        expect(pickNames(host)).toEqual(Instrument.popular().map((i) => `Pick ${i.displayName}`))
        const voice = pick(host, 'Voice')
        expect(voice.getAttribute('aria-pressed')).toBe('true')
        expect(document.getElementById(voice.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Sing, hum or whistle')
        expect(allInstruments(host)?.getAttribute('aria-expanded')).toBe('false')
    })

    it('keeps every other instrument behind All instruments, each name once', () => {
        const host = renderPicker(Instrument.Piano)
        act(() => allInstruments(host)?.click())
        expect(allInstruments(host)?.getAttribute('aria-expanded')).toBe('true')
        const names = pickNames(host)
        expect(names).toContain('Pick Cello')
        expect(new Set(names).size).toBe(names.length)
        expect(names).toHaveLength(Instrument.pickable().length)
        // Duplicates and section patches stay out.
        expect(names).not.toContain('Pick Violoncello')
        expect(names).not.toContain('Pick Brass')
        // …and the families follow the singer-first order, without the popular-only Voice family.
        const families = [...host.querySelectorAll('span')].map((s) => s.textContent).filter((t) => t === 'Strings' || t === 'Brass')
        expect(families).toEqual(['Strings', 'Brass'])

        act(() => allInstruments(host)?.click())
        expect(pickNames(host)).not.toContain('Pick Cello')
    })

    it('opens the full list for a current instrument that is not popular', () => {
        const host = renderPicker(Instrument.Cello)
        expect(allInstruments(host)?.getAttribute('aria-expanded')).toBe('true')
        expect(pick(host, 'Cello').getAttribute('aria-pressed')).toBe('true')
    })

    it('opens the list when a later value is not popular (a default that resolves after opening)', () => {
        const onChange = vi.fn()
        function Harness() {
            const [value, setValue] = useState<Instrument>(Instrument.VoiceLead)
            return createElement('div', null, [
                createElement('button', { key: 'late', type: 'button', onClick: () => setValue(Instrument.Cello) }, 'late default'),
                createElement(InstrumentPicker, { key: 'picker', value, onChange }),
            ])
        }
        const host = mount(createElement(Harness))
        expect(allInstruments(host)?.getAttribute('aria-expanded')).toBe('false')
        act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === 'late default')?.click())
        expect(allInstruments(host)?.getAttribute('aria-expanded')).toBe('true')
        expect(pick(host, 'Cello').getAttribute('aria-pressed')).toBe('true')
    })

    it('still shows, selected, a hidden duplicate the score already carries', () => {
        const host = renderPicker(Instrument.Violoncello)
        expect(pick(host, 'Violoncello').getAttribute('aria-pressed')).toBe('true')
        // Picking another one keeps it on offer, so the choice can be undone.
        act(() => pick(host, 'Cello').click())
        expect(pick(host, 'Violoncello').getAttribute('aria-pressed')).toBe('false')
    })

    it('searches every pickable instrument, popular ones included, by current or old name', () => {
        const onChange = vi.fn()
        const host = renderPicker(Instrument.Piano, {}, onChange)
        type(search(host), 'cel')
        expect(pickNames(host)).toEqual(['Pick Cello'])
        // While searching, the tiles and the All instruments toggle make way for the results.
        expect(allInstruments(host)).toBeUndefined()

        type(search(host), 'voice lead')
        expect(pickNames(host)).toEqual(['Pick Voice'])
        act(() => pick(host, 'Voice').click())
        expect(onChange).toHaveBeenCalledWith(Instrument.VoiceLead)

        type(search(host), 'kazoo')
        expect(pickNames(host)).toEqual([])
        expect(host.textContent).toContain('No instruments match “kazoo”')
    })

    it('says, once, that Solkey writes melodies when a chordal instrument is picked', () => {
        const host = renderPicker(Instrument.VoiceLead)
        expect(host.textContent).not.toContain(CHORD_LINE)
        act(() => pick(host, 'Piano').click())
        expect(host.textContent).toContain(`On piano, ${CHORD_LINE}`)
        expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe(`On piano, ${CHORD_LINE}`)
        act(() => pick(host, 'Guitar').click())
        expect(host.textContent).toContain(`On guitar, ${CHORD_LINE}`)
        act(() => pick(host, 'Violin').click())
        expect(host.textContent).not.toContain(CHORD_LINE)
    })

    it('leaves the chord line out where the caller turns it off (imports), and the eyebrow on request', () => {
        const host = renderPicker(Instrument.Piano, { chordHint: false, showCurrentEyebrow: false })
        expect(host.textContent).not.toContain(CHORD_LINE)
        expect(host.querySelector('[aria-live]')).toBeNull()
        expect(host.textContent).not.toContain('Instrument · Piano')
    })

    it('can focus its search field on mount', () => {
        const host = renderPicker(Instrument.VoiceLead, { autoFocusSearch: true })
        expect(document.activeElement).toBe(search(host))
    })
})

describe('PopularInstrumentTiles', () => {
    it('toggles each tile on its own in multiple mode', () => {
        const onChange = vi.fn()
        const host = mount(createElement(PopularInstrumentTiles, { multiple: true, value: [Instrument.Piano], onChange }))
        expect(pick(host, 'Piano').getAttribute('aria-pressed')).toBe('true')
        expect(pick(host, 'Guitar').getAttribute('aria-pressed')).toBe('false')
        act(() => pick(host, 'Guitar').click())
        expect(onChange).toHaveBeenLastCalledWith([Instrument.Piano, Instrument.Guitar])
        act(() => pick(host, 'Piano').click())
        expect(onChange).toHaveBeenLastCalledWith([])
    })

    it('shows the tiles it is given', () => {
        const host = mount(
            createElement(PopularInstrumentTiles, { instruments: [Instrument.Flute], value: Instrument.Flute, onChange: () => {} }),
        )
        expect(pickNames(host)).toEqual(['Pick Flute'])
    })
})

describe('InstrumentChordHint', () => {
    it('names the instrument in lower case', () => {
        const host = mount(createElement(InstrumentChordHint, { instrument: Instrument.Harmonica }))
        expect(host.textContent).toBe(`On harmonica, ${CHORD_LINE}`)
    })
})
