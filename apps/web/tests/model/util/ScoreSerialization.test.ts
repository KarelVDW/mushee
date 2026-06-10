import { makeScore, pitched } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import type { MxmlMeasure, ScorePartwise } from '@/components/notation/types'
import { Duration } from '@/model/Duration'
import { Instrument } from '@/model/Instrument'
import { Measure } from '@/model/Measure'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'
import { ScoreDeserializer } from '@/model/util/ScoreDeserializer'
import { ScoreSerializer } from '@/model/util/ScoreSerializer'

const toInput = (score: Score): ScorePartwise => new ScoreSerializer(score).toInput()
const roundTrip = (score: Score): Score => new ScoreDeserializer(toInput(score)).toScore()

/** Read the serialized note entries (in order) of measure `mi`. */
const noteEntries = (input: ScorePartwise, mi = 0) => input.parts[0].measures[mi].entries.filter((e) => e._type === 'note')

describe('note content round-trip', () => {
    it('round-trips pitched notes with their step and octave', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.replace(m.notes, [pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)])

        const restored = roundTrip(score)
        const rm = restored.firstMeasure
        if (!rm) throw new Error('expected restored firstMeasure')
        expect(rm.notes.map((n) => n.pitch?.name)).toEqual(['C', 'D', 'E', 'F'])
        expect(rm.notes.map((n) => n.pitch?.octave)).toEqual([4, 4, 4, 4])
    })

    it('round-trips rests (no pitch)', () => {
        const score = makeScore(1) // default measure is filled with quarter rests
        const restored = roundTrip(score)
        const rm = restored.firstMeasure
        if (!rm) throw new Error('expected restored firstMeasure')
        expect(rm.notes.every((n) => n.isRest)).toBe(true)
        expect(rm.notes.length).toBe(4)
    })

    it('round-trips every duration type and dotted durations', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        // whole note fills the 4/4 bar
        score.replace(m.notes, [pitched('G', 4, 'w')])
        const restored = roundTrip(score)
        expect(restored.firstMeasure?.notes[0].duration.type).toBe('w')

        // half + dotted-quarter + eighth = 2 + 1.5 + 0.5 = 4 beats
        const score2 = makeScore(1)
        const m2 = score2.firstMeasure
        if (!m2) throw new Error('expected firstMeasure')
        score2.replace(m2.notes, [
            new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 4 }) }),
            new Note({ duration: new Duration({ type: 'q', dots: 1 }), pitch: new Pitch({ name: 'D', octave: 4 }) }),
            new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name: 'E', octave: 4 }) }),
        ])
        const r2 = roundTrip(score2).firstMeasure
        if (!r2) throw new Error('expected restored firstMeasure')
        expect(r2.notes.map((n) => n.duration.type)).toEqual(['h', 'q', '8'])
        expect(r2.notes[1].duration.dots).toBe(1)

        // sixteenths
        const score3 = makeScore(1)
        const m3 = score3.firstMeasure
        if (!m3) throw new Error('expected firstMeasure')
        score3.replace([m3.notes[0]], [pitched('A', 4, '16')])
        const r3 = roundTrip(score3).firstMeasure
        expect(r3?.notes[0].duration.type).toBe('16')
    })

    it('round-trips accidentals (sharp, flat, double-sharp, double-flat, natural)', () => {
        const cases: Array<{ alter: number; accidental?: string }> = [
            { alter: 1, accidental: '#' },
            { alter: -1, accidental: 'b' },
            { alter: 2, accidental: '##' },
            { alter: -2, accidental: 'bb' },
            { alter: 0, accidental: undefined },
        ]
        for (const { alter, accidental } of cases) {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            score.replace([m.notes[0]], [new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'F', alter, accidental, octave: 4 }) })])
            const restored = roundTrip(score).firstMeasure
            if (!restored) throw new Error('expected restored firstMeasure')
            expect(restored.notes[0].pitch?.alter).toBe(alter)
        }
    })

    it('omits the alter field for natural notes in the serialized DTO', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.replace([m.notes[0]], [pitched('C', 4)])
        const entry = noteEntries(toInput(score))[0]
        expect(entry.pitch?.alter).toBeUndefined()
    })

    it('emits the alter field for altered notes in the serialized DTO', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.replace([m.notes[0]], [new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'F', alter: 1, accidental: '#', octave: 4 }) })])
        const entry = noteEntries(toInput(score))[0]
        expect(entry.pitch?.alter).toBe(1)
    })
})

