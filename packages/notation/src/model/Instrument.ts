import type { Pitch } from './Pitch'

/** User-facing instrument family, used to group every instrument picker in the app. */
export type InstrumentCategory = 'Keyboard' | 'Strings' | 'Woodwinds' | 'Brass' | 'Voice' | 'Folk & World' | 'Percussion'

/** The optional parts of an instrument's definition. */
interface InstrumentTraits {
    /**
     * False for a duplicate or section patch (Violin Lead beside Violin, a brass section): it
     * stays registered, so saved scores and imports still load it, but pickers leave it out.
     */
    pickable?: boolean
    /** The instrument is commonly played in chords (keyboards, guitar, harmonica) — see {@link Instrument.playsChords}. */
    playsChords?: boolean
    /** Display names the instrument used to carry, still matched by {@link Instrument.findByDisplayName}. */
    legacyNames?: ReadonlyArray<string>
}

/** The traits of a duplicate or section patch: registered for loading, left out of pickers. */
const HIDDEN: InstrumentTraits = { pickable: false }

/**
 * Score-level instrument. Carries the General MIDI program number, the smplr
 * preset name (sample bank), the user-facing family it belongs to, and the
 * part-level transposition that maps written pitch (what the musician reads on
 * the page) to sounding pitch (what the audience hears). Convention:
 * `sounding = written + chromaticTranspose`. The companion `diatonicTranspose`
 * records the same interval in letter steps — required to spell transposed
 * pitches and key signatures correctly.
 *
 * Many of the user-listed instruments do not exist in General MIDI; those
 * resolve to the closest GM patch (e.g. erhu → fiddle, dizi → flute, baritone
 * horn → tuba, tin whistle → whistle).
 *
 * The display name is user copy and may change; the id never does (the API keys its
 * transcription profiles on it). A renamed instrument keeps its old name in `legacyNames`,
 * because saved scores and foreign MusicXML resolve their instrument by name.
 */
export class Instrument {
    private static _all: Instrument[] = []
    private static _byId: Map<string, Instrument> = new Map()

    /** Picker display order, the singer's family first. Percussion is registry-only (the metronome click); `selectable()` leaves it out. */
    private static readonly _categoryOrder: InstrumentCategory[] = ['Voice', 'Keyboard', 'Strings', 'Woodwinds', 'Brass', 'Folk & World']

    private readonly _pickable: boolean
    private readonly _playsChords: boolean
    /** Display names the instrument used to carry; {@link findByDisplayName} still resolves them. */
    readonly legacyNames: ReadonlyArray<string>

    private constructor(
        readonly id: string,
        readonly displayName: string,
        readonly category: InstrumentCategory,
        readonly gmProgram: number,
        readonly presetName: string,
        readonly chromaticTranspose: number = 0,
        readonly diatonicTranspose: number = 0,
        traits: InstrumentTraits = {},
    ) {
        this._pickable = traits.pickable ?? true
        this._playsChords = traits.playsChords ?? false
        this.legacyNames = traits.legacyNames ?? []
        Instrument._all.push(this)
        Instrument._byId.set(id, this)
    }

    /**
     * Whether the instrument is commonly played in chords: keyboards, guitar, harmonica. Solkey
     * writes melodies, one note at a time, so the app says so when one of these is picked.
     */
    get playsChords(): boolean {
        return this._playsChords
    }

    /** Whether pickers offer the instrument: not a percussion patch, and not a duplicate kept only for loading. */
    get isPickable(): boolean {
        return this._pickable && this.category !== 'Percussion'
    }

    /**
     * Every instrument a score can carry — excludes percussion-only patches like Woodblock. It
     * includes the duplicates pickers hide (see {@link pickable}), which saved scores and imports use.
     */
    static selectable(): ReadonlyArray<Instrument> {
        return Instrument._all.filter((i) => i.category !== 'Percussion')
    }

    /** The instruments pickers offer: {@link selectable} without the duplicates and section patches. */
    static pickable(): ReadonlyArray<Instrument> {
        return Instrument._all.filter((i) => i.isPickable)
    }

