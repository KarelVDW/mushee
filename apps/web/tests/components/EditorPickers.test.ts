import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ClefPopover } from '@/components/editor/ClefPopover'
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
    const render = (active: Parameters<typeof ClefPopover>[0]['active']) =>
        renderToStaticMarkup(createElement(ClefPopover, { active, onSelect: noop, onDismiss: noop }))

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
})

describe('TimeSignaturePopover', () => {
    const render = (beatAmount: number, beatType: number) =>
        renderToStaticMarkup(createElement(TimeSignaturePopover, { active: { beatAmount, beatType }, onSelect: noop, onDismiss: noop }))

    it('offers the common meters first, captioned', () => {
        const markup = render(4, 4)
        expect(markup).toContain('How many beats fit in each bar.')
        expect(markup).toContain('2 swaying beats')
        expect(markup).toContain('More time signatures')
        expect(markup).not.toContain('Set 9/8 time')
    })

    it('opens with the rest shown when the score is in one of them', () => {
        const markup = render(9, 8)
        expect(markup).toContain('Set 9/8 time')
        expect(markup).not.toContain('More time signatures')
    })
})