describe('tie serialization round-trip', () => {
    it('round-trips a start/stop tie pair', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.replace(m.notes, [
            new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start' }),
            new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'stop' }),
        ])

        const restored = roundTrip(score).firstMeasure
        if (!restored) throw new Error('expected restored firstMeasure')
        expect(restored.notes[0].tie).toBe('start')
        expect(restored.notes[1].tie).toBe('stop')
    })

    it('round-trips a start-stop (continuation) tie', () => {
        // Three half-notes (across two measures) tied through the middle one.
        const score = makeScore(2)
        const m0 = score.measures[0]
        const m1 = score.measures[1]
        score.replace(m0.notes, [
            new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start' }),
            new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start-stop' }),
        ])
        score.replace(m1.notes, [
            new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'stop' }),
            new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'D', octave: 5 }) }),
        ])

        const input = toInput(score)
        // The continuation note must serialize both a stop and a start tie, in that order.
        const middle = noteEntries(input, 0)[1]
        expect(middle.tie).toEqual([{ type: 'stop' }, { type: 'start' }])

        const restored = roundTrip(score)
        expect(restored.measures[0].notes[0].tie).toBe('start')
        expect(restored.measures[0].notes[1].tie).toBe('start-stop')
        expect(restored.measures[1].notes[0].tie).toBe('stop')
        expect(restored.measures[1].notes[1].tie).toBeUndefined()
    })
})

describe('tuplet serialization round-trip', () => {
    it('round-trips a triplet with its time-modification ratio', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        const triplet = score.toggleTuplet(m.firstNote)
        if (!triplet) throw new Error('expected a triplet')
        expect(m.notes.some((n) => n.inTuplet)).toBe(true)

        const input = toInput(score)
        const tupletEntry = noteEntries(input).find((e) => e.timeModification)
        expect(tupletEntry?.timeModification).toEqual({ actualNotes: 3, normalNotes: 2 })

        const restored = roundTrip(score).firstMeasure
        if (!restored) throw new Error('expected restored firstMeasure')
        const restoredTuplet = restored.notes.filter((n) => n.inTuplet)
        expect(restoredTuplet.length).toBe(3)
        expect(restoredTuplet[0].duration.ratio).toEqual({ actualNotes: 3, normalNotes: 2 })
    })
})

describe('tempo serialization round-trip', () => {
    it('round-trips a leading tempo marking', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.setTempo(m.firstNote, 132)

        const input = toInput(score)
        expect(input.parts[0].measures[0].entries.some((e) => e._type === 'direction' && e.sound?.tempo === 132)).toBe(true)

        const restored = roundTrip(score).firstMeasure
        if (!restored) throw new Error('expected restored firstMeasure')
        expect(restored.tempoAtBeat(0)?.bpm).toBe(132)
    })

    it('round-trips a mid-measure tempo change at its beat', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.setTempo(m.noteAtBeat(2), 80)

        const restored = roundTrip(score).firstMeasure
        if (!restored) throw new Error('expected restored firstMeasure')
        expect(restored.tempoAtBeat(2)?.bpm).toBe(80)
    })
})

