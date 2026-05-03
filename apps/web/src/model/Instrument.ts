/**
 * Score-level instrument. Carries the General MIDI program number, the smplr
 * preset name (sample bank), and the part-level transposition that maps written
 * pitch (what the musician reads on the page) to sounding pitch (what the
 * audience hears). Convention: `sounding = written + chromaticTranspose`. The
 * companion `diatonicTranspose` records the same interval in letter steps —
 * required to spell transposed pitches and key signatures correctly.
 *
 * Many of the user-listed instruments do not exist in General MIDI; those
 * resolve to the closest GM patch (e.g. erhu → fiddle, dizi → flute, baritone
 * horn → tuba, tin whistle → whistle).
 */
export class Instrument {
    private static _all: Instrument[] = []
    private static _byId: Map<string, Instrument> = new Map()

    private constructor(
        readonly id: string,
        readonly displayName: string,
        readonly gmProgram: number,
        readonly presetName: string,
        readonly chromaticTranspose: number = 0,
        readonly diatonicTranspose: number = 0,
    ) {
        Instrument._all.push(this)
        Instrument._byId.set(id, this)
    }

    static all(): ReadonlyArray<Instrument> {
        return Instrument._all
    }

    /** Instruments offered to the user when picking a score's lead voice — excludes percussion-only patches like Woodblock. */
    static selectable(): ReadonlyArray<Instrument> {
        return Instrument._all.filter((i) => i !== Instrument.Woodblock)
    }

    static byId(id: string): Instrument | undefined {
        return Instrument._byId.get(id)
    }

    /** Resolve by GM program number (1-indexed in MusicXML, 0-indexed here). Returns Piano if unknown. */
    static byGmProgram(program: number): Instrument {
        return Instrument._all.find((i) => i.gmProgram === program) ?? Instrument.Piano
    }

    /** Resolve by display name, case-insensitive. Falls back to Piano. */
    static byDisplayName(name: string): Instrument {
        const lower = name.trim().toLowerCase()
        return Instrument._all.find((i) => i.displayName.toLowerCase() === lower) ?? Instrument.Piano
    }

    /** Default; also used as the fallback for unknown ids. */
    static readonly Piano = new Instrument('piano', 'Piano', 0, 'acoustic_grand_piano')

    // Concert-pitch instruments — written = sounding, no transposition.
    static readonly Bagpipe = new Instrument('bagpipe', 'Bagpipe', 109, 'bagpipe')
    static readonly BaritoneHorn = new Instrument('baritone-horn', 'Baritone Horn', 58, 'tuba')
    static readonly Bassoon = new Instrument('bassoon', 'Bassoon', 70, 'bassoon')
    static readonly Brass = new Instrument('brass', 'Brass', 61, 'brass_section')
    static readonly Cello = new Instrument('cello', 'Cello', 42, 'cello')
    static readonly DiziFlute = new Instrument('dizi-flute', 'Dizi Flute', 73, 'flute')
    static readonly Erhu = new Instrument('erhu', 'Erhu', 110, 'fiddle')
    static readonly Euphonium = new Instrument('euphonium', 'Euphonium', 58, 'tuba')
    static readonly Flute = new Instrument('flute', 'Flute', 73, 'flute')
    static readonly Harmonica = new Instrument('harmonica', 'Harmonica', 22, 'harmonica')
    static readonly HornInC = new Instrument('horn-in-c', 'Horn in C', 60, 'french_horn')
    static readonly Oboe = new Instrument('oboe', 'Oboe', 68, 'oboe')
    static readonly Ocarina = new Instrument('ocarina', 'Ocarina', 79, 'ocarina')
    static readonly OrchestralFlute = new Instrument('orchestral-flute', 'Orchestral Flute', 73, 'flute')
    static readonly PanFlute = new Instrument('pan-flute', 'Pan Flute', 75, 'pan_flute')
    static readonly Recorder = new Instrument('recorder', 'Recorder', 74, 'recorder')
    static readonly AltoRecorderInF = new Instrument('alto-recorder-in-f', 'Alto Recorder in F', 74, 'recorder')
    static readonly ShakuhachiFlute = new Instrument('shakuhachi-flute', 'Shakuhachi Flute', 77, 'shakuhachi')
    static readonly TinWhistle = new Instrument('tin-whistle', 'Tin Whistle', 78, 'whistle')
    static readonly TraditionalFlute = new Instrument('traditional-flute', 'Traditional Flute', 73, 'flute')
    static readonly Trombone = new Instrument('trombone', 'Trombone', 57, 'trombone')
    static readonly Tuba = new Instrument('tuba', 'Tuba', 58, 'tuba')
    static readonly Viola = new Instrument('viola', 'Viola', 41, 'viola')
    static readonly Violin = new Instrument('violin', 'Violin', 40, 'violin')
    static readonly ViolinLead = new Instrument('violin-lead', 'Violin Lead', 40, 'violin')
    static readonly Violoncello = new Instrument('violoncello', 'Violoncello', 42, 'cello')
    static readonly VoiceLead = new Instrument('voice-lead', 'Voice Lead', 53, 'voice_oohs')

