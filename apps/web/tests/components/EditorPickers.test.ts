import { TimeSignature } from '@mushee/notation/model'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ClefPopover } from '@/components/editor/ClefPopover'
import { KeyName } from '@/components/editor/KeySignaturePopover'
import { tapReadout } from '@/components/editor/TempoPopover'
import { MeterWords, TimeSignaturePopover } from '@/components/editor/TimeSignaturePopover'
import { transposeReadout } from '@/components/editor/TransposePopover'

const noop = () => {}

describe('KeyName', () => {
    it('names major keys by their tonic', () => {
        expect(new KeyName(0).long).toBe('C major')
        expect(new KeyName(2).long).toBe('D major')
        expect(new KeyName(-3).long).toBe('E♭ major')
        expect(new KeyName(6).long).toBe('F♯ major')
    })

    it('names a minor key by its own tonic, three fifths up', () => {
        expect(new KeyName(0, 'minor').long).toBe('A minor')
        expect(new KeyName(-3, 'minor').long).toBe('C minor')
        expect(new KeyName(5, 'minor').long).toBe('G♯ minor')
        expect(new KeyName(-7, 'minor').long).toBe('A♭ minor')
        expect(KeyName.of({ fifths: 2, mode: 'major' }).isMinor).toBe(false)
    })

    it('gives both readings of a signature', () => {
        expect(new KeyName(2).readings).toBe('D major · B minor')
    })
})

describe('MeterWords', () => {
    const words = (a: number, b: number) => new MeterWords(new TimeSignature(a, b))

    it('counts the beats the metronome clicks, with how they feel', () => {
        expect(words(4, 4).beats).toBe('4 beats')
        expect(words(3, 4).beats).toBe('3 beats')
        expect(words(6, 8).beats).toBe('2 swaying beats')
        expect(words(9, 8).beats).toBe('3 swaying beats')
        expect(words(12, 8).beats).toBe('4 swaying beats')
        expect(words(2, 2).beats).toBe('2 long beats')
        // 3/8 is simple: three quick eighths, as the count-in clicks it.
        expect(words(3, 8).beats).toBe('3 quick beats')
        expect(words(7, 8).beats).toBe('7 quick beats')
    })

    it('says one beat in the singular, and reads per bar', () => {
        expect(words(1, 4).beats).toBe('1 beat')
        expect(words(4, 4).perBar).toBe('4 beats in a bar')
    })
})

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