    /** The eight instruments pickers lead with, in display order: the voice first, then the most played. */
    static popular(): ReadonlyArray<Instrument> {
        return Instrument._popular
    }

    /**
     * `instruments` (default: every pickable one) grouped for pickers: fixed family order,
     * alphabetical within each group, empty groups left out.
     */
    static byCategory(
        instruments: ReadonlyArray<Instrument> = Instrument.pickable(),
    ): ReadonlyArray<{ category: InstrumentCategory; instruments: ReadonlyArray<Instrument> }> {
        return Instrument._categoryOrder
            .map((category) => ({
                category,
                instruments: instruments.filter((i) => i.category === category).sort((a, b) => a.displayName.localeCompare(b.displayName)),
            }))
            .filter((group) => group.instruments.length > 0)
    }

    /** Every selectable instrument, hidden duplicates included, grouped like {@link byCategory}. */
    static selectableByCategory(): ReadonlyArray<{ category: InstrumentCategory; instruments: ReadonlyArray<Instrument> }> {
        return Instrument.byCategory(Instrument.selectable())
    }

    static byId(id: string): Instrument | undefined {
        return Instrument._byId.get(id)
    }

    /**
     * Resolve by GM program number (1-indexed in MusicXML, 0-indexed here). A program several
     * instruments share resolves to its entry in `_gmDefault`, never to whichever is declared
     * first; a program one instrument carries resolves to it; an unknown program to Piano.
     */
    static byGmProgram(program: number): Instrument {
        return Instrument._gmDefault.get(program) ?? Instrument._all.find((i) => i.gmProgram === program) ?? Instrument.Piano
    }

    /**
     * Resolve by display name, case-insensitive, current or legacy ('Voice Lead' is still the
     * voice); undefined when no instrument carries that name.
     */
    static findByDisplayName(name: string): Instrument | undefined {
        const lower = name.trim().toLowerCase()
        return Instrument._all.find((i) => i.displayName.toLowerCase() === lower || i.legacyNames.some((n) => n.toLowerCase() === lower))
    }

    /** The MIDI note `written` sounds at on this instrument: `sounding = written + chromaticTranspose`. */
    soundingMidi(written: Pitch): number {
        return written.toMidi() + this.chromaticTranspose
    }

    /** Default instrument; the fallback for unknown GM programs. */
    static readonly Piano = new Instrument('piano', 'Piano', 'Keyboard', 0, 'acoustic_grand_piano', 0, 0, { playsChords: true })

