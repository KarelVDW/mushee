import type { TieType } from '@mushee/notation/components/types'
import { Duration } from '@mushee/notation/model/Duration'
import { Measure } from '@mushee/notation/model/Measure'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import { ScoreSerializer } from '@mushee/notation/model/util/ScoreSerializer'
import { makeScore, pitched, rest } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

/** Swap a measure's content for an exact note list (tests may leave measures under-full). */
function fill(measure: Measure, notes: Note[]) {
    measure.removeNotes([...measure.notes])
    measure.addNotes(notes)
}

function tied(note: Note, tie: TieType): Note {
    return note.clone({ tie })
}

function triplet(name: string, octave: number): Note {
    return new Note({
        duration: new Duration({ type: '8', ratio: { actualNotes: 3, normalNotes: 2 } }),
        pitch: new Pitch({ name, octave }),
    })
}

/** Compact readable form of a measure's notes: "C4:q", "r:8", "E4:h.:start". */
function shape(measure: Measure): string[] {
    return measure.notes.map((n) => {
        const head = n.pitch ? `${n.pitch.name}${n.pitch.octave}` : 'r'
        return `${head}:${n.duration.type}${'.'.repeat(n.duration.dots)}${n.tie ? `:${n.tie}` : ''}`
    })
}

/** The MusicXML <time> emitted for each measure (undefined = inherited, not re-emitted). */
function emittedTimes(score: Score): Array<string | undefined> {
    return new ScoreSerializer(score).toInput().parts[0].measures.map((m) => {
        const attributes = m.entries.find((e) => (e as { _type: string })._type === 'attributes') as {
            time?: [{ beats: string; beatType: string }]
        }
        const time = attributes?.time?.[0]
        return time && `${time.beats}/${time.beatType}`
    })
}

