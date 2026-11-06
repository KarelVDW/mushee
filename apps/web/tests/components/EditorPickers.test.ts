import { type ClefType, Instrument } from '@mushee/notation/model'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ClefPopover } from '@/components/editor/ClefPopover'
import { KeySignaturePopover } from '@/components/editor/KeySignaturePopover'
import { tapReadout } from '@/components/editor/TempoPopover'
import { TimeSignaturePopover } from '@/components/editor/TimeSignaturePopover'
import { transposeReadout } from '@/components/editor/TransposePopover'

const noop = () => {}

// Key and meter names (KeySignature.displayName, TimeSignature.plainName) are tested on the model.

describe('transposeReadout', () => {
    it('says the move in half steps, and where the whole score lands', () => {
        expect(transposeReadout(0, null)).toBe('No change yet')
        expect(transposeReadout(2, 'D major')).toBe('2 half steps higher — now in D major')
        expect(transposeReadout(-1, null)).toBe('1 half step lower')
        expect(transposeReadout(12, null)).toBe('12 half steps higher')
    })
})

describe('tapReadout', () => {
    it('asks for taps until a tempo emerges, then says where it came from', () => {
        expect(tapReadout(null, 1)).toBe('Tap at least twice')
        expect(tapReadout(104, 5)).toBe('104 bpm from 5 taps')
    })
})

describe('ClefPopover', () => {
    const render = (active: ClefType, instrument?: Instrument) =>
        renderToStaticMarkup(createElement(ClefPopover, { active, instrument, onSelect: noop, onDismiss: noop }))
    /** The first tier's clefs, in order: the labelled rows before 'More clefs'. */
    const firstTier = (markup: string) => [...markup.matchAll(/aria-label="Set ([^"]+) clef"/g)].map((match) => match[1])

    it('leads with Treble and Bass, explained, and keeps the rest behind More clefs', () => {
        const markup = render('treble')
        expect(markup).toContain('aria-label="Set Treble clef"')
        expect(markup).toContain('aria-label="Set Bass clef"')
        expect(markup).toContain('Higher voices and instruments')
        expect(markup).toContain('Treble for higher notes, bass for lower ones.')
        expect(markup).toContain('More clefs')
        expect(markup).not.toContain('Set Alto clef')
    })

    it('keeps the clef in use in view, listed once', () => {
        const markup = render('alto')
        expect(markup.match(/Set Alto clef/g)).toHaveLength(1)
    })

    it("offers the instrument's usual clef in the first tier: a viola's Alto, captioned", () => {
        const markup = render('treble', Instrument.Viola)
        expect(firstTier(markup)).toEqual(['Treble', 'Bass', 'Alto'])
        expect(markup).toContain('Usual for viola')
    })

    it('lists the usual clef and the clef in use once each, Treble and Bass first', () => {
        // A viola written in alto clef: Alto once, not twice.
        expect(firstTier(render('alto', Instrument.Viola))).toEqual(['Treble', 'Bass', 'Alto'])
        // A viola part switched to tenor clef keeps both in view.
        expect(firstTier(render('tenor', Instrument.Viola))).toEqual(['Treble', 'Bass', 'Alto', 'Tenor'])
        // A cello's usual clef is bass, already in the tier: nothing extra.
        expect(firstTier(render('treble', Instrument.Cello))).toEqual(['Treble', 'Bass'])
        expect(firstTier(render('bass', Instrument.Violin))).toEqual(['Treble', 'Bass'])
    })
})

describe('KeySignaturePopover', () => {
    const render = (active: number) => renderToStaticMarkup(createElement(KeySignaturePopover, { active, onSelect: noop, onDismiss: noop }))
    /** The markup's visible text: tags and attributes (names, titles) dropped. */
    const visibleText = (markup: string) => markup.replace(/<[^>]*>/g, ' ')

    it('names every key as before, drawing each name’s sharp or flat as notation', () => {
        const markup = render(0)
        for (const name of ['C♭', 'F', 'C', 'G', 'F♯', 'C♯']) expect(markup).toContain(`aria-label="${name} major"`)
        expect(visibleText(markup)).not.toMatch(/[♯♭]/)
    })

    it('makes C the wide tile with no sharps or flats, picked with a check', () => {
        const markup = render(0)
        expect(visibleText(markup)).toContain('no sharps or flats')
        expect(markup).toMatch(/aria-pressed="true" aria-label="C major"/)
        // Every other key sits on its faint five-line staff: 14 keys, 5 lines each, and C's empty one.
        expect(markup.match(/<line /g)).toHaveLength(15 * 5)
    })
})

describe('TimeSignaturePopover', () => {
    const render = (beatAmount: number, beatType: number) =>
        renderToStaticMarkup(createElement(TimeSignaturePopover, { active: { beatAmount, beatType }, onSelect: noop, onDismiss: noop }))

    it('offers the common meters first, as bare numerals', () => {
        const markup = render(4, 4)
        expect(markup).toContain('How many beats fit in each bar.')
        expect(markup).toContain('Set 6/8 time')
        expect(markup).not.toContain('swaying beats')
        expect(markup).toContain('More time signatures')
        expect(markup).not.toContain('Set 9/8 time')
    })

    it('opens with the rest shown when the score is in one of them', () => {
        const markup = render(9, 8)
        expect(markup).toContain('Set 9/8 time')
        expect(markup).not.toContain('More time signatures')
    })
})
