import { Instrument } from '@mushee/notation/model/Instrument'
import { Pitch } from '@mushee/notation/model/Pitch'
import { describe, expect, it } from 'vitest'

describe('Instrument', () => {
    it('Piano is the default with no transposition', () => {
        expect(Instrument.Piano.chromaticTranspose).toBe(0)
        expect(Instrument.Piano.diatonicTranspose).toBe(0)
    })

    it('Trumpet transposes a major 2nd down', () => {
        expect(Instrument.Trumpet.chromaticTranspose).toBe(-2)
        expect(Instrument.Trumpet.diatonicTranspose).toBe(-1)
    })

    it('Piccolo sounds an octave above written', () => {
        expect(Instrument.Piccolo.chromaticTranspose).toBe(12)
        expect(Instrument.Piccolo.diatonicTranspose).toBe(7)
    })

    it('selectable() excludes the metronome Woodblock', () => {
        const ids = Instrument.selectable().map((i) => i.id)
        expect(ids).not.toContain('woodblock')
    })

    it('byGmProgram falls back to Piano for unknown programs', () => {
        expect(Instrument.byGmProgram(999)).toBe(Instrument.Piano)
    })

    it('byGmProgram resolves a program only one instrument carries to that instrument', () => {
        expect(Instrument.byGmProgram(56)).toBe(Instrument.Trumpet)
        expect(Instrument.byGmProgram(115)).toBe(Instrument.Woodblock)
    })

    it('byGmProgram pins the default for every program several instruments share', () => {
        const defaults = new Map([
            [40, Instrument.Violin],
            [42, Instrument.Cello],
            [58, Instrument.Tuba],
            [60, Instrument.HornInC],
            [70, Instrument.Bassoon],
            [71, Instrument.Clarinet],
            [73, Instrument.Flute],
            [74, Instrument.Recorder],
        ])
        // A new instrument on an already-used program must get a deliberate default here too.
        const counts = new Map<number, number>()
        for (const i of [...Instrument.selectable(), Instrument.Woodblock]) counts.set(i.gmProgram, (counts.get(i.gmProgram) ?? 0) + 1)
        const shared = [...counts].filter(([, n]) => n > 1).map(([program]) => program)
        expect(shared.sort((a, b) => a - b)).toEqual([...defaults.keys()])
        for (const [program, instrument] of defaults) expect(Instrument.byGmProgram(program)).toBe(instrument)
    })

    it('byId resolves a registered instrument and returns undefined for an unknown id', () => {
        expect(Instrument.byId('trumpet')).toBe(Instrument.Trumpet)
        expect(Instrument.byId('not-an-instrument')).toBeUndefined()
    })

    it('findByDisplayName matches case-insensitively after trimming', () => {
        expect(Instrument.findByDisplayName('  fReNcH HoRn ')).toBe(Instrument.FrenchHorn)
        expect(Instrument.findByDisplayName('Trumpet')).toBe(Instrument.Trumpet)
    })

    it('findByDisplayName returns undefined for an unknown name', () => {
        expect(Instrument.findByDisplayName('Theremin')).toBeUndefined()
    })

    it('shows the singer and the double bass under plain names, keeping their ids', () => {
        expect(Instrument.VoiceLead.displayName).toBe('Voice')
        expect(Instrument.VoiceLead.id).toBe('voice-lead')
        expect(Instrument.Contrabass.displayName).toBe('Double Bass')
        expect(Instrument.Contrabass.id).toBe('contrabass')
    })

    it('findByDisplayName still resolves a renamed instrument by its old name', () => {
        expect(Instrument.findByDisplayName('Voice Lead')).toBe(Instrument.VoiceLead)
        expect(Instrument.findByDisplayName(' voice lead ')).toBe(Instrument.VoiceLead)
        expect(Instrument.findByDisplayName('Voice')).toBe(Instrument.VoiceLead)
        expect(Instrument.findByDisplayName('Contrabass')).toBe(Instrument.Contrabass)
        expect(Instrument.findByDisplayName('double bass')).toBe(Instrument.Contrabass)
        expect(Instrument.VoiceLead.legacyNames).toEqual(['Voice Lead'])
        expect(Instrument.Piano.legacyNames).toEqual([])
    })

    it('gives every current and legacy name to exactly one instrument', () => {
        const names = [...Instrument.selectable(), Instrument.Woodblock]
            .flatMap((i) => [i.displayName, ...i.legacyNames])
            .map((n) => n.toLowerCase())
        expect(new Set(names).size).toBe(names.length)
    })

    it('marks the instruments usually played in chords', () => {
        const chordal = Instrument.selectable().filter((i) => i.playsChords)
        expect(chordal).toEqual(expect.arrayContaining([Instrument.Piano, Instrument.Guitar, Instrument.Harmonica]))
        expect(chordal).toHaveLength(3)
        expect(Instrument.BassGuitar.playsChords).toBe(false)
        expect(Instrument.VoiceLead.playsChords).toBe(false)
    })

    it('soundingMidi adds the instrument’s chromatic transposition to the written pitch', () => {
        const c5 = new Pitch({ name: 'C', octave: 5 })
        expect(Instrument.Piano.soundingMidi(c5)).toBe(72)
        expect(Instrument.Trumpet.soundingMidi(c5)).toBe(70) // written C sounds B♭
        expect(Instrument.Guitar.soundingMidi(c5)).toBe(60) // an octave below written
    })

    it('guitar and bass guitar sound an octave below written', () => {
        expect(Instrument.Guitar.chromaticTranspose).toBe(-12)
        expect(Instrument.Guitar.diatonicTranspose).toBe(-7)
        expect(Instrument.BassGuitar.chromaticTranspose).toBe(-12)
        expect(Instrument.BassGuitar.diatonicTranspose).toBe(-7)
    })
})

