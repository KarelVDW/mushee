/** A pitch's letter name — MusicXML's `<step>`. */
export type PitchStep = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

const NOTE_INDEX: Record<PitchStep, number> = {
    C: 0,
    D: 1,
    E: 2,
    F: 3,
    G: 4,
    A: 5,
    B: 6,
}

const SEMITONES: Record<PitchStep, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const INDEX_TO_NOTE: readonly PitchStep[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** An accidental token, as the editor names an alteration: sharp, flat, their doubles, and natural. */
export type Accidental = '#' | 'b' | '##' | 'bb' | 'n'

/** The one accidental vocabulary: each token with its semitone alteration and SMuFL glyph. */
const ACCIDENTALS: ReadonlyArray<{ token: Accidental; alter: number; glyph: string }> = [
    { token: '#', alter: 1, glyph: 'accidentalSharp' },
    { token: 'b', alter: -1, glyph: 'accidentalFlat' },
    { token: '##', alter: 2, glyph: 'accidentalDoubleSharp' },
    { token: 'bb', alter: -2, glyph: 'accidentalDoubleFlat' },
    { token: 'n', alter: 0, glyph: 'accidentalNatural' },
]

/**
 * A written pitch: letter name, alteration in semitones and octave — exactly what
 * MusicXML's `<pitch>` stores. Whether an accidental is *drawn* is not part of the
 * pitch: the layout layer decides that in context (key, earlier notes in the bar).
 */
export class Pitch {
    readonly name: PitchStep
    readonly alter: number
    readonly octave: number

    constructor(value: { name: PitchStep; alter?: number; octave: number }) {
        this.name = value.name
        this.alter = value.alter ?? 0
        this.octave = value.octave
    }

    /**
     * Diatonic staff line in the treble reference frame (line 0 = C4, line 2 = G4).
     * This is the pitch's intrinsic position; a clef's vertical offset is applied
     * on top of it by {@link Clef.lineFor}.
     */
    get line(): number {
        const baseIndex = this.octave * 7 - 28
        return (baseIndex + NOTE_INDEX[this.name]) / 2
    }

    raised(): Pitch {
        return Pitch.fromLine(this.line + 0.5)
    }

    lowered(): Pitch {
        return Pitch.fromLine(this.line - 0.5)
    }

    withAccidental(accidental: Accidental | undefined): Pitch {
        return new Pitch({ name: this.name, alter: Pitch.accidentalToAlter(accidental), octave: this.octave })
    }

    /** SMuFL glyph name for a given alteration (0 → natural, shown only when it cancels a prior accidental). */
    static glyphForAlter(alter: number): string | undefined {
        return ACCIDENTALS.find((a) => a.alter === alter)?.glyph
    }

    /** Semitone alteration of a token; no token (and 'n') is natural. */
    static accidentalToAlter(accidental: Accidental | undefined): number {
        return ACCIDENTALS.find((a) => a.token === accidental)?.alter ?? 0
    }

    /**
     * The accidental token ('#', 'b', '##', 'bb', or undefined for natural) of this pitch's
     * alteration — what the editor's accidental control reflects, independent of whether an
     * accidental is actually drawn (a key-spelled F♯ in G major draws none).
     */
    get accidental(): Accidental | undefined {
        return Pitch.alterToAccidental(this.alter)
    }

    /**
     * Whether `other` is the same written note: same letter, alteration and octave. Enharmonic
     * equivalents (C♯/D♭) sound alike but are spelled differently — compare `toMidi()` for sound.
     */
    spelledLike(other: Pitch): boolean {
        return this.name === other.name && this.alter === other.alter && this.octave === other.octave
    }

    toMidi(): number {
        // The fallback (and transposed's throw) stay although the type rules an unknown step
        // out: stored score JSON reaches Pitch without runtime validation.
        return (this.octave + 1) * 12 + (SEMITONES[this.name] ?? 0) + this.alter
    }

    static fromLine(line: number): Pitch {
        const totalSteps = line * 2 + 28
        const octave = Math.floor(totalSteps / 7)
        const noteIndex = totalSteps - octave * 7
        return new Pitch({ name: INDEX_TO_NOTE[noteIndex], octave })
    }

    /** The same pitch class, `octaves` whole octaves away — spelling preserved. */
    octaveShifted(octaves: number): Pitch {
        if (!octaves) return this
        return new Pitch({ name: this.name, alter: this.alter, octave: this.octave + octaves })
    }

    /**
     * Transpose by the given (chromatic, diatonic) interval. Convention matches
     * MusicXML's `<transpose>` element: the diatonic value shifts the letter
     * step (e.g. C → D = +1, C → E = +2) while chromatic shifts the absolute
     * pitch in semitones. The resulting alter is derived from the difference
     * between the actual MIDI and the natural MIDI of the new step.
     */
    transposed(chromatic: number, diatonic: number): Pitch {
        const oldStepIdx = NOTE_INDEX[this.name]
        if (oldStepIdx === undefined) throw new Error(`Unknown step name: ${this.name}`)

        const oldDiatonicPosition = this.octave * 7 + oldStepIdx
        const newDiatonicPosition = oldDiatonicPosition + diatonic
        const newOctave = Math.floor(newDiatonicPosition / 7)
        const newStepIdx = newDiatonicPosition - newOctave * 7
        const newName = INDEX_TO_NOTE[newStepIdx]

        const newMidi = this.toMidi() + chromatic
        const newNaturalMidi = (newOctave + 1) * 12 + SEMITONES[newName]
        const newAlter = newMidi - newNaturalMidi

        return new Pitch({ name: newName, alter: newAlter, octave: newOctave })
    }

    /**
     * Every single-accidental spelling of a MIDI pitch — one candidate per letter name whose
     * required alteration stays within ±1 (each pitch class yields one to three: e.g. MIDI 61
     * → C♯4 and D♭4; MIDI 60 → C4 and B♯3). Double-accidental spellings are deliberately
     * excluded: they exist only to preserve voice-leading the respeller is asked to undo.
     */
    static spellingsOf(midi: number): Pitch[] {
        const result: Pitch[] = []
        for (const name of INDEX_TO_NOTE) {
            const octave = Math.round((midi - SEMITONES[name]) / 12) - 1
            const alter = midi - ((octave + 1) * 12 + SEMITONES[name])
            if (alter >= -1 && alter <= 1) {
                result.push(new Pitch({ name, alter, octave }))
            }
        }
        return result
    }

    /**
     * Accidental token for an alteration ('#', 'b', '##', 'bb'). Natural is the absence of a
     * token, so 0 gives undefined, not 'n' — as does an alteration no token writes.
     */
    static alterToAccidental(alter: number): Accidental | undefined {
        if (alter === 0) return undefined
        return ACCIDENTALS.find((a) => a.alter === alter)?.token
    }
}
