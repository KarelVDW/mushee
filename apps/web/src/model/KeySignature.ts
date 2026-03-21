/** Order of sharps and flats in key signatures */
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const

export class KeySignature {
    readonly fifths: number
    readonly mode: string | undefined

    constructor(fifths: number, mode?: string) {
        this.fifths = fifths
        this.mode = mode
    }

    /** Note names that are sharp in this key */
    get sharps(): string[] {
        if (this.fifths <= 0) return []
        return SHARP_ORDER.slice(0, this.fifths) as unknown as string[]
    }

    /** Note names that are flat in this key */
    get flats(): string[] {
        if (this.fifths >= 0) return []
        return FLAT_ORDER.slice(0, -this.fifths) as unknown as string[]
    }

    /** Check if a given note name is altered by this key signature */
    alterForNote(noteName: string): number {
        if (this.sharps.includes(noteName)) return 1
        if (this.flats.includes(noteName)) return -1
        return 0
    }
}