    // B♭ instruments — written sounds a major 2nd lower (chromatic −2, diatonic −1).
    static readonly Clarinet = new Instrument('clarinet', 'Clarinet', 71, 'clarinet', -2, -1)
    static readonly ClarinetEnsemble = new Instrument('clarinet-ensemble', 'Clarinet Ensemble', 71, 'clarinet', -2, -1)
    static readonly ConcertClarinet = new Instrument('concert-clarinet', 'Concert Clarinet', 71, 'clarinet', -2, -1)
    static readonly SopranoSaxophone = new Instrument('soprano-saxophone', 'Soprano Saxophone', 64, 'soprano_sax', -2, -1)
    static readonly Trumpet = new Instrument('trumpet', 'Trumpet', 56, 'trumpet', -2, -1)

    // E♭ instruments — written sounds a major 6th lower (chromatic −9, diatonic −5).
    static readonly AltoClarinet = new Instrument('alto-clarinet', 'Alto Clarinet', 71, 'clarinet', -9, -5)
    static readonly AltoSaxophone = new Instrument('alto-saxophone', 'Alto Saxophone', 65, 'alto_sax', -9, -5)

    // F instruments — written sounds a perfect 5th lower (chromatic −7, diatonic −4).
    static readonly EnglishHorn = new Instrument('english-horn', 'English Horn', 69, 'english_horn', -7, -4)
    static readonly FrenchHorn = new Instrument('french-horn', 'French Horn', 60, 'french_horn', -7, -4)
    static readonly Horn = new Instrument('horn', 'Horn', 60, 'french_horn', -7, -4)

    // G instrument — written sounds a perfect 4th lower (chromatic −5, diatonic −3).
    static readonly AltoFlute = new Instrument('alto-flute', 'Alto Flute', 73, 'flute', -5, -3)

    // Horn in D — sounds a minor 7th below written (chromatic −10, diatonic −6). Uses the natural-horn (low D crook) interpretation common in classical scores.
    static readonly HornInD = new Instrument('horn-in-d', 'Horn in D', 60, 'french_horn', -10, -6)

    // Octave transpositions.
    static readonly Piccolo = new Instrument('piccolo', 'Piccolo', 72, 'piccolo', 12, 7)
    static readonly Contrabass = new Instrument('contrabass', 'Contrabass', 43, 'contrabass', -12, -7)
    static readonly Contrabassoon = new Instrument('contrabassoon', 'Contrabassoon', 70, 'bassoon', -12, -7)

    // Major-9th-down instruments — written sounds an octave + major 2nd lower.
    static readonly BaritoneHornTreble = new Instrument('baritone-horn-treble', 'Baritone Horn Treble', 58, 'tuba', -14, -8)
    static readonly BassClarinet = new Instrument('bass-clarinet', 'Bass Clarinet', 71, 'clarinet', -14, -8)
    static readonly TenorSaxophone = new Instrument('tenor-saxophone', 'Tenor Saxophone', 66, 'tenor_sax', -14, -8)

    // Octave + major 6th down — baritone sax in E♭.
    static readonly BaritoneSaxophone = new Instrument('baritone-saxophone', 'Baritone Saxophone', 67, 'baritone_sax', -21, -12)

    // Two octaves + major 2nd down — contrabass clarinet in B♭.
    static readonly ContrabassClarinet = new Instrument('contrabass-clarinet', 'Contrabass Clarinet', 71, 'clarinet', -26, -15)

    /** Used by the metronome click. Not a score-selectable instrument. */
    static readonly Woodblock = new Instrument('woodblock', 'Woodblock', 115, 'woodblock')
}
