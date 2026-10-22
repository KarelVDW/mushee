/**
 * Demo accounts + scores for local development. Seeded by `seedDemoData()`
 * (boot with SEED_DEMO_DATA=true, or `pnpm db:seed`). Everything here is
 * deterministic — fixed emails and score UUIDs — so seeding is idempotent.
 */

export const DEMO_PASSWORD = 'mushee-demo'

export interface DemoAccount {
    email: string
    name: string
    /** Subscription tier id; must exist in the subscription_tiers table. */
    tierId: 'free' | 'pro' | 'studio' | 'arranger'
    /** Stamps role "admin" (shown as a label in the admin console); console access itself is ADMIN_SECRET. */
    role?: 'admin'
    /** Fixed UUIDs of the demo scores this account owns (keys of DEMO_SCORES). */
    scoreIds: string[]
}

/**
 * One account per tier, the main demo account, and Solkey's own account with
 * the public example score. The main account is on
 * the Studio tier — 3 h of recording a day, comfortably unlimited for demo
 * purposes (see the PricingRelaunch migration for the tier ladder).
 */
export const DEMO_ACCOUNTS: DemoAccount[] = [
    {
        email: 'demo@mushee.local',
        name: 'Demo',
        tierId: 'studio',
        role: 'admin',
        scoreIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
    },
    {
        email: 'free@mushee.local',
        name: 'Demo Sketch',
        tierId: 'free',
        scoreIds: ['00000000-0000-4000-8000-000000000011'],
    },
    {
        email: 'pro@mushee.local',
        name: 'Demo Songwriter',
        tierId: 'pro',
        scoreIds: ['00000000-0000-4000-8000-000000000021'],
    },
    {
        email: 'studio@mushee.local',
        name: 'Demo Studio',
        tierId: 'studio',
        scoreIds: ['00000000-0000-4000-8000-000000000031'],
    },
    // Solkey's own account: holds the public example the landing page's "Hear an example"
    // opens (the web app's NEXT_PUBLIC_EXAMPLE_SHARE_TOKEN = EXAMPLE_SHARE_TOKEN below).
    {
        email: 'examples@mushee.local',
        name: 'Solkey',
        tierId: 'free',
        scoreIds: ['00000000-0000-4000-8000-000000000041'],
    },
]

/**
 * The stable share token of the seeded Frère Jacques example, so a local web app can point
 * NEXT_PUBLIC_EXAMPLE_SHARE_TOKEN at it. Shaped like the tokens share() mints
 * (ScoresService.isShareToken), but readable: it is meant to be public.
 */
export const EXAMPLE_SHARE_TOKEN = 'solkey-example-frere-jacques'

interface DemoScore {
    title: string
    document: Record<string, unknown>
    /** Seeded with sharing on under this token (a public example); unset = private. */
    shareToken?: string
}

type Entry = Record<string, unknown>

/** Measure-1 attributes + tempo, matching what @mushee/notation's ScoreSerializer
 *  emits for a new score (divisions 12, treble clef, 4/4). */
function opening(tempo: number): Entry[] {
    return [
        {
            _type: 'attributes',
            divisions: 12,
            clef: [{ sign: 'G', line: 2 }],
            time: [{ beats: '4', beatType: '4' }],
        },
        { _type: 'direction', sound: { tempo } },
    ]
}

function quarter(step: string, octave: number): Entry {
    return {
        _type: 'note',
        pitch: { step, octave },
        duration: 12,
        voice: '1',
        type: 'quarter',
    }
}

function half(step: string, octave: number): Entry {
    return {
        _type: 'note',
        pitch: { step, octave },
        duration: 24,
        voice: '1',
        type: 'half',
    }
}

function eighth(step: string, octave: number): Entry {
    return {
        _type: 'note',
        pitch: { step, octave },
        duration: 6,
        voice: '1',
        type: 'eighth',
    }
}

function quarterRest(): Entry {
    return { _type: 'note', rest: {}, duration: 12, voice: '1', type: 'quarter' }
}

const FINAL_BARLINE: Entry = {
    _type: 'barline',
    location: 'right',
    barStyle: 'light-heavy',
}

function pianoDocument(measures: Entry[][]): Record<string, unknown> {
    return partDocument({ name: 'Piano', midiProgram: 1 }, measures)
}