    // Concert-pitch instruments — written = sounding, no transposition.
    static readonly Bagpipe = new Instrument('bagpipe', 'Bagpipe', 'Folk & World', 109, 'bagpipe')
    static readonly BaritoneHorn = new Instrument('baritone-horn', 'Baritone Horn', 'Brass', 58, 'tuba')
    static readonly Bassoon = new Instrument('bassoon', 'Bassoon', 'Woodwinds', 70, 'bassoon')
    static readonly Brass = new Instrument('brass', 'Brass', 'Brass', 61, 'brass_section', 0, 0, HIDDEN)
    static readonly Cello = new Instrument('cello', 'Cello', 'Strings', 42, 'cello')
    static readonly DiziFlute = new Instrument('dizi-flute', 'Dizi Flute', 'Folk & World', 73, 'flute')
    static readonly Erhu = new Instrument('erhu', 'Erhu', 'Folk & World', 110, 'fiddle')
    static readonly Euphonium = new Instrument('euphonium', 'Euphonium', 'Brass', 58, 'tuba')
    static readonly Flute = new Instrument('flute', 'Flute', 'Woodwinds', 73, 'flute')
    static readonly Harmonica = new Instrument('harmonica', 'Harmonica', 'Folk & World', 22, 'harmonica', 0, 0, { playsChords: true })
    static readonly HornInC = new Instrument('horn-in-c', 'Horn in C', 'Brass', 60, 'french_horn', 0, 0, HIDDEN)
    static readonly Oboe = new Instrument('oboe', 'Oboe', 'Woodwinds', 68, 'oboe')
    static readonly Ocarina = new Instrument('ocarina', 'Ocarina', 'Folk & World', 79, 'ocarina')
    static readonly OrchestralFlute = new Instrument('orchestral-flute', 'Orchestral Flute', 'Woodwinds', 73, 'flute', 0, 0, HIDDEN)
    static readonly PanFlute = new Instrument('pan-flute', 'Pan Flute', 'Folk & World', 75, 'pan_flute')
    static readonly Recorder = new Instrument('recorder', 'Recorder', 'Woodwinds', 74, 'recorder')
    static readonly AltoRecorderInF = new Instrument('alto-recorder-in-f', 'Alto Recorder in F', 'Woodwinds', 74, 'recorder')
    static readonly ShakuhachiFlute = new Instrument('shakuhachi-flute', 'Shakuhachi Flute', 'Folk & World', 77, 'shakuhachi')
    static readonly TinWhistle = new Instrument('tin-whistle', 'Tin Whistle', 'Folk & World', 78, 'whistle')
    static readonly TraditionalFlute = new Instrument('traditional-flute', 'Traditional Flute', 'Folk & World', 73, 'flute')
    static readonly Trombone = new Instrument('trombone', 'Trombone', 'Brass', 57, 'trombone')
    static readonly Tuba = new Instrument('tuba', 'Tuba', 'Brass', 58, 'tuba')
    static readonly Viola = new Instrument('viola', 'Viola', 'Strings', 41, 'viola')
    static readonly Violin = new Instrument('violin', 'Violin', 'Strings', 40, 'violin')
    static readonly ViolinLead = new Instrument('violin-lead', 'Violin Lead', 'Strings', 40, 'violin', 0, 0, HIDDEN)
    static readonly Violoncello = new Instrument('violoncello', 'Violoncello', 'Strings', 42, 'cello', 0, 0, HIDDEN)
    static readonly VoiceLead = new Instrument('voice-lead', 'Voice', 'Voice', 53, 'voice_oohs', 0, 0, { legacyNames: ['Voice Lead'] })

    // B♭ instruments — written sounds a major 2nd lower (chromatic −2, diatonic −1).
    static readonly Clarinet = new Instrument('clarinet', 'Clarinet', 'Woodwinds', 71, 'clarinet', -2, -1)
    static readonly ClarinetEnsemble = new Instrument('clarinet-ensemble', 'Clarinet Ensemble', 'Woodwinds', 71, 'clarinet', -2, -1, HIDDEN)
    static readonly ConcertClarinet = new Instrument('concert-clarinet', 'Concert Clarinet', 'Woodwinds', 71, 'clarinet', -2, -1, HIDDEN)
    static readonly SopranoSaxophone = new Instrument('soprano-saxophone', 'Soprano Saxophone', 'Woodwinds', 64, 'soprano_sax', -2, -1)
    static readonly Trumpet = new Instrument('trumpet', 'Trumpet', 'Brass', 56, 'trumpet', -2, -1)

    // E♭ instruments — written sounds a major 6th lower (chromatic −9, diatonic −5).
    static readonly AltoClarinet = new Instrument('alto-clarinet', 'Alto Clarinet', 'Woodwinds', 71, 'clarinet', -9, -5)
    static readonly AltoSaxophone = new Instrument('alto-saxophone', 'Alto Saxophone', 'Woodwinds', 65, 'alto_sax', -9, -5)

    // F instruments — written sounds a perfect 5th lower (chromatic −7, diatonic −4).
    static readonly EnglishHorn = new Instrument('english-horn', 'English Horn', 'Woodwinds', 69, 'english_horn', -7, -4)
    static readonly FrenchHorn = new Instrument('french-horn', 'French Horn', 'Brass', 60, 'french_horn', -7, -4)
    static readonly Horn = new Instrument('horn', 'Horn', 'Brass', 60, 'french_horn', -7, -4)

