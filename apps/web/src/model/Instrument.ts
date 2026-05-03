/**
 * Score-level instrument. Each instance maps a human display name to a General
 * MIDI program number and the soundfont preset name used by smplr to fetch
 * samples from the FluidR3_GM CDN. Many of the listed instruments do not exist
 * in General MIDI — those resolve to the closest GM patch (e.g. erhu → fiddle,
 * dizi flute → flute, baritone horn → tuba, tin whistle → whistle).
 */
export class Instrument {
    private static _all: Instrument[] = []
    private static _byId: Map<string, Instrument> = new Map()

    private constructor(
        readonly id: string,
        readonly displayName: string,
        readonly gmProgram: number,
        readonly presetName: string,
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

    static readonly AltoClarinet = new Instrument('alto-clarinet', 'Alto Clarinet', 71, 'clarinet')
    static readonly AltoFlute = new Instrument('alto-flute', 'Alto Flute', 73, 'flute')
    static readonly AltoRecorderInF = new Instrument('alto-recorder-in-f', 'Alto Recorder in F', 74, 'recorder')
    static readonly AltoSaxophone = new Instrument('alto-saxophone', 'Alto Saxophone', 65, 'alto_sax')
    static readonly Bagpipe = new Instrument('bagpipe', 'Bagpipe', 109, 'bagpipe')
    static readonly BaritoneHorn = new Instrument('baritone-horn', 'Baritone Horn', 58, 'tuba')
    static readonly BaritoneHornTreble = new Instrument('baritone-horn-treble', 'Baritone Horn Treble', 58, 'tuba')
    static readonly BaritoneSaxophone = new Instrument('baritone-saxophone', 'Baritone Saxophone', 67, 'baritone_sax')
    static readonly BassClarinet = new Instrument('bass-clarinet', 'Bass Clarinet', 71, 'clarinet')
    static readonly Bassoon = new Instrument('bassoon', 'Bassoon', 70, 'bassoon')
    static readonly Brass = new Instrument('brass', 'Brass', 61, 'brass_section')
    static readonly Cello = new Instrument('cello', 'Cello', 42, 'cello')
    static readonly Clarinet = new Instrument('clarinet', 'Clarinet', 71, 'clarinet')
    static readonly ClarinetEnsemble = new Instrument('clarinet-ensemble', 'Clarinet Ensemble', 71, 'clarinet')
    static readonly ConcertClarinet = new Instrument('concert-clarinet', 'Concert Clarinet', 71, 'clarinet')
    static readonly Contrabass = new Instrument('contrabass', 'Contrabass', 43, 'contrabass')
    static readonly ContrabassClarinet = new Instrument('contrabass-clarinet', 'Contrabass Clarinet', 71, 'clarinet')
    static readonly Contrabassoon = new Instrument('contrabassoon', 'Contrabassoon', 70, 'bassoon')
    static readonly DiziFlute = new Instrument('dizi-flute', 'Dizi Flute', 73, 'flute')
    static readonly EnglishHorn = new Instrument('english-horn', 'English Horn', 69, 'english_horn')
    static readonly Erhu = new Instrument('erhu', 'Erhu', 110, 'fiddle')
    static readonly Euphonium = new Instrument('euphonium', 'Euphonium', 58, 'tuba')
    static readonly Flute = new Instrument('flute', 'Flute', 73, 'flute')
    static readonly FrenchHorn = new Instrument('french-horn', 'French Horn', 60, 'french_horn')
    static readonly Harmonica = new Instrument('harmonica', 'Harmonica', 22, 'harmonica')
    static readonly Horn = new Instrument('horn', 'Horn', 60, 'french_horn')
    static readonly HornInC = new Instrument('horn-in-c', 'Horn in C', 60, 'french_horn')
    static readonly HornInD = new Instrument('horn-in-d', 'Horn in D', 60, 'french_horn')
    static readonly Oboe = new Instrument('oboe', 'Oboe', 68, 'oboe')
    static readonly Ocarina = new Instrument('ocarina', 'Ocarina', 79, 'ocarina')
    static readonly OrchestralFlute = new Instrument('orchestral-flute', 'Orchestral Flute', 73, 'flute')
    static readonly PanFlute = new Instrument('pan-flute', 'Pan Flute', 75, 'pan_flute')
    static readonly Piccolo = new Instrument('piccolo', 'Piccolo', 72, 'piccolo')
    static readonly Recorder = new Instrument('recorder', 'Recorder', 74, 'recorder')
    static readonly ShakuhachiFlute = new Instrument('shakuhachi-flute', 'Shakuhachi Flute', 77, 'shakuhachi')
    static readonly SopranoSaxophone = new Instrument('soprano-saxophone', 'Soprano Saxophone', 64, 'soprano_sax')
    static readonly TenorSaxophone = new Instrument('tenor-saxophone', 'Tenor Saxophone', 66, 'tenor_sax')
    static readonly TinWhistle = new Instrument('tin-whistle', 'Tin Whistle', 78, 'whistle')
    static readonly TraditionalFlute = new Instrument('traditional-flute', 'Traditional Flute', 73, 'flute')
    static readonly Trombone = new Instrument('trombone', 'Trombone', 57, 'trombone')
    static readonly Trumpet = new Instrument('trumpet', 'Trumpet', 56, 'trumpet')
    static readonly Tuba = new Instrument('tuba', 'Tuba', 58, 'tuba')
    static readonly Viola = new Instrument('viola', 'Viola', 41, 'viola')
    static readonly Violin = new Instrument('violin', 'Violin', 40, 'violin')
    static readonly ViolinLead = new Instrument('violin-lead', 'Violin Lead', 40, 'violin')
    static readonly Violoncello = new Instrument('violoncello', 'Violoncello', 42, 'cello')
    static readonly VoiceLead = new Instrument('voice-lead', 'Voice Lead', 53, 'voice_oohs')

    /** Used by the metronome click. Not a score-selectable instrument. */
    static readonly Woodblock = new Instrument('woodblock', 'Woodblock', 115, 'woodblock')
}