describe('Instrument.pickable', () => {
    const hidden = [
        Instrument.ViolinLead,
        Instrument.Violoncello,
        Instrument.OrchestralFlute,
        Instrument.ConcertClarinet,
        Instrument.ClarinetEnsemble,
        Instrument.Brass,
        Instrument.HornInC,
        Instrument.HornInD,
        Instrument.BaritoneHornTreble,
    ]

    it('leaves the duplicates and section patches out, and keeps them registered', () => {
        const pickable = Instrument.pickable()
        for (const instrument of hidden) {
            expect(pickable).not.toContain(instrument)
            expect(instrument.isPickable).toBe(false)
            expect(Instrument.selectable()).toContain(instrument)
            expect(Instrument.byId(instrument.id)).toBe(instrument)
            expect(Instrument.findByDisplayName(instrument.displayName)).toBe(instrument)
        }
        expect(pickable).toHaveLength(Instrument.selectable().length - hidden.length)
    })

    it('leaves the metronome Woodblock out', () => {
        expect(Instrument.Woodblock.isPickable).toBe(false)
        expect(Instrument.pickable()).not.toContain(Instrument.Woodblock)
    })

    it('keeps the plainly named instruments, Cello and Violin among them', () => {
        for (const instrument of [Instrument.Cello, Instrument.Violin, Instrument.Flute, Instrument.Clarinet, Instrument.FrenchHorn]) {
            expect(instrument.isPickable).toBe(true)
            expect(Instrument.pickable()).toContain(instrument)
        }
    })
})

describe('Instrument.popular', () => {
    it('leads with the voice, then the most played instruments', () => {
        expect(Instrument.popular().map((i) => i.displayName)).toEqual([
            'Voice',
            'Piano',
            'Guitar',
            'Violin',
            'Flute',
            'Recorder',
            'Alto Saxophone',
            'Trumpet',
        ])
    })

    it('lists only pickable instruments, each once', () => {
        const popular = Instrument.popular()
        expect(new Set(popular).size).toBe(popular.length)
        for (const instrument of popular) expect(instrument.isPickable).toBe(true)
    })
})

describe('Instrument.byCategory', () => {
    it('groups the pickable instruments by default', () => {
        const grouped = Instrument.byCategory().flatMap((g) => g.instruments)
        expect(grouped).toHaveLength(Instrument.pickable().length)
        expect(grouped).not.toContain(Instrument.ViolinLead)
    })

    it('groups any list in family order and drops empty families', () => {
        const grouped = Instrument.byCategory([Instrument.Trumpet, Instrument.Guitar, Instrument.VoiceLead, Instrument.Cello])
        expect(grouped).toEqual([
            { category: 'Voice', instruments: [Instrument.VoiceLead] },
            { category: 'Strings', instruments: [Instrument.Cello, Instrument.Guitar] },
            { category: 'Brass', instruments: [Instrument.Trumpet] },
        ])
    })
})

describe('Instrument.selectableByCategory', () => {
    it('covers every selectable instrument exactly once', () => {
        const grouped = Instrument.selectableByCategory().flatMap((g) => g.instruments)
        expect(grouped.length).toBe(Instrument.selectable().length)
        expect(new Set(grouped).size).toBe(grouped.length)
    })

    it('places each instrument in its own category group', () => {
        for (const { category, instruments } of Instrument.selectableByCategory()) {
            for (const instrument of instruments) expect(instrument.category).toBe(category)
        }
    })

    it('lists families in fixed display order without the percussion-only group', () => {
        const categories = Instrument.selectableByCategory().map((g) => g.category)
        expect(categories).toEqual(['Voice', 'Keyboard', 'Strings', 'Woodwinds', 'Brass', 'Folk & World'])
    })

    it('sorts instruments alphabetically within each family', () => {
        for (const { instruments } of Instrument.selectableByCategory()) {
            const names = instruments.map((i) => i.displayName)
            expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
        }
    })

    it('keeps the metronome Woodblock out of every group', () => {
        expect(Instrument.Woodblock.category).toBe('Percussion')
        const grouped = Instrument.selectableByCategory().flatMap((g) => g.instruments)
        expect(grouped).not.toContain(Instrument.Woodblock)
    })
})