describe('Score.setTimeSignature', () => {
    describe('run semantics (mirrors key signatures)', () => {
        it('applies to the end of the score when no later change exists', () => {
            const score = makeScore(2)
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(score.measures).toHaveLength(3) // 8 beats rebarred into 3-beat measures
            expect(score.measures.every((m) => m.timeSignature.equals(new TimeSignature(3, 4)))).toBe(true)
            expect(score.measures.every((m) => m.beats === 3)).toBe(true)
            expect(score.measures[2].endBarline).toBe('end')
            expect(score.measures[0].endBarline).toBe('single')
            expect(score.layout.rows.length).toBeGreaterThan(0) // layout still resolves
        })

        it('changing a later measure creates a boundary; earlier measures keep their meter', () => {
            const score = makeScore(3)
            score.setTimeSignature(score.measures[1], new TimeSignature(3, 4))
            expect(score.measures[0].timeSignature.equals(new TimeSignature(4, 4))).toBe(true)
            expect(score.measures.slice(1).every((m) => m.timeSignature.equals(new TimeSignature(3, 4)))).toBe(true)
            // Serialized as one specified change at the boundary, inherited after it.
            expect(emittedTimes(score)).toEqual(['4/4', '3/4', undefined, undefined])
        })

        it('stops at the next specified change and leaves that section untouched', () => {
            const score = makeScore(4)
            score.setTimeSignature(score.measures[2], new TimeSignature(3, 4))
            const section = score.measures.slice(2)
            const sectionNotes = section.map((m) => m.notes)

            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures.slice(0, 4).every((m) => m.timeSignature.equals(new TimeSignature(2, 4)))).toBe(true)
            // The 3/4 section survives by identity: same measures, same notes.
            expect(score.measures.slice(4)).toEqual(section)
            section.forEach((m, i) => expect(m.notes).toEqual(sectionNotes[i]))
        })

        it('setting the meter carried in from before erases the boundary (runs merge)', () => {
            const score = makeScore(3)
            score.setTimeSignature(score.measures[1], new TimeSignature(3, 4))
            score.setTimeSignature(score.measures[1], new TimeSignature(4, 4))
            expect(score.measures.every((m) => m.timeSignature.equals(new TimeSignature(4, 4)))).toBe(true)
            expect(
                emittedTimes(score)
                    .slice(1)
                    .every((t) => t === undefined),
            ).toBe(true)
        })

        it('setting the meter already in effect is a no-op', () => {
            const score = makeScore(2)
            const version = score.version
            const measures = [...score.measures]
            score.setTimeSignature(score.measures[0], new TimeSignature(4, 4))
            expect(score.version).toBe(version)
            expect(score.measures).toEqual(measures)
        })

        it('bumps the version, fires onChange and marks the structure dirty', () => {
            let calls = 0
            const score = new Score(() => calls++)
            score.addMeasure().complete()
            score.addMeasure().complete()
            score.clearDirty()
            calls = 0
            const version = score.version
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(score.version).toBeGreaterThan(version)
            expect(calls).toBeGreaterThan(0)
            expect(score.flushDirty()?.allMeasures).toHaveLength(3)
        })
    })

    describe('note flow', () => {
        it('reflows rests across the new barlines and pads the last measure', () => {
            const score = makeScore(1) // 4 quarter rests
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(score.measures).toHaveLength(2)
            expect(shape(score.measures[0])).toEqual(['r:q', 'r:q', 'r:q'])
            expect(shape(score.measures[1])).toEqual(['r:q', 'r:q', 'r:q']) // 1 flowed + 2 padded
        })

        it('merges measures when the meter grows', () => {
            const score = new Score()
            for (let i = 0; i < 4; i++) score.addMeasure(i, new Measure(score, 'treble', new TimeSignature(3, 4))).complete()
            score.setTimeSignature(score.measures[0], new TimeSignature(4, 4))
            expect(score.measures).toHaveLength(3) // 12 beats in 4-beat measures
            expect(score.measures.every((m) => m.beats === 4)).toBe(true)
        })

        it('splits a pitched note straddling the new barline into a tied pair', () => {
            const score = makeScore(1)
            fill(score.measures[0], [pitched('C', 4), pitched('D', 4), pitched('E', 4, 'h')])
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(shape(score.measures[0])).toEqual(['C4:q', 'D4:q', 'E4:q:start'])
            expect(shape(score.measures[1])).toEqual(['E4:q:stop', 'r:q', 'r:q'])
            expect(score.tiePartner(score.measures[0].notes[2])).toBe(score.measures[1].notes[0])
        })

        it('splits a straddling rest without ties', () => {
            const score = makeScore(1)
            fill(score.measures[0], [pitched('C', 4), pitched('D', 4), rest('h')])
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(shape(score.measures[0])).toEqual(['C4:q', 'D4:q', 'r:q'])
            expect(shape(score.measures[1])[0]).toBe('r:q')
        })

        it('unsplit notes keep their identity and exact written form', () => {
            const score = makeScore(1)
            const c = new Note({ duration: new Duration({ type: 'q', dots: 1 }), pitch: new Pitch({ name: 'C', octave: 4 }) })
            const d = pitched('D', 4, '8')
            fill(score.measures[0], [c, d, pitched('E', 4, 'h')])
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(score.measures[0].notes[0]).toBe(c) // dotted quarter survives as-is
            expect(score.measures[0].notes[1]).toBe(d)
        })

        it('coalesces a chain the old barline split, then re-splits it at the new one', () => {
            const score = makeScore(2)
            fill(score.measures[0], [pitched('C', 4, 'h'), tied(pitched('D', 4, 'h'), 'start')])
            fill(score.measures[1], [pitched('D', 4, 'h'), pitched('E', 4, 'h')])
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            // The 4-beat logical D re-splits as 1 + 3, not as its old 2 + 2 written pieces.
            expect(shape(score.measures[0])).toEqual(['C4:h', 'D4:q:start'])
            expect(shape(score.measures[1])).toEqual(['D4:h.:stop'])
            expect(score.tiePartner(score.measures[0].notes[1])).toBe(score.measures[1].notes[0])
        })

        it('round-trips: change away and back restores the original notation', () => {
            const score = makeScore(1)
            fill(score.measures[0], [pitched('E', 4, 'w')])
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(shape(score.measures[0])).toEqual(['E4:h.:start'])
            expect(shape(score.measures[1])).toEqual(['E4:q:stop', 'r:q', 'r:q'])
            score.setTimeSignature(score.measures[0], new TimeSignature(4, 4))
            expect(shape(score.measures[0])).toEqual(['E4:w'])
        })

        it('a note spanning several measures ties through all of them', () => {
            const score = makeScore(1)
            fill(score.measures[0], [pitched('E', 4, 'w')])
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 8))
            expect(shape(score.measures[0])).toEqual(['E4:q.:start'])
            expect(shape(score.measures[1])).toEqual(['E4:q.:start-stop'])
            expect(shape(score.measures[2])).toEqual(['E4:q:stop', 'r:8'])
            expect(score.tiePartner(score.measures[0].notes[0])).toBe(score.measures[1].notes[0])
            expect(score.tiePartner(score.measures[1].notes[0])).toBe(score.measures[2].notes[0])
        })

        it('drops an unwritable residue and closes the tie at the last written piece', () => {
            const score = makeScore(1)
            const dotted8 = new Note({ duration: new Duration({ type: '8', dots: 1 }), pitch: new Pitch({ name: 'E', octave: 4 }) })
            const dotted16 = new Note({ duration: new Duration({ type: '16', dots: 1 }), pitch: new Pitch({ name: 'G', octave: 4 }) })
            fill(score.measures[0], [pitched('C', 4), pitched('D', 4), dotted8, dotted16, pitched('A', 4)])
            // The barline at beat 3 cuts the dotted 16th G a 16th in; its 32nd tail has no
            // written form, so it is dropped — G must NOT keep a tie into the unrelated A.
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(shape(score.measures[0])).toEqual(['C4:q', 'D4:q', 'E4:8.', 'G4:16'])
            expect(shape(score.measures[1])).toEqual(['A4:q', 'r:q', 'r:q'])
        })

        it('ties together the several written pieces of one chunk', () => {
            const score = makeScore(1)
            fill(score.measures[0], [pitched('D', 4, 'w')])
            score.setTimeSignature(score.measures[0], new TimeSignature(7, 8))
            // 3.5 beats decompose as dotted half + eighth, all one sustained note.
            expect(shape(score.measures[0])).toEqual(['D4:h.:start', 'D4:8:start-stop'])
            expect(shape(score.measures[1])[0]).toBe('D4:8:stop')
        })

        it('an exact fit closes the last measure without padding', () => {
            const score = makeScore(1)
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures).toHaveLength(2)
            expect(score.measures.every((m) => m.beats === 2)).toBe(true)
        })

        it('rebars an empty measure into a fully rested one', () => {
            const score = new Score()
            score.addMeasure() // never completed: no notes
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(score.measures).toHaveLength(1)
            expect(shape(score.measures[0])).toEqual(['r:q', 'r:q', 'r:q'])
            expect(score.measures[0].endBarline).toBe('end')
        })

        it('an empty leading measure is absorbed by the reflow', () => {
            const score = new Score()
            score.addMeasure() // empty
            score.addMeasure().complete()
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures).toHaveLength(2) // 4 beats of content, nothing for the empty bar
            expect(score.measures.every((m) => m.beats === 2)).toBe(true)
        })
    })

    describe('tuplets', () => {
        it('a tuplet group that fits flows intact, keeping note identities', () => {
            const score = makeScore(1)
            const group = [triplet('F', 4), triplet('G', 4), triplet('A', 4)]
            fill(score.measures[0], [pitched('C', 4), pitched('D', 4), pitched('E', 4), ...group])
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures[1].notes.slice(1)).toEqual(group)
            expect(score.measures[1].tuplets).toHaveLength(1)
            expect(score.measures[1].tuplets[0].notes).toEqual(group)
        })

        it('a straddling tuplet note splits into tied pieces that keep the ratio', () => {
            const score = makeScore(1)
            fill(score.measures[0], [
                pitched('C', 4, 'h'),
                pitched('D', 4, '8'),
                triplet('F', 4),
                triplet('G', 4),
                triplet('A', 4),
                rest('8'),
            ])
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(shape(score.measures[0])).toEqual(['C4:h', 'D4:8', 'F4:8', 'G4:16:start'])
            expect(shape(score.measures[1]).slice(0, 3)).toEqual(['G4:16:stop', 'A4:8', 'r:8'])
            expect(score.measures[0].notes[3].duration.ratio).toEqual({ actualNotes: 3, normalNotes: 2 })
            expect(score.measures[1].notes[0].duration.ratio).toEqual({ actualNotes: 3, normalNotes: 2 })
        })

        it('a tuplet straddling at an off-grid cut closes the measure short instead of dropping time', () => {
            const score = makeScore(1)
            const dotted = new Note({ duration: new Duration({ type: '8', dots: 1 }), pitch: new Pitch({ name: 'E', octave: 4 }) })
            // The barline at beat 3 cuts the F triplet a quarter beat in — written 0.375, which no
            // duration value expresses. Only a triplet 16th (1/6) fits; the residue must carry over.
            fill(score.measures[0], [
                pitched('C', 4),
                pitched('D', 4),
                dotted,
                triplet('F', 4),
                triplet('G', 4),
                triplet('A', 4),
                rest('16'),
            ])
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(shape(score.measures[0])).toEqual(['C4:q', 'D4:q', 'E4:8.', 'F4:16:start'])
            expect(shape(score.measures[1]).slice(0, 4)).toEqual(['F4:16:stop', 'G4:8', 'A4:8', 'r:16'])
            expect(score.tiePartner(score.measures[0].notes[3])).toBe(score.measures[1].notes[0])
            // The two F pieces together still span the full triplet eighth.
            const fBeats = score.measures[0].notes[3].duration.effectiveBeats + score.measures[1].notes[0].duration.effectiveBeats
            expect(fBeats).toBeCloseTo(1 / 3, 5)
            // The first measure closed short by the inexpressible remainder of the cut.
            expect(score.measures[0].beats).toBeCloseTo(3 - 1 / 12, 5)
        })

        it('a note after an off-grid cut moves whole into the next measure', () => {
            const score = makeScore(1)
            const sixteenthTriplet = new Note({
                duration: new Duration({ type: '16', ratio: { actualNotes: 3, normalNotes: 2 } }),
                pitch: new Pitch({ name: 'F', octave: 4 }),
            })
            // After the triplet 16th the measure has 1/12 beat left — nothing writable fits, so the
            // G lands intact at the start of the next measure rather than losing its tail.
            fill(score.measures[0], [
                pitched('C', 4),
                pitched('D', 4),
                new Note({ duration: new Duration({ type: '8', dots: 1 }), pitch: new Pitch({ name: 'E', octave: 4 }) }),
                sixteenthTriplet,
                pitched('G', 4),
            ])
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(shape(score.measures[0])).toEqual(['C4:q', 'D4:q', 'E4:8.', 'F4:16'])
            expect(score.measures[0].notes[3]).toBe(sixteenthTriplet)
            expect(shape(score.measures[1])).toEqual(['G4:q', 'r:q', 'r:q'])
        })

        it('changing back coalesces the split tuplet note and restores the group', () => {
            const score = makeScore(1)
            const [f, a] = [triplet('F', 4), triplet('A', 4)]
            fill(score.measures[0], [pitched('C', 4, 'h'), pitched('D', 4, '8'), f, triplet('G', 4), a, rest('8')])
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            score.setTimeSignature(score.measures[0], new TimeSignature(4, 4))
            expect(shape(score.measures[0])).toEqual(['C4:h', 'D4:8', 'F4:8', 'G4:8', 'A4:8', 'r:8'])
            expect(score.measures[0].notes[3].duration.ratio).toEqual({ actualNotes: 3, normalNotes: 2 })
            expect(score.measures[0].notes[2]).toBe(f) // untouched group members keep identity
            expect(score.measures[0].notes[4]).toBe(a)
        })
    })

    describe('coalescing guards (what does NOT merge)', () => {
        /** Two-measure 4/4 score whose boundary pair is (last, first); rebar to 3/4 pushes both into new measures. */
        function boundaryPair(last: Note, first: Note): { score: Score; last: Note; first: Note } {
            const score = makeScore(2)
            fill(score.measures[0], [pitched('C', 4, 'h'), pitched('D', 4), last])
            fill(score.measures[1], [first, pitched('B', 4), pitched('A', 4, 'h')])
            return { score, last, first }
        }

        function expectNotCoalesced({ score, last, first }: { score: Score; last: Note; first: Note }) {
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            // Un-merged units of one beat each never straddle a 3-beat bar, so both survive by identity.
            expect(score.measures[1].notes[0]).toBe(last)
            expect(score.measures[1].notes[1]).toBe(first)
        }

        it('a tie into a different pitch name stays split', () => {
            expectNotCoalesced(boundaryPair(tied(pitched('E', 4), 'start'), pitched('F', 4)))
        })

        it('a tie into a different octave stays split', () => {
            expectNotCoalesced(boundaryPair(tied(pitched('E', 4), 'start'), pitched('E', 5)))
        })

        it('a tie into a different alteration stays split', () => {
            const sharp = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'E', octave: 4, alter: 1 }) })
            expectNotCoalesced(boundaryPair(tied(pitched('E', 4), 'start'), sharp))
        })

        it('a tied rest never merges', () => {
            expectNotCoalesced(boundaryPair(tied(rest('q'), 'start'), pitched('E', 4)))
        })

        it('a tie into a rest never merges', () => {
            expectNotCoalesced(boundaryPair(tied(pitched('E', 4), 'start'), rest('q')))
        })

        it('an untied boundary never merges', () => {
            expectNotCoalesced(boundaryPair(pitched('E', 4), pitched('E', 4)))
        })

        it('a tie from a tuplet into a plain note stays split', () => {
            const score = makeScore(2)
            const last = tied(triplet('E', 4), 'start')
            const first = pitched('E', 4)
            fill(score.measures[0], [pitched('C', 4), pitched('D', 4), pitched('F', 4), triplet('E', 4), triplet('E', 4), last])
            fill(score.measures[1], [first, rest('q'), rest('h')])
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures[1].notes).toContain(last)
            expect(score.measures[2].notes[0]).toBe(first)
        })

        it('a tie between different tuplet ratios stays split', () => {
            const score = makeScore(2)
            const last = tied(triplet('E', 4), 'start')
            const first = new Note({
                duration: new Duration({ type: '8', ratio: { actualNotes: 3, normalNotes: 4 } }),
                pitch: new Pitch({ name: 'E', octave: 4 }),
            })
            fill(score.measures[0], [pitched('C', 4), pitched('D', 4), pitched('F', 4), triplet('E', 4), triplet('E', 4), last])
            fill(score.measures[1], [first])
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures[1].notes).toContain(last)
            expect(score.measures[2].notes[0]).toBe(first)
        })
    })

    describe('clef / key / tempo marks', () => {
        it('an explicit leading clef stays explicit on the run start', () => {
            const score = makeScore(2)
            score.setClef(score.measures[0].firstNote, 'bass')
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures[0].leadingClefExplicit).toBe(true)
            expect(score.measures.every((m) => m.clef.type === 'bass')).toBe(true)
        })

        it('a mid-measure clef landing on a new barline becomes an explicit leading clef', () => {
            const score = makeScore(2)
            score.setClef(score.measures[0].notes[2], 'bass') // beat 2
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures[0].clef.type).toBe('treble')
            expect(score.measures[1].clef.type).toBe('bass')
            expect(score.measures[1].leadingClefExplicit).toBe(true)
        })

        it('marks re-anchor at their absolute beat: mid-measure clef, key and tempo', () => {
            const score = makeScore(2)
            score.setClef(score.measures[0].notes[2], 'bass') // absolute beat 2
            score.setKeySignature(score.measures[0].notes[2], 2) // absolute beat 2 (mid-measure key)
            score.measures[1].setTempo(2, 100) // absolute beat 6
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(score.measures[0].clefAtBeat(2)?.type).toBe('bass')
            expect(score.measures[0].keyAtBeat(2)?.fifths).toBe(2)
            expect(score.measures[2].tempoAtBeat(0)?.bpm).toBe(100)
        })

        it('an explicit leading key re-anchors, stays explicit and carries forward', () => {
            const score = makeScore(3)
            score.setKeySignature(score.measures[1].firstNote, 3)
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures).toHaveLength(6)
            expect(score.measures[2].leadingKeyExplicit).toBe(true)
            expect(score.measures.map((m) => m.keySignature.fifths)).toEqual([0, 0, 3, 3, 3, 3])
        })

        it('a mid-landing clef is checked against the true carried context, not a placeholder', () => {
            const score = makeScore(2)
            score.setClef(score.measures[0].firstNote, 'bass') // explicit leading bass
            score.setClef(score.measures[1].notes[1], 'treble') // change back at absolute beat 5
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            // Absolute beat 5 → measure 2, beat 1. The carried clef there is bass, so the
            // treble change is a real one and must survive the redundancy check.
            expect(score.measures[2].clefAtBeat(1)?.type).toBe('treble')
            expect(score.measures[3].clef.type).toBe('treble')
        })

        it('a trailing clef stored past the last barline re-anchors onto the final measure', () => {
            const score = makeScore(1)
            score.measures[0].addClef(4, 'bass')
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures[1].clefAtBeat(2)?.type).toBe('bass')
        })
    })

    describe('barlines', () => {
        it('an interior explicit barline survives when its boundary still exists', () => {
            const score = makeScore(4)
            score.measures[1].setEndBarline('double')
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures[3].endBarline).toBe('double') // absolute beat 8 → 4th 2/4 measure
            expect(score.measures[7].endBarline).toBe('end')
        })

        it('an interior explicit barline is dropped when its boundary vanishes', () => {
            const score = makeScore(2)
            score.measures[0].setEndBarline('double')
            score.setTimeSignature(score.measures[0], new TimeSignature(3, 4))
            expect(score.measures.every((m) => m.endBarline !== 'double')).toBe(true)
        })

        it('an interior barline rounding to the run start is dropped', () => {
            const score = makeScore(2)
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            score.measures[0].setEndBarline('double') // absolute beat 2
            score.setTimeSignature(score.measures[0], new TimeSignature(12, 8)) // capacity 6: rounds to boundary 0
            expect(score.measures.every((m) => m.endBarline !== 'double')).toBe(true)
        })

        it('an interior barline rounding to the final boundary is dropped', () => {
            const score = makeScore(2)
            score.measures[0].setEndBarline('double') // absolute beat 4
            score.setTimeSignature(score.measures[0], new TimeSignature(8, 4)) // one 8-beat measure
            expect(score.measures).toHaveLength(1)
            expect(score.measures[0].endBarline).toBe('end')
        })

        it('a run without a final barline style falls back to "end" at the score end', () => {
            const score = makeScore(1)
            score.measures[0].setEndBarline(undefined)
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures[1].endBarline).toBe('end')
        })

        it('a mid-score run without a final barline style falls back to "single"', () => {
            const score = makeScore(2)
            score.setTimeSignature(score.measures[1], new TimeSignature(3, 4))
            score.measures[0].setEndBarline(undefined)
            score.setTimeSignature(score.measures[0], new TimeSignature(2, 4))
            expect(score.measures[1].endBarline).toBe('single')
        })
    })

    describe('serialization', () => {
        it('a rebarred score round-trips through MusicXML', () => {
            const score = makeScore(3)
            fill(score.measures[0], [pitched('C', 4), pitched('D', 4), pitched('E', 4, 'h')])
            score.setTimeSignature(score.measures[1], new TimeSignature(3, 4))
            const restored = new ScoreDeserializer(new ScoreSerializer(score).toInput()).toScore()
            expect(restored.measures).toHaveLength(score.measures.length)
            expect(restored.measures.map((m) => m.timeSignature.maxBeats)).toEqual(score.measures.map((m) => m.timeSignature.maxBeats))
            restored.measures.forEach((m, i) => expect(shape(m)).toEqual(shape(score.measures[i])))
        })
    })
})