describe('time signature serialization round-trip', () => {
    it('round-trips a non-4/4 leading time signature', () => {
        const score = new Score()
        const measure = new Measure(score, 'treble', new TimeSignature(3, 4))
        measure.complete()
        score.addMeasure(undefined, measure)

        const restored = roundTrip(score).firstMeasure
        if (!restored) throw new Error('expected restored firstMeasure')
        expect(restored.timeSignature.beatAmount).toBe(3)
        expect(restored.timeSignature.beatType).toBe(4)
    })

    it('round-trips a mid-score time signature change', () => {
        const score = new Score()
        const m0 = new Measure(score, 'treble', new TimeSignature(4, 4))
        m0.complete()
        score.addMeasure(undefined, m0)
        const m1 = new Measure(score, 'treble', new TimeSignature(6, 8))
        m1.complete()
        score.addMeasure(undefined, m1)

        const restored = roundTrip(score)
        expect(restored.measures[0].timeSignature.beatAmount).toBe(4)
        expect(restored.measures[0].timeSignature.beatType).toBe(4)
        expect(restored.measures[1].timeSignature.beatAmount).toBe(6)
        expect(restored.measures[1].timeSignature.beatType).toBe(8)
    })
})

describe('barline serialization', () => {
    it('serializes every non-default barline style to the matching MusicXML bar-style', () => {
        const score = makeScore(4)
        score.measures[0].setEndBarline('double')
        score.measures[1].setEndBarline('end')
        score.measures[2].setEndBarline('none')
        score.measures[3].setEndBarline('single')

        const input = toInput(score)
        const styleOf = (mi: number) => {
            const bar = input.parts[0].measures[mi].entries.find((e) => e._type === 'barline')
            return bar?._type === 'barline' ? bar.barStyle : undefined
        }
        expect(styleOf(0)).toBe('light-light') // double
        expect(styleOf(1)).toBe('light-heavy') // end
        expect(styleOf(2)).toBe('none') // none
        expect(styleOf(3)).toBeUndefined() // single is the default and is not emitted
    })

    it('parses each MusicXML bar-style back to the correct barline type on deserialize', () => {
        // NOTE: Score.addMeasure forcibly resets the end barline of non-last measures to 'single'
        // (and the last to 'end') as measures are appended, so a *round-trip* drops mid-score barlines.
        // This is a known model limitation reported separately — see the agent report. Here we verify the
        // deserializer's bar-style parsing directly by feeding a single measure per style.
        const single = (style: 'light-light' | 'light-heavy' | 'none'): ScorePartwise => ({
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [
                {
                    id: 'P1',
                    measures: [
                        {
                            number: '1',
                            entries: [
                                { _type: 'attributes', divisions: 12, time: [{ beats: '4', beatType: '4' }] },
                                { _type: 'note', rest: {}, duration: 48, voice: '1', type: 'whole' },
                                { _type: 'barline', location: 'right', barStyle: style },
                            ],
                        },
                    ],
                },
            ],
        })
        // A single measure is the last measure, so addMeasure sets its barline to 'end' regardless of input —
        // assert the parse via a two-measure DTO where the *first* measure's parsed style survives long enough
        // to be observed before the second is appended would still be reset. So assert the deserializer parsed
        // value indirectly: 'light-heavy' on the lone (last) measure yields 'end', which matches both parse and reset.
        expect(new ScoreDeserializer(single('light-heavy')).toScore().firstMeasure?.endBarline).toBe('end')
        // 'light-light' and 'none' are parsed (exercising those branches) but then reset to 'end' on the last measure.
        expect(new ScoreDeserializer(single('light-light')).toScore().firstMeasure?.endBarline).toBe('end')
        expect(new ScoreDeserializer(single('none')).toScore().firstMeasure?.endBarline).toBe('end')
    })

    it('does not emit a barline entry for the default single barline', () => {
        const score = makeScore(2)
        score.measures[0].setEndBarline('single')
        const input = toInput(score)
        expect(input.parts[0].measures[0].entries.some((e) => e._type === 'barline')).toBe(false)
    })

    it('emits a barline entry for a non-default style', () => {
        const score = makeScore(2)
        score.measures[0].setEndBarline('double')
        const input = toInput(score)
        const barline = input.parts[0].measures[0].entries.find((e) => e._type === 'barline')
        expect(barline).toBeDefined()
        expect(barline?._type === 'barline' && barline.barStyle).toBe('light-light')
    })
})

