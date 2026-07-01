/**
 * Demo accounts + scores for local development. Seeded by `seedDemoData()`
 * (boot with SEED_DEMO_DATA=true, or `pnpm db:seed`). Everything here is
 * deterministic — fixed emails and score UUIDs — so seeding is idempotent.
 */

export const DEMO_PASSWORD = 'mushee-demo';

export interface DemoAccount {
  email: string;
  name: string;
  /** Subscription tier id; must exist in SubscriptionTier.all. */
  tierId: 'free' | 'pro' | 'studio';
  /** Fixed UUIDs of the demo scores this account owns (keys of DEMO_SCORES). */
  scoreIds: string[];
}

/**
 * One account per tier, plus the main demo account. The main account is on
 * the Studio tier, whose `dailyRecordingCredits` is `null` — i.e. recording
 * is unlimited (see SubscriptionTier).
 */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    email: 'demo@mushee.local',
    name: 'Demo',
    tierId: 'studio',
    scoreIds: [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ],
  },
  {
    email: 'free@mushee.local',
    name: 'Demo Sketch',
    tierId: 'free',
    scoreIds: ['00000000-0000-4000-8000-000000000011'],
  },
  {
    email: 'pro@mushee.local',
    name: 'Demo Composer',
    tierId: 'pro',
    scoreIds: ['00000000-0000-4000-8000-000000000021'],
  },
  {
    email: 'studio@mushee.local',
    name: 'Demo Studio',
    tierId: 'studio',
    scoreIds: ['00000000-0000-4000-8000-000000000031'],
  },
];

interface DemoScore {
  title: string;
  document: Record<string, unknown>;
}

type Entry = Record<string, unknown>;

/** Measure-1 attributes + tempo, matching what the web app's ScoreSerializer
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
  ];
}

function quarter(step: string, octave: number): Entry {
  return {
    _type: 'note',
    pitch: { step, octave },
    duration: 12,
    voice: '1',
    type: 'quarter',
  };
}

function half(step: string, octave: number): Entry {
  return {
    _type: 'note',
    pitch: { step, octave },
    duration: 24,
    voice: '1',
    type: 'half',
  };
}

function quarterRest(): Entry {
  return { _type: 'note', rest: {}, duration: 12, voice: '1', type: 'quarter' };
}

const FINAL_BARLINE: Entry = {
  _type: 'barline',
  location: 'right',
  barStyle: 'light-heavy',
};

function pianoDocument(measures: Entry[][]): Record<string, unknown> {
  return {
    partList: {
      scoreParts: [
        {
          id: 'P1',
          partName: 'Piano',
          scoreInstrument: { id: 'P1-I1', instrumentName: 'Piano' },
          midiInstrument: { id: 'P1-I1', midiProgram: 1 },
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
  };
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
};
