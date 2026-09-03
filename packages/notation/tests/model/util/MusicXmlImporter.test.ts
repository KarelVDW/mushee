import { Instrument } from '@mushee/notation/model/Instrument'
import type { Note } from '@mushee/notation/model/Note'
import type { Score } from '@mushee/notation/model/Score'
import { MusicXmlImporter } from '@mushee/notation/model/util/MusicXmlImporter'
import { describe, expect, it } from 'vitest'

const PART_LIST = '<part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>'
const ATTRIBUTES = '<attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'

/** A partwise document around the given measures (each `measure(...)` string), with a header. */
function doc(measures: string, { partList = PART_LIST, header = '' } = {}): string {
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">${header}${partList}<part id="P1">${measures}</part></score-partwise>`
}

function measure(entries: string, attributes = ATTRIBUTES): string {
    return `<measure number="1">${attributes}${entries}</measure>`
}

/** A note in 12-divisions-per-quarter space. */
function note(step: string, octave: number, type: string, duration: number, extra = ''): string {
    return `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>${type}</type>${extra}</note>`
}

function rest(type: string, duration: number, extra = ''): string {
    return `<note><rest/><duration>${duration}</duration><type>${type}</type>${extra}</note>`
}

const QUARTER_REST = rest('quarter', 12)

function describeNotes(notes: readonly Note[]): string[] {
    return notes.map((n) => {
        const value = `${n.duration.type}${'.'.repeat(n.duration.dots)}${n.inTuplet ? `(${n.duration.ratio.actualNotes}:${n.duration.ratio.normalNotes})` : ''}`
        const pitch = n.pitch ? `${n.pitch.name}${n.pitch.accidental ?? ''}${n.pitch.octave}` : 'r'
        return `${pitch}:${value}${n.tie ? `~${n.tie}` : ''}`
    })
}

function load(xml: string) {
    return new MusicXmlImporter(xml).toScore()
}

function measureNotes(score: Score, index = 0): string[] {
    return describeNotes(score.measures[index].notes)
}