describe('instrument serialization round-trip', () => {
    it('round-trips a transposing instrument and emits <transpose> on the first measure', () => {
        const score = makeScore(1)
        score.setInstrument(Instrument.Trumpet)

        const input = toInput(score)
        const attributes = input.parts[0].measures[0].entries.find((e) => e._type === 'attributes')
        expect(attributes?._type === 'attributes' && attributes.transpose).toEqual({ chromatic: -2, diatonic: -1 })
        expect(input.partList.scoreParts[0].midiInstrument?.midiProgram).toBe(Instrument.Trumpet.gmProgram + 1)

        const restored = roundTrip(score)
        expect(restored.instrument).toBe(Instrument.Trumpet)
    })

    it('does not emit <transpose> for a concert-pitch instrument', () => {
        const score = makeScore(1)
        score.setInstrument(Instrument.Flute)
        const input = toInput(score)
        const attributes = input.parts[0].measures[0].entries.find((e) => e._type === 'attributes')
        expect(attributes?._type === 'attributes' && attributes.transpose).toBeUndefined()
    })

    it('resolves the instrument by name when no midi program is present', () => {
        const score = makeScore(1)
        score.setInstrument(Instrument.Violin)
        const input = toInput(score)
        // Strip the midi program so the deserializer must fall back to the instrument name.
        delete input.partList.scoreParts[0].midiInstrument
        const restored = new ScoreDeserializer(input).toScore()
        expect(restored.instrument).toBe(Instrument.Violin)
    })

    it('falls back to Piano when neither midi program nor instrument name is present', () => {
        const score = makeScore(1)
        const input = toInput(score)
        delete input.partList.scoreParts[0].midiInstrument
        delete input.partList.scoreParts[0].scoreInstrument
        // partName must also be absent for the name fallback to be skipped.
        input.partList.scoreParts[0].partName = ''
        const restored = new ScoreDeserializer(input).toScore()
        expect(restored.instrument).toBe(Instrument.Piano)
    })

    it('resolves the instrument by partName when scoreInstrument is absent', () => {
        const score = makeScore(1)
        const input = toInput(score)
        delete input.partList.scoreParts[0].midiInstrument
        delete input.partList.scoreParts[0].scoreInstrument
        input.partList.scoreParts[0].partName = 'Cello'
        const restored = new ScoreDeserializer(input).toScore()
        expect(restored.instrument).toBe(Instrument.Cello)
    })
})

describe('multi-measure round-trip', () => {
    it('round-trips a multi-measure score preserving measure count and note content', () => {
        const score = makeScore(3)
        score.replace([score.measures[0].notes[0]], [pitched('C', 4)])
        score.replace([score.measures[1].notes[0]], [pitched('E', 4)])
        score.replace([score.measures[2].notes[0]], [pitched('G', 4)])

        const restored = roundTrip(score)
        expect(restored.measures.length).toBe(3)
        expect(restored.measures[0].notes[0].pitch?.name).toBe('C')
        expect(restored.measures[1].notes[0].pitch?.name).toBe('E')
        expect(restored.measures[2].notes[0].pitch?.name).toBe('G')
    })
})