/** A one-part document for the given instrument (its display name and 1-based GM program). */
function partDocument(instrument: { name: string; midiProgram: number }, measures: Entry[][]): Record<string, unknown> {
    return {
        partList: {
            scoreParts: [
                {
                    id: 'P1',
                    partName: instrument.name,
                    scoreInstrument: { id: 'P1-I1', instrumentName: instrument.name },
                    midiInstrument: { id: 'P1-I1', midiProgram: instrument.midiProgram },
                },
            ],
        },
        parts: [
            {
                id: 'P1',
                measures: measures.map((entries, i) => ({
                    number: String(i + 1),
                    entries,
                })),
            },
        ],
    }
}

/** Keyed by the fixed score UUIDs referenced from DEMO_ACCOUNTS. */
export const DEMO_SCORES: Record<string, DemoScore> = {
    '00000000-0000-4000-8000-000000000001': {
        title: 'Twinkle Twinkle',
        document: pianoDocument([
            [...opening(100), quarter('C', 4), quarter('C', 4), quarter('G', 4), quarter('G', 4)],
            [quarter('A', 4), quarter('A', 4), half('G', 4)],
            [quarter('F', 4), quarter('F', 4), quarter('E', 4), quarter('E', 4)],
            [quarter('D', 4), quarter('D', 4), half('C', 4), FINAL_BARLINE],
        ]),
    },
    '00000000-0000-4000-8000-000000000002': {
        title: 'Scale Study',
        document: pianoDocument([
            [...opening(120), quarter('C', 4), quarter('D', 4), quarter('E', 4), quarter('F', 4)],
            [quarter('G', 4), quarter('A', 4), quarter('B', 4), quarter('C', 5)],
            [quarter('C', 5), quarter('B', 4), quarter('A', 4), quarter('G', 4)],
            [quarter('F', 4), quarter('E', 4), quarter('D', 4), quarter('C', 4), FINAL_BARLINE],
        ]),
    },
    '00000000-0000-4000-8000-000000000011': {
        title: 'Sketch Demo',
        document: pianoDocument([
            [...opening(120), quarter('E', 4), quarter('G', 4), half('C', 5)],
            [quarterRest(), quarterRest(), quarterRest(), quarterRest(), FINAL_BARLINE],
        ]),
    },
    '00000000-0000-4000-8000-000000000021': {
        title: 'Composer Demo',
        document: pianoDocument([
            [...opening(90), quarter('D', 4), quarter('F', 4), quarter('A', 4), quarter('D', 5)],
            [quarterRest(), quarterRest(), quarterRest(), quarterRest(), FINAL_BARLINE],
        ]),
    },
    '00000000-0000-4000-8000-000000000031': {
        title: 'Studio Demo',
        document: pianoDocument([
            [...opening(110), quarter('G', 4), quarter('B', 4), quarter('D', 5), quarter('G', 5)],
            [quarterRest(), quarterRest(), quarterRest(), quarterRest(), FINAL_BARLINE],
        ]),
    },
    // The whole round the landing page's hero demo hums two bars of, on the Voice instrument
    // (GM 54, "Voice Oohs"), shared publicly as the "Hear an example" score.
    '00000000-0000-4000-8000-000000000041': {
        title: 'Frère Jacques',
        shareToken: EXAMPLE_SHARE_TOKEN,
        document: partDocument({ name: 'Voice', midiProgram: 54 }, [
            [...opening(100), quarter('C', 4), quarter('D', 4), quarter('E', 4), quarter('C', 4)],
            [quarter('C', 4), quarter('D', 4), quarter('E', 4), quarter('C', 4)],
            [quarter('E', 4), quarter('F', 4), half('G', 4)],
            [quarter('E', 4), quarter('F', 4), half('G', 4)],
            [eighth('G', 4), eighth('A', 4), eighth('G', 4), eighth('F', 4), quarter('E', 4), quarter('C', 4)],
            [eighth('G', 4), eighth('A', 4), eighth('G', 4), eighth('F', 4), quarter('E', 4), quarter('C', 4)],
            [quarter('C', 4), quarter('G', 3), half('C', 4)],
            [quarter('C', 4), quarter('G', 3), half('C', 4), FINAL_BARLINE],
        ]),
    },
}