describe('MusicXmlImporter', () => {
    describe('header', () => {
        it('reads the title, instrument, key, time, clef, tempo and barline of a simple part', () => {
            const xml = doc(
                measure(
                    `<direction placement="above"><direction-type><words>Allegro</words></direction-type><sound tempo="100"/></direction>` +
                        note('C', 4, 'quarter', 12) +
                        QUARTER_REST +
                        note('D', 4, 'half', 24) +
                        '<barline location="right"><bar-style>light-heavy</bar-style></barline>',
                    '<attributes><divisions>12</divisions><key><fifths>1</fifths><mode>major</mode></key>' +
                        '<time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>',
                ),
                {
                    header: '<work><work-title>Air</work-title></work>',
                    partList:
                        '<part-list><score-part id="P1"><part-name>Clarinet in B♭</part-name>' +
                        '<score-instrument id="P1-I1"><instrument-name>Clarinet</instrument-name></score-instrument>' +
                        '<midi-instrument id="P1-I1"><midi-program>72</midi-program></midi-instrument></score-part></part-list>',
                },
            )
            const { score, title, warnings } = load(xml)

            expect(title).toBe('Air')
            expect(warnings).toEqual([])
            expect(score.instrument).toBe(Instrument.Clarinet)
            expect(score.measures).toHaveLength(1)
            const m = score.measures[0]
            expect(m.keySignature.fifths).toBe(1)
            expect(m.keySignature.mode).toBe('major')
            expect(m.timeSignature.beatAmount).toBe(4)
            expect(m.clef.type).toBe('treble')
            expect(m.tempoAtBeat(0)?.bpm).toBe(100)
            expect(m.endBarline).toBe('end')
            expect(measureNotes(score)).toEqual(['C4:q', 'r:q', 'D4:h'])
        })

        it('falls back to the movement title and, without a part-list, to the first part in the body', () => {
            const bare = `<score-partwise><movement-title>  Untitled Dance </movement-title><part id="X"><measure>${ATTRIBUTES}${QUARTER_REST}</measure></part></score-partwise>`
            const { score, title } = load(bare)
            expect(title).toBe('Untitled Dance')
            expect(score.instrument).toBe(Instrument.Piano)
            expect(measureNotes(score)).toEqual(['r:q', 'r:q', 'r:q', 'r:q'])
            expect(load(doc(measure(QUARTER_REST))).title).toBeUndefined()
        })

        it('resolves the instrument by name when the MIDI program is missing or out of range', () => {
            const violin =
                '<part-list><score-part id="P1"><part-name>Violin</part-name><midi-instrument id="P1-I1"><midi-program>200</midi-program></midi-instrument></score-part></part-list>'
            expect(load(doc(measure(QUARTER_REST), { partList: violin })).score.instrument).toBe(Instrument.Violin)
        })

        it('imports only the first part and says so', () => {
            const two =
                '<part-list><score-part id="P1"><part-name>Oboe</part-name></score-part><score-part id="P2"><part-name>Bass</part-name></score-part></part-list>'
            const xml = `<score-partwise>${two}<part id="P1"><measure>${ATTRIBUTES}${note('A', 4, 'whole', 48)}</measure></part><part id="P2"><measure>${ATTRIBUTES}${note('C', 2, 'whole', 48)}</measure></part></score-partwise>`
            const { score, warnings } = load(xml)
            expect(measureNotes(score)).toEqual(['A4:w'])
            expect(score.instrument).toBe(Instrument.Oboe)
            expect(warnings).toEqual(['Only the first part (“Oboe”) was imported; 1 other part was left out.'])

            const three = two.replace('</part-list>', '<score-part id="P3"><part-name>Drums</part-name></score-part></part-list>')
            expect(load(xml.replace(two, three)).warnings[0]).toContain('2 other parts were left out')
        })

        it('reads timewise documents too, padding measures our part does not appear in', () => {
            const xml =
                `<score-timewise>${PART_LIST}` +
                `<measure number="1"><part id="P1">${ATTRIBUTES}${note('E', 4, 'whole', 48)}</part></measure>` +
                `<measure number="2"><part id="P2">${QUARTER_REST}</part></measure>` +
                '</score-timewise>'
            const { score } = load(xml)
            expect(measureNotes(score, 0)).toEqual(['E4:w'])
            expect(measureNotes(score, 1)).toEqual(['r:q', 'r:q', 'r:q', 'r:q'])
        })

        it('finds the part id of a timewise document without a part-list', () => {
            const xml = `<score-timewise><measure><part id="Q">${ATTRIBUTES}${note('E', 4, 'whole', 48)}</part></measure></score-timewise>`
            expect(measureNotes(load(xml).score)).toEqual(['E4:w'])
            expect(load('<score-timewise><measure/></score-timewise>').score.measures).toHaveLength(1)
            expect(() => load('<score-timewise/>')).toThrow('no measures')
        })

        it('rejects files that are not well-formed XML, not MusicXML, or have no measures', () => {
            expect(() => load('<score-partwise><part></score-partwise>')).toThrow('not well-formed XML')
            expect(() => load('<svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow('not a MusicXML score')
            expect(() => load(doc(''))).toThrow('no measures')
            expect(() => load(`<score-partwise>${PART_LIST}<part id="P9"><measure/></part></score-partwise>`)).toThrow('no measures')
        })
    })

    describe('attributes', () => {
        it('clamps the key, sums additive meters, resolves clefs and ignores what it cannot use', () => {
            const attributes =
                '<attributes><divisions>0</divisions><key><fifths>9</fifths></key><time><beats>3+2</beats><beat-type>8</beat-type></time>' +
                '<clef number="2"><sign>G</sign></clef><clef number="1"><sign>F</sign><line>4</line></clef></attributes>'
            const { score } = load(doc(measure(`<note><rest/><duration>2</duration><type>eighth</type></note>`, attributes)))
            const m = score.measures[0]
            expect(m.keySignature.fifths).toBe(7)
            expect(m.timeSignature.beatAmount).toBe(5)
            expect(m.timeSignature.beatType).toBe(8)
            expect(m.clef.type).toBe('bass')
            // divisions stayed at the default of 1: the eighth rest's declared value (2 quarters) is inconsistent and rewritten.
            expect(measureNotes(score)).toEqual(['r:h', 'r:8'])
        })

        it('keeps octave clefs, skips senza-misura, malformed meters, keys and clefs without a sign', () => {
            const attributes =
                '<attributes><divisions>12</divisions><key><mode>minor</mode></key><time><senza-misura/></time><clef><sign>G</sign><clef-octave-change>-1</clef-octave-change></clef></attributes>'
            const { score } = load(doc(measure(QUARTER_REST, attributes)))
            expect(score.measures[0].clef.type).toBe('treble8vb')
            expect(score.measures[0].keySignature.fifths).toBe(0)
            expect(score.measures[0].timeSignature.beatAmount).toBe(4)

            const bad = '<attributes><time><beats>x</beats><beat-type>4</beat-type></time><clef><line>2</line></clef></attributes>'
            expect(load(doc(measure(QUARTER_REST, bad))).score.measures[0].timeSignature.maxBeats).toBe(4)
            const noBeatType = '<attributes><time><beats>3</beats></time></attributes>'
            expect(load(doc(measure(QUARTER_REST, noBeatType))).score.measures[0].timeSignature.maxBeats).toBe(4)
            const noBeats = '<attributes><time><beat-type>4</beat-type></time></attributes>'
            expect(load(doc(measure(QUARTER_REST, noBeats))).score.measures[0].timeSignature.maxBeats).toBe(4)
        })

        it('carries clef, key and time changes across measures and mid-measure', () => {
            const xml = doc(
                measure(
                    note('C', 4, 'whole', 48),
                    '<attributes><divisions>12</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>',
                ) +
                    measure(
                        note('C', 4, 'half', 24) +
                            '<attributes><clef><sign>F</sign></clef><key><fifths>-2</fifths></key></attributes>' +
                            note('C', 3, 'half', 24),
                        '<attributes><key><fifths>2</fifths></key></attributes>',
                    ),
            )
            const { score } = load(xml)
            const second = score.measures[1]
            expect(second.keySignature.fifths).toBe(2)
            expect(second.midMeasureClefs.map((c) => [c.beatPosition, c.type])).toEqual([[2, 'bass']])
            expect(second.midMeasureKeySignatures.map((k) => [k.beatPosition, k.fifths])).toEqual([[2, -2]])
        })
    })

    describe('tempo', () => {
        it('converts metronome marks to quarter-note bpm, prefers <sound tempo>, and clamps', () => {
            const half =
                '<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome></direction-type></direction>'
            const dotted =
                '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>60</per-minute></metronome></direction-type></direction>'
            const words =
                '<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>ca. 120</per-minute></metronome></direction-type></direction>'
            const noUnit = '<direction><direction-type><metronome><per-minute>120</per-minute></metronome></direction-type></direction>'
            const sound = '<sound tempo="9999"/>'
            const xml = doc(
                measure(half + QUARTER_REST + dotted + QUARTER_REST + words + noUnit + QUARTER_REST + sound + QUARTER_REST) +
                    measure('<direction><direction-type><words>rit.</words></direction-type></direction>' + note('C', 4, 'whole', 48)),
            )
            const { score } = load(xml)
            expect(score.measures[0].tempos.map((t) => [t.beatPosition, t.bpm])).toEqual([
                [0, 120],
                [1, 90],
                [3, 500],
            ])
            expect(score.measures[1].tempos).toEqual([])
        })
    })

    describe('notes', () => {
        it('keeps ties, dots and tuplets that agree with their durations', () => {
            const triplet = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
            const xml = doc(
                measure(
                    note('C', 4, 'quarter', 18, '<dot/><tie type="start"/>') +
                        note('C', 4, 'eighth', 6, '<tie type="stop"/><tie type="start"/>') +
                        note('C', 4, 'quarter', 12, '<notations><tied type="stop"/></notations>') +
                        note('E', 4, 'eighth', 4, triplet) +
                        note('F', 4, 'eighth', 4, triplet) +
                        note('G', 4, 'eighth', 4, triplet),
                ),
            )
            const { score, warnings } = load(xml)
            expect(warnings).toEqual([])
            expect(measureNotes(score)).toEqual(['C4:q.~start', 'C4:8~start-stop', 'C4:q~stop', 'E4:8(3:2)', 'F4:8(3:2)', 'G4:8(3:2)'])
        })

        it('rewrites values it cannot express with the metrical speller, tying the pieces', () => {
            const xml = doc(
                measure(
                    // No <type>: 2.5 beats from the start of the bar → half + eighth, tied.
                    `<note><pitch><step>A</step><octave>4</octave></pitch><duration>30</duration><tie type="stop"/></note>` +
                        // Type disagrees with the duration (a "quarter" lasting a dotted eighth).
                        note('B', 4, 'quarter', 9) +
                        // A 32nd is too short to write.
                        note('C', 5, '32nd', 1) +
                        // A rest without a type is spelled, never tied.
                        '<note><rest/><duration>8</duration></note>',
                ),
            )
            const { score, warnings } = load(xml)
            expect(measureNotes(score)).toEqual(['A4:h~start-stop', 'A4:8~stop', 'B4:8.', 'r:16', 'r:8'])
            expect(warnings).toEqual([
                'Some note values were rewritten with the nearest supported ones.',
                'Notes shorter than a sixteenth were left out.',
            ])
        })

        it('rewrites inconsistent tuplet notes inside their ratio', () => {
            const triplet = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
            const xml = doc(
                measure(note('E', 4, 'quarter', 4, triplet) + note('F', 4, 'eighth', 4, triplet) + note('G', 4, 'eighth', 4, triplet)),
            )
            // (The bar is short, so as an opening bar it is padded in front, pickup-style.)
            expect(measureNotes(load(xml).score)).toEqual(['r:q', 'r:q', 'r:q', 'E4:8(3:2)', 'F4:8(3:2)', 'G4:8(3:2)'])
            // A malformed ratio is ignored: the eighth then simply matches its plain duration.
            const broken = '<time-modification><actual-notes>0</actual-notes><normal-notes>2</normal-notes></time-modification>'
            expect(measureNotes(load(doc(measure(note('E', 4, 'eighth', 6, broken)))).score).at(-1)).toBe('E4:8')
        })

        it('reduces chords to their top note, whichever order the chord lists them in', () => {
            const xml = doc(
                measure(
                    note('C', 4, 'quarter', 12) +
                        note('G', 4, 'quarter', 12, '<chord/>') +
                        note('E', 4, 'quarter', 12, '<chord/>') +
                        note('G', 5, 'quarter', 12) +
                        note('C', 5, 'quarter', 12, '<chord/>') +
                        // A chord "note" on a rest and a chord note with a rest body are odd but must not crash.
                        QUARTER_REST +
                        note('B', 3, 'quarter', 12, '<chord/>') +
                        `<note><chord/><rest/><duration>12</duration><type>quarter</type></note>`,
                ),
            )
            const { score, warnings } = load(xml)
            expect(measureNotes(score)).toEqual(['G4:q', 'G5:q', 'B3:q', 'r:q'])
            expect(warnings).toEqual(['Chords were reduced to their top note.'])
            // A chord flag on the very first note has nothing to attach to and reads as a plain note.
            expect(measureNotes(load(doc(measure(note('D', 4, 'whole', 48, '<chord/>')))).score)).toEqual(['D4:w'])
        })

        it('keeps only the first voice on the first staff, ignoring backups and other voices', () => {
            const xml = doc(
                measure(
                    note('C', 5, 'half', 24, '<voice>1</voice><staff>1</staff>') +
                        note('D', 5, 'half', 24, '<voice>1</voice>') +
                        '<backup><duration>48</duration></backup>' +
                        note('C', 3, 'whole', 48, '<voice>2</voice>') +
                        '<backup><duration>48</duration></backup>' +
                        note('C', 2, 'whole', 48, '<voice>1</voice><staff>2</staff>'),
                ),
            )
            const { score, warnings } = load(xml)
            expect(measureNotes(score)).toEqual(['C5:h', 'D5:h'])
            expect(warnings).toEqual(['Only the first voice of the part was imported.'])
        })

        it('leaves out grace and cue notes', () => {
            const xml = doc(
                measure(
                    `<note><grace/><pitch><step>B</step><octave>4</octave></pitch><type>eighth</type></note>` + note('C', 5, 'whole', 48),
                ),
            )
            expect(measureNotes(load(xml).score)).toEqual(['C5:w'])
            expect(load(xml).warnings).toEqual(['Grace and cue notes were left out.'])
            const cue = doc(
                measure(
                    `<note><cue/><pitch><step>B</step><octave>4</octave></pitch><duration>12</duration><type>quarter</type></note>` +
                        note('C', 5, 'whole', 48),
                ),
            )
            expect(measureNotes(load(cue).score)).toEqual(['C5:w'])
        })

        it('drops notes it cannot read and rounds odd pitches into range', () => {
            const xml = doc(
                measure(
                    `<note><pitch><step>H</step><octave>4</octave></pitch><duration>12</duration><type>quarter</type></note>` +
                        `<note><pitch><step>C</step></pitch><duration>12</duration><type>quarter</type></note>` +
                        `<note><pitch><step>C</step><octave>4</octave></pitch><type>quarter</type></note>` +
                        `<note><pitch><step>C</step><alter>0.5</alter><octave>12</octave></pitch><duration>12</duration><type>quarter</type></note>` +
                        `<note><pitch><step>D</step><alter>-3</alter><octave>4</octave></pitch><duration>12</duration><type>quarter</type></note>`,
                ),
            )
            const { score, warnings } = load(xml)
            expect(measureNotes(score)).toEqual(['r:q', 'r:q', 'C#9:q', 'Dbb4:q'])
            expect(warnings).toEqual(['Some notes could not be read and were left out.'])
        })

        it('turns <forward> into rests for the imported voice only', () => {
            const xml = doc(
                measure(
                    note('C', 4, 'quarter', 12, '<voice>1</voice>') +
                        '<forward><duration>12</duration><voice>1</voice></forward>' +
                        '<forward><duration>12</duration><voice>2</voice></forward>' +
                        '<forward><duration>-1</duration></forward>' +
                        '<forward/>' +
                        note('D', 4, 'half', 24, '<voice>1</voice>'),
                ),
            )
            expect(measureNotes(load(xml).score)).toEqual(['C4:q', 'r:q', 'D4:h'])
        })
    })

    describe('barlines', () => {
        it('reads right-hand bar styles and ignores the rest', () => {
            const xml = doc(
                measure(note('C', 4, 'whole', 48) + '<barline location="right"><bar-style>light-light</bar-style></barline>') +
                    measure(
                        note('C', 4, 'whole', 48) +
                            '<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>',
                    ) +
                    measure(note('C', 4, 'whole', 48) + '<barline><bar-style>dashed</bar-style></barline>') +
                    measure(note('C', 4, 'whole', 48) + '<barline><bar-style>none</bar-style></barline>') +
                    measure(note('C', 4, 'whole', 48) + '<barline/>'),
            )
            expect(load(xml).score.measures.map((m) => m.endBarline)).toEqual(['double', 'single', 'single', 'none', 'end'])
        })
    })

    describe('fitting bars', () => {
        it('pads a whole-bar rest and short bars with rests, leading in on a pickup', () => {
            const xml = doc(
                measure(note('G', 4, 'eighth', 6)) + // pickup
                    measure('<note><rest measure="yes"/><duration>48</duration></note>') +
                    measure(note('C', 4, 'quarter', 12) + note('D', 4, 'eighth', 6)),
            )
            const { score, warnings } = load(xml)
            expect(warnings).toEqual([])
            expect(measureNotes(score, 0)).toEqual(['r:q', 'r:q', 'r:q', 'r:8', 'G4:8'])
            expect(measureNotes(score, 1)).toEqual(['r:q', 'r:q', 'r:q', 'r:q'])
            expect(measureNotes(score, 2)).toEqual(['C4:q', 'D4:8', 'r:8', 'r:q', 'r:q'])
        })

        it('trims overfull bars at the barline, cutting the straddling note to fit', () => {
            const triplet = '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'
            const xml = doc(
                measure(note('C', 4, 'breve', 96)) + // spelled as two tied wholes, the second of which cannot fit
                    measure(note('D', 4, 'half', 24) + note('E', 4, 'whole', 48) + note('F', 4, 'quarter', 12)) +
                    measure(
                        note('G', 4, 'half', 36, '<dot/>') +
                            note('A', 4, 'quarter', 8, triplet) +
                            note('B', 4, 'quarter', 8, triplet) +
                            note('C', 5, 'quarter', 8, triplet),
                    ),
            )
            const { score, warnings } = load(xml)
            expect(measureNotes(score, 0)).toEqual(['C4:w~start'])
            expect(measureNotes(score, 1)).toEqual(['D4:h', 'E4:h'])
            expect(measureNotes(score, 2)).toEqual(['G4:h.', 'A4:q(3:2)', 'B4:8(3:2)'])
            expect(warnings).toContain('Some bars held more than their time signature allows; the overflow was trimmed.')
        })
    })
})
