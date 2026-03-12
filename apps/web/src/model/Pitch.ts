const NOTE_INDEX: Record<string, number> = {
    C: 0,
    D: 1,
    E: 2,
    F: 3,
    G: 4,
    A: 5,
    B: 6,
}

const INDEX_TO_NOTE = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

export class Pitch {
    readonly name: string
    readonly accidental: string | undefined
    readonly octave: number

    constructor(value: { name: string; accidental?: string | undefined; octave: number }) {
        this.name = value.name
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
        return new Pitch({ name: this.name, accidental, octave: this.octave })
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

    static fromLine(line: number): Pitch {
        const totalSteps = line * 2 + 28
        const octave = Math.floor(totalSteps / 7)
        const noteIndex = totalSteps - octave * 7
        return new Pitch({ name: INDEX_TO_NOTE[noteIndex], octave })
    }
}