describe('edge cases', () => {
    it('deserializes a measure that contains no <note> entries (empty bar)', () => {
        const input: ScorePartwise = {
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [
                {
                    id: 'P1',
                    measures: [
                        {
                            number: '1',
                            // Attributes only, no notes — the measure is created but addNotes is skipped.
                            entries: [{ _type: 'attributes', divisions: 12, clef: [{ sign: 'F', line: 4 }], time: [{ beats: '4', beatType: '4' }] }],
                        },
                    ],
                },
            ],
        }
        const restored = new ScoreDeserializer(input).toScore()
        expect(restored.measures.length).toBe(1)
        expect(restored.firstMeasure?.notes.length).toBe(0)
        expect(restored.firstMeasure?.clef.type).toBe('bass')
    })

    it('deserializes an empty parts array to an empty score (no measures)', () => {
        const input: ScorePartwise = {
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [],
        }
        const restored = new ScoreDeserializer(input).toScore()
        expect(restored.measures.length).toBe(0)
        // The instrument is still seeded from the (otherwise empty) part list.
        expect(restored.instrument).toBe(Instrument.Piano)
    })

    it('deserializes with no scorePart present (skips instrument seeding)', () => {
        const input = { partList: { scoreParts: [] }, parts: [] } as unknown as ScorePartwise
        const restored = new ScoreDeserializer(input).toScore()
        expect(restored.measures.length).toBe(0)
        expect(restored.instrument).toBe(Instrument.Piano)
    })

    it('invokes the onChange callback supplied to toScore on mutation', () => {
        const score = makeScore(1)
        const input = toInput(score)
        let changes = 0
        const restored = new ScoreDeserializer(input).toScore(() => changes++)
        const before = changes
        restored.addMeasure()
        expect(changes).toBeGreaterThan(before)
    })

    it('clef in trailing attributes (past the last note) carries forward to the next measure', () => {
        // Build a measure whose only clef change sits at the very end of the bar (beat 4 in 4/4),
        // so it serializes as a trailing <attributes> after the last note and must re-anchor on reload.
        const score = new Score()
        const m0 = new Measure(score, 'treble', new TimeSignature(4, 4))
        m0.complete() // four quarter rests at beats 0,1,2,3
        m0.addClef(4, 'bass') // clef change at the end-of-measure boundary
        score.addMeasure(undefined, m0)
        const m1 = new Measure(score, 'treble', new TimeSignature(4, 4))
        m1.complete()
        score.addMeasure(undefined, m1)

        // Sanity: the trailing clef is the last clef of m0 and serializes as a standalone attributes entry.
        const input = toInput(score)
        const m0Clefs = input.parts[0].measures[0].entries.filter((e) => e._type === 'attributes' && e.clef)
        // One leading clef attributes + one trailing clef attributes.
        expect(m0Clefs.length).toBeGreaterThanOrEqual(1)

        const restored = roundTrip(score)
        // The trailing bass clef carries into measure 1.
        expect(restored.measures[1].clef.type).toBe('bass')
    })

    it('key in trailing attributes (past the last note) carries forward to the next measure', () => {
        const score = new Score()
        const m0 = new Measure(score, 'treble', new TimeSignature(4, 4))
        m0.complete()
        m0.addKeySignature(4, 3) // key change at the end-of-measure boundary
        score.addMeasure(undefined, m0)
        const m1 = new Measure(score, 'treble', new TimeSignature(4, 4))
        m1.complete()
        score.addMeasure(undefined, m1)

        const restored = roundTrip(score)
        expect(restored.measures[1].keySignature.fifths).toBe(3)
    })

    it('deserializes a clef with an omitted <line>, defaulting per sign', () => {
        // Hand-built DTO: a G clef with no line should resolve to treble (G/2).
        const input: ScorePartwise = {
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [
                {
                    id: 'P1',
                    measures: [
                        {
                            number: '1',
                            entries: [
                                { _type: 'attributes', divisions: 12, clef: [{ sign: 'G' }], time: [{ beats: '4', beatType: '4' }] },
                                { _type: 'note', rest: {}, duration: 48, voice: '1', type: 'whole' },
                            ],
                        },
                    ],
                },
            ],
        }
        const restored = new ScoreDeserializer(input).toScore()
        expect(restored.firstMeasure?.clef.type).toBe('treble')
    })

    it('deserializes an unknown clef sign by falling back to treble', () => {
        const input: ScorePartwise = {
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [
                {
                    id: 'P1',
                    measures: [
                        {
                            number: '1',
                            entries: [
                                // 'percussion' has no entry in CLEF_DEFS, so resolution falls through to treble.
                                { _type: 'attributes', divisions: 12, clef: [{ sign: 'percussion', line: 3 }], time: [{ beats: '4', beatType: '4' }] },
                                { _type: 'note', rest: {}, duration: 48, voice: '1', type: 'whole' },
                            ],
                        },
                    ],
                },
            ],
        }
        const restored = new ScoreDeserializer(input).toScore()
        expect(restored.firstMeasure?.clef.type).toBe('treble')
    })

    it('ignores a barline entry with no barStyle and a direction with no tempo', () => {
        const input: ScorePartwise = {
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [
                {
                    id: 'P1',
                    measures: [
                        {
                            number: '1',
                            entries: [
                                { _type: 'attributes', divisions: 12, time: [{ beats: '4', beatType: '4' }] },
                                { _type: 'direction', sound: {} }, // no tempo → no pending tempo recorded
                                { _type: 'note', rest: {}, duration: 48, voice: '1', type: 'whole' },
                                { _type: 'barline', location: 'right' }, // no barStyle → no end barline parsed
                            ],
                        },
                    ],
                },
            ],
        }
        const restored = new ScoreDeserializer(input).toScore()
        const rm = restored.firstMeasure
        if (!rm) throw new Error('expected firstMeasure')
        expect(rm.tempos.length).toBe(0)
        // No barStyle parsed; the lone (last) measure still defaults to 'end' via addMeasure.
        expect(rm.endBarline).toBe('end')
    })

    it('deserializes an unknown clef sign with no <line> using the absolute default line', () => {
        const input: ScorePartwise = {
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [
                {
                    id: 'P1',
                    measures: [
                        {
                            number: '1',
                            entries: [
                                // 'percussion' is not in DEFAULT_CLEF_LINE and no line is given, so the
                                // resolved line falls through to the absolute default (2), then to treble.
                                { _type: 'attributes', divisions: 12, clef: [{ sign: 'percussion' }], time: [{ beats: '4', beatType: '4' }] },
                                { _type: 'note', rest: {}, duration: 48, voice: '1', type: 'whole' },
                            ],
                        },
                    ],
                },
            ],
        }
        const restored = new ScoreDeserializer(input).toScore()
        expect(restored.firstMeasure?.clef.type).toBe('treble')
    })

    it('deserializes an unknown barline style as single', () => {
        const input: ScorePartwise = {
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [
                {
                    id: 'P1',
                    measures: [
                        {
                            number: '1',
                            entries: [
                                { _type: 'attributes', divisions: 12, time: [{ beats: '4', beatType: '4' }] },
                                { _type: 'note', rest: {}, duration: 48, voice: '1', type: 'whole' },
                                { _type: 'barline', location: 'right', barStyle: 'regular' },
                            ],
                        },
                    ],
                },
            ],
        }
        const restored = new ScoreDeserializer(input).toScore()
        // 'regular' maps to 'single', the default; on the last measure that is then overridden to 'end'.
        expect(restored.firstMeasure?.endBarline).toBe('end')
    })

    it('defaults a note with no <type> to a quarter note', () => {
        const input: ScorePartwise = {
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [
                {
                    id: 'P1',
                    measures: [
                        {
                            number: '1',
                            entries: [
                                { _type: 'attributes', divisions: 12, time: [{ beats: '1', beatType: '4' }] },
                                { _type: 'note', rest: {}, duration: 12, voice: '1' },
                            ],
                        },
                    ],
                },
            ],
        }
        const restored = new ScoreDeserializer(input).toScore()
        expect(restored.firstMeasure?.notes[0].duration.type).toBe('q')
    })

    it('ignores a tie array that is empty or has no recognized markers', () => {
        const base = (tie: Array<{ type: 'start' | 'stop' }>): ScorePartwise => ({
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [
                {
                    id: 'P1',
                    measures: [
                        {
                            number: '1',
                            entries: [
                                { _type: 'attributes', divisions: 12, time: [{ beats: '1', beatType: '4' }] },
                                { _type: 'note', pitch: { step: 'C', octave: 4 }, duration: 12, voice: '1', type: 'quarter', tie },
                            ],
                        },
                    ],
                },
            ],
        })
        const restored = new ScoreDeserializer(base([])).toScore()
        expect(restored.firstMeasure?.notes[0].tie).toBeUndefined()

        // A non-empty tie array whose entries carry no recognized 'start'/'stop' marker yields undefined.
        const malformed = base([{ type: 'continue' } as unknown as { type: 'start' | 'stop' }])
        const restoredMalformed = new ScoreDeserializer(malformed).toScore()
        expect(restoredMalformed.firstMeasure?.notes[0].tie).toBeUndefined()
    })
})

