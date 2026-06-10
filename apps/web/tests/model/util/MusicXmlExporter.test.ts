import { describe, expect, it } from 'vitest'

import { Instrument } from '@/model/Instrument'
import { MusicXmlExporter } from '@/model/util/MusicXmlExporter'
import { makeScore, pitched } from '@test/helpers'

describe('MusicXmlExporter', () => {
    it('writes a standalone score-partwise document with header, part-list and measures', () => {
        const score = makeScore(2)
        const xml = new MusicXmlExporter(score).toXml('My Song')

        expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>')
        expect(xml).toContain('<!DOCTYPE score-partwise')
        expect(xml).toContain('<score-partwise version="4.0">')
        expect(xml).toContain('<work-title>My Song</work-title>')
        expect(xml).toContain('<score-part id="P1">')
        expect(xml).toContain('<part-name>Piano</part-name>')
        expect(xml).toContain('<midi-program>1</midi-program>')
        expect(xml).toContain('<measure number="1">')
        expect(xml).toContain('<measure number="2">')
        expect(xml).toContain('</score-partwise>')
    })

    it('writes pitches, rests, durations and first-measure attributes', () => {
        const score = makeScore(1)
        const first = score.firstMeasure!.firstNote!
        score.replace([first], [pitched('C', 4)])
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<divisions>12</divisions>')
        expect(xml).toContain('<sign>G</sign>')
        expect(xml).toContain('<beats>4</beats>')
        expect(xml).toContain('<beat-type>4</beat-type>')
        expect(xml).toContain('<step>C</step>')
        expect(xml).toContain('<octave>4</octave>')
        expect(xml).toContain('<rest/>')
        expect(xml).toContain('<duration>12</duration>')
        expect(xml).toContain('<type>quarter</type>')
    })

    it('writes tempo markings as a metronome direction with sound tempo', () => {
        const score = makeScore(1)
        score.setTempo(score.firstMeasure!.firstNote, 120)
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<per-minute>120</per-minute>')
        expect(xml).toContain('<sound tempo="120"/>')
    })

    it('writes ties as both <tie> and <notations><tied>', () => {
        const score = makeScore(1)
        const first = score.firstMeasure!.firstNote!
        const [tied] = score.replace([first], [pitched('D', 5)])
        score.replace([tied], [tied.clone({ tie: 'start' })])
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<tie type="start"/>')
        expect(xml).toContain('<tied type="start"/>')
    })

    it('writes a transpose block for transposing instruments', () => {
        const score = makeScore(1)
        score.setInstrument(Instrument.Trumpet)
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<diatonic>-1</diatonic>')
        expect(xml).toContain('<chromatic>-2</chromatic>')
    })

    it('escapes XML special characters in the title', () => {
        const score = makeScore(1)
        const xml = new MusicXmlExporter(score).toXml('Bach & Sons <No. 1>')

        expect(xml).toContain('<work-title>Bach &amp; Sons &lt;No. 1&gt;</work-title>')
    })
})
