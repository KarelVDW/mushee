const NOTE_INDEX: Record<string, number> = {
    C: 0,
    D: 1,
    E: 2,
    F: 3,
    G: 4,
    A: 5,
    B: 6,
}

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const INDEX_TO_NOTE = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

export class Pitch {
    readonly name: string
    readonly alter: number
    readonly accidental: string | undefined
    readonly octave: number

    constructor(value: { name: string; alter?: number; accidental?: string | undefined; octave: number }) {
        this.name = value.name
        this.alter = value.alter ?? 0
        this.accidental = value.accidental
        this.octave = value.octave
    }

    get line(): number {
        const noteIndex = NOTE_INDEX[this.name]
        const baseIndex = this.octave * 7 - 28
        const line = (baseIndex + noteIndex) / 2
        // if (clef === 'bass') return line - 6
        return line
    }

    raised(): Pitch {
        return Pitch.fromLine(this.line + 0.5)
    }

    lowered(): Pitch {
        return Pitch.fromLine(this.line - 0.5)
    }

    withAccidental(accidental: string | undefined): Pitch {
        return new Pitch({ name: this.name, alter: Pitch.accidentalToAlter(accidental), accidental, octave: this.octave })
    }

    static accidentalToAlter(accidental: string | undefined): number {
        switch (accidental) {
            case '#':
                return 1
            case 'b':
                return -1
            case '##':
                return 2
            case 'bb':
                return -2
            case 'n':
                return 0
            default:
                return 0
        }
    }

    get accidentalGlyph(): string | undefined {
        switch (this.accidental) {
            case '#':
                return 'accidentalSharp'
            case 'b':
                return 'accidentalFlat'
            case '##':
                return 'accidentalDoubleSharp'
            case 'bb':
                return 'accidentalDoubleFlat'
            case 'n':
                return 'accidentalNatural'
            default:
                return undefined
        }
    }

    toMidi(): number {
        return (this.octave + 1) * 12 + (SEMITONES[this.name] ?? 0) + this.alter
    }

    static fromLine(line: number): Pitch {
        const totalSteps = line * 2 + 28
        const octave = Math.floor(totalSteps / 7)
        const noteIndex = totalSteps - octave * 7
        return new Pitch({ name: INDEX_TO_NOTE[noteIndex], octave })
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

        return new Pitch({
            name: newName,
            alter: newAlter,
            accidental: Pitch.alterToAccidentalGlyph(newAlter),
            octave: newOctave,
        })
    }

    private static alterToAccidentalGlyph(alter: number): string | undefined {
        switch (alter) {
            case 1:
                return '#'
            case -1:
                return 'b'
            case 2:
                return '##'
            case -2:
                return 'bb'
            default:
                return undefined
        }
    }
}