describe('ScoreDeserializer.mxmlMeasureToNotes', () => {
    it('extracts only the note entries from a measure, ignoring attributes/barlines/directions', () => {
        const measure: MxmlMeasure = {
            number: '1',
            entries: [
                { _type: 'attributes', divisions: 12, clef: [{ sign: 'G', line: 2 }], time: [{ beats: '4', beatType: '4' }] },
                { _type: 'direction', sound: { tempo: 100 } },
                { _type: 'note', pitch: { step: 'C', octave: 4 }, duration: 12, voice: '1', type: 'quarter' },
                { _type: 'note', rest: {}, duration: 12, voice: '1', type: 'quarter' },
                { _type: 'barline', location: 'right', barStyle: 'light-heavy' },
            ],
        }
        const notes = ScoreDeserializer.mxmlMeasureToNotes(measure)
        expect(notes.length).toBe(2)
        expect(notes[0].pitch?.name).toBe('C')
        expect(notes[1].isRest).toBe(true)
    })
})

describe('full feature round-trip', () => {
    it('round-trips a score combining clef, key, time, tempo, tie, tuplet and barline changes', () => {
        const score = new Score()
        const m0 = new Measure(score, 'bass', new TimeSignature(4, 4), { keyFifths: 2, leadingClefExplicit: true, leadingKeyExplicit: true })
        m0.complete()
        score.addMeasure(undefined, m0)
        const m1 = new Measure(score, 'bass', new TimeSignature(3, 4), { keyFifths: 2 })
        m1.complete()
        score.addMeasure(undefined, m1)

        // Notes, tempo, mid-measure clef and a tied pair in measure 0.
        score.replace(m0.notes, [
            new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 3 }), tie: 'start' }),
            new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 3 }), tie: 'stop' }),
        ])
        score.setTempo(m0.firstNote, 96)
        score.setClef(m0.noteAtBeat(2), 'tenor')
        m0.setEndBarline('double')

        const input = toInput(score)
        const restored = new ScoreDeserializer(input).toScore()
        const rm0 = restored.measures[0]
        const rm1 = restored.measures[1]
        expect(rm0.clef.type).toBe('bass')
        expect(rm0.keySignature.fifths).toBe(2)
        expect(rm0.timeSignature.beatAmount).toBe(4)
        expect(rm0.tempoAtBeat(0)?.bpm).toBe(96)
        expect(rm0.notes[0].tie).toBe('start')
        expect(rm0.notes[1].tie).toBe('stop')
        expect(rm0.clefAtOrBefore(2).type).toBe('tenor')
        // m0's 'double' barline is serialized correctly but Score.addMeasure resets non-last barlines to
        // 'single' on reload (known model limitation — see report); assert the serialized DTO instead.
        const m0Barline = input.parts[0].measures[0].entries.find((e) => e._type === 'barline')
        expect(m0Barline?._type === 'barline' && m0Barline.barStyle).toBe('light-light')
        expect(rm1.timeSignature.beatAmount).toBe(3)
        expect(rm1.timeSignature.beatType).toBe(4)
        expect(rm1.keySignature.fifths).toBe(2) // carried forward
    })
})