    // G instrument — written sounds a perfect 4th lower (chromatic −5, diatonic −3).
    static readonly AltoFlute = new Instrument('alto-flute', 'Alto Flute', 'Woodwinds', 73, 'flute', -5, -3)

    // Horn in D — sounds a minor 7th below written (chromatic −10, diatonic −6). Uses the natural-horn (low D crook) interpretation common in classical scores.
    static readonly HornInD = new Instrument('horn-in-d', 'Horn in D', 'Brass', 60, 'french_horn', -10, -6, HIDDEN)

    // Octave transpositions. Guitar and bass guitar are notated an octave above where they sound.
    static readonly Piccolo = new Instrument('piccolo', 'Piccolo', 'Woodwinds', 72, 'piccolo', 12, 7)
    static readonly Contrabass = new Instrument('contrabass', 'Double Bass', 'Strings', 43, 'contrabass', -12, -7, {
        legacyNames: ['Contrabass'],
    })
    static readonly Contrabassoon = new Instrument('contrabassoon', 'Contrabassoon', 'Woodwinds', 70, 'bassoon', -12, -7)
    static readonly Guitar = new Instrument('guitar', 'Guitar', 'Strings', 24, 'acoustic_guitar_nylon', -12, -7, { playsChords: true })
    static readonly BassGuitar = new Instrument('bass-guitar', 'Bass Guitar', 'Strings', 33, 'electric_bass_finger', -12, -7)

    // Major-9th-down instruments — written sounds an octave + major 2nd lower.
    static readonly BaritoneHornTreble = new Instrument(
        'baritone-horn-treble',
        'Baritone Horn Treble',
        'Brass',
        58,
        'tuba',
        -14,
        -8,
        HIDDEN,
    )
    static readonly BassClarinet = new Instrument('bass-clarinet', 'Bass Clarinet', 'Woodwinds', 71, 'clarinet', -14, -8)
    static readonly TenorSaxophone = new Instrument('tenor-saxophone', 'Tenor Saxophone', 'Woodwinds', 66, 'tenor_sax', -14, -8)

    // Octave + major 6th down — baritone sax in E♭.
    static readonly BaritoneSaxophone = new Instrument(
        'baritone-saxophone',
        'Baritone Saxophone',
        'Woodwinds',
        67,
        'baritone_sax',
        -21,
        -12,
    )

    // Two octaves + major 2nd down — contrabass clarinet in B♭.
    static readonly ContrabassClarinet = new Instrument('contrabass-clarinet', 'Contrabass Clarinet', 'Woodwinds', 71, 'clarinet', -26, -15)

    /** Used by the metronome click. Not a score-selectable instrument. */
    static readonly Woodblock = new Instrument('woodblock', 'Woodblock', 'Percussion', 115, 'woodblock')

    /** The pickers' lead row (see {@link popular}). Declared after the instruments so the static initialisers have run. */
    private static readonly _popular: ReadonlyArray<Instrument> = [
        Instrument.VoiceLead,
        Instrument.Piano,
        Instrument.Guitar,
        Instrument.Violin,
        Instrument.Flute,
        Instrument.Recorder,
        Instrument.AltoSaxophone,
        Instrument.Trumpet,
    ]

    /**
     * The instrument each shared GM program imports as (MIDI files, MusicXML parts with a foreign
     * name): the plainly named one, so a GM flute is a Flute rather than a Dizi Flute. 60 and 71
     * keep the concert-pitch Horn in C and the B♭ Clarinet they always resolved to — choosing
     * between concert-pitch and transposing instruments there is a product decision. Declared
     * after the instruments so the static initialisers have run.
     */
    private static readonly _gmDefault: ReadonlyMap<number, Instrument> = new Map([
        [40, Instrument.Violin],
        [42, Instrument.Cello],
        [58, Instrument.Tuba],
        [60, Instrument.HornInC],
        [70, Instrument.Bassoon],
        [71, Instrument.Clarinet],
        [73, Instrument.Flute],
        [74, Instrument.Recorder],
    ])
}
