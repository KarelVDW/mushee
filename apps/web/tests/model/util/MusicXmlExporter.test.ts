import { makeScore, pitched } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import { Duration } from '@/model/Duration'
import { Instrument } from '@/model/Instrument'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { MusicXmlExporter } from '@/model/util/MusicXmlExporter'

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
        const first = score.firstMeasure?.firstNote
        if (!first) throw new Error('expected first note')
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
        score.setTempo(score.firstMeasure?.firstNote, 120)
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<per-minute>120</per-minute>')
        expect(xml).toContain('<sound tempo="120"/>')
    })

    it('writes ties as both <tie> and <notations><tied>', () => {
        const score = makeScore(1)
        const first = score.firstMeasure?.firstNote
        if (!first) throw new Error('expected first note')
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

    it('writes an <alter> for an accidental-bearing pitch', () => {
        const score = makeScore(1)
        const sharp = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'F', octave: 4, alter: 1, accidental: '#' }) })
        const first = score.firstMeasure?.firstNote
        if (!first) throw new Error('expected first note')
        score.replace([first], [sharp])
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<step>F</step>')
        expect(xml).toContain('<alter>1</alter>')
    })

    it('writes a <time-modification> block for tuplet notes', () => {
        const score = makeScore(1)
        const triplet = () =>
            new Note({ duration: new Duration({ type: '8', ratio: { actualNotes: 3, normalNotes: 2 } }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const first = score.firstMeasure?.firstNote
        if (!first) throw new Error('expected first note')
        score.replace([first], [triplet(), triplet(), triplet()])
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<time-modification>')
        expect(xml).toContain('<actual-notes>3</actual-notes>')
        expect(xml).toContain('<normal-notes>2</normal-notes>')
    })

    it('writes a <key> block with fifths and mode for a key signature', () => {
        const score = makeScore(1)
        score.setKeySignature(score.firstMeasure?.firstNote, -3, 'minor')
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<key>')
        expect(xml).toContain('<fifths>-3</fifths>')
        expect(xml).toContain('<mode>minor</mode>')
    })

    it('writes a <clef-octave-change> for an octave-transposing clef', () => {
        const score = makeScore(1)
        score.setClef(score.firstMeasure?.firstNote, 'treble8va')
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<sign>G</sign>')
        expect(xml).toContain('<line>2</line>')
        expect(xml).toContain('<clef-octave-change>1</clef-octave-change>')
    })

    it('writes a right barline with a bar-style for a non-single end barline', () => {
        const score = makeScore(1)
        const measure = score.firstMeasure
        if (!measure) throw new Error('expected first measure')
        measure.setEndBarline('end')
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<barline location="right">')
        expect(xml).toContain('<bar-style>light-heavy</bar-style>')
    })

    it('writes a <dot> for each augmentation dot of a dotted note', () => {
        const score = makeScore(1)
        const dotted = new Note({ duration: new Duration({ type: 'h', dots: 1 }), pitch: new Pitch({ name: 'G', octave: 4 }) })
        const first = score.firstMeasure?.firstNote
        if (!first) throw new Error('expected first note')
        score.replace([first], [dotted])
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<type>half</type>')
        expect(xml).toContain('<dot/>')
    })

    it('omits <mode> for a key signature without a mode', () => {
        const score = makeScore(1)
        score.setKeySignature(score.firstMeasure?.firstNote, 2) // D major-ish, no explicit mode
        const xml = new MusicXmlExporter(score).toXml('Test')

        expect(xml).toContain('<fifths>2</fifths>')
        expect(xml).not.toContain('<mode>')
    })

    it('writes a key-only attributes block (no time/clef) for a mid-score key change', () => {
        const score = makeScore(2)
        // Key change at the start of measure 2: clef and time carry forward unchanged, so the
        // attributes block holds only divisions + key — exercising the empty time/clef fallbacks.
        score.setKeySignature(score.measures[1].firstNote, 3)
        const xml = new MusicXmlExporter(score).toXml('Test')

        const measureTwo = xml.slice(xml.indexOf('<measure number="2">'))
        expect(measureTwo).toContain('<key>')
        expect(measureTwo).toContain('<fifths>3</fifths>')
        // No time or clef re-emitted in the second measure's attributes.
        expect(measureTwo.slice(0, measureTwo.indexOf('</attributes>'))).not.toContain('<time>')
        expect(measureTwo.slice(0, measureTwo.indexOf('</attributes>'))).not.toContain('<clef>')
    })
})
