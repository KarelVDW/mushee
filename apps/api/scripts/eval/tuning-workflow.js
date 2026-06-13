export const meta = {
  name: 'pitch-pipeline-tuning',
  description: 'Sweep provider + thresholds per register band against the eval corpus and pick winners',
  phases: [
    { title: 'Probe', detail: 'provider × band F1 sweep (fixed configs)' },
    { title: 'Tune', detail: 'threshold sweep for the best provider per band' },
    { title: 'Synthesize', detail: 'assemble winning per-band config table' },
  ],
};

// Register bands and the corpus scenarios that exercise them. Each agent runs
// `run-eval` in FIXED mode (a single provider + explicit window) over its band's
// scenarios and returns the mean F1, so we can compare providers apples-to-apples
// before committing a choice to the adaptive PROFILE_BANDS table.
const BANDS = [
  { id: 'low', scenarios: 'tuba-verylow,cello-low,bassoon-low,voice-bass', minF: 55, maxF: 700, hp: 40 },
  { id: 'mid', scenarios: 'trumpet-mid,trombone-low,clarinet-mid,harmonica-mid,voice-tenor,voice-alto', minF: 90, maxF: 1300, hp: 70 },
  { id: 'high', scenarios: 'flute-high,oboe-high,violin-high,voice-soprano', minF: 200, maxF: 2200, hp: 120 },
  { id: 'very-high', scenarios: 'piccolo-veryhigh,whistle-mid,whistle-high', minF: 500, maxF: 4500, hp: 300 },
];

// Only basic-pitch reaches above ~1997 Hz, so the very-high band fixes it.
const PROVIDERS = ['basic-pitch', 'crepe-tiny'];

const F1_SCHEMA = {
  type: 'object',
  properties: {
    overallF1: { type: 'number' },
    perScenario: {
      type: 'array',
      items: {
        type: 'object',
        properties: { scenario: { type: 'string' }, f1: { type: 'number' }, octaveErrorRate: { type: 'number' } },
        required: ['scenario', 'f1'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['overallF1', 'perScenario'],
};

const CWD = 'cd /Users/karelvandewinkel/Projecten/mushee/apps/api &&';

function runEvalPrompt(env, label) {
  return `Run this command and report the resulting metrics.\n\n` +
    `${CWD} ${env} EVAL_OUT=/tmp/wf-${label}.json npx tsx scripts/eval/run-eval.ts 2>&1 | grep -vE "npm warn|Nest|TfBackend|LOG|model dir|Registered"\n\n` +
    `Then read /tmp/wf-${label}.json and return overallF1 and the perScenario array (scenario, f1, octaveErrorRate). ` +
    `If the command errors, return overallF1=0 and explain in notes.`;
}

phase('Probe');
// For each band, run every provider concurrently; pick the highest mean F1.
const bandResults = await pipeline(
  BANDS,
  async (band) => {
    const perProvider = await parallel(
      PROVIDERS.map((prov) => () => {
        // very-high band only basic-pitch can reach; skip others.
        if (band.id === 'very-high' && prov !== 'basic-pitch') return Promise.resolve(null);
        const env = `EVAL_PROVIDER=${prov} EVAL_SCENARIOS=${band.scenarios} EVAL_MIN_FREQ=${band.minF} EVAL_MAX_FREQ=${band.maxF} EVAL_HIGHPASS=${band.hp} EVAL_LABEL=${band.id}-${prov}`;
        return agent(runEvalPrompt(env, `${band.id}-${prov}`), {
          label: `probe:${band.id}/${prov}`,
          phase: 'Probe',
          schema: F1_SCHEMA,
        }).then((r) => ({ provider: prov, ...r }));
      }),
    );
    const valid = perProvider.filter(Boolean);
    valid.sort((a, b) => b.overallF1 - a.overallF1);
    const best = valid[0];
    log(`band ${band.id}: best=${best?.provider} F1=${best?.overallF1?.toFixed(3)} (${valid.map((v) => `${v.provider}:${v.overallF1.toFixed(2)}`).join(', ')})`);
    return { band, ranked: valid, best };
  },
);

phase('Tune');
// For each band's winning provider, sweep a couple of gating thresholds and
// keep the best. basic-pitch tunes onset/frame; crepe tunes confidence.
const tuned = await parallel(
  bandResults.filter(Boolean).map((br) => async () => {
    const { band, best } = br;
    if (!best) return null;
    const prov = best.provider;
    const base = `EVAL_PROVIDER=${prov} EVAL_SCENARIOS=${band.scenarios} EVAL_MIN_FREQ=${band.minF} EVAL_MAX_FREQ=${band.maxF} EVAL_HIGHPASS=${band.hp}`;
    let grid;
    if (prov === 'basic-pitch') {
      grid = [
        { onset: 0.4, frame: 0.25 },
        { onset: 0.5, frame: 0.3 },
        { onset: 0.6, frame: 0.3 },
      ].map((g) => ({ env: `${base} EVAL_ONSET=${g.onset} EVAL_FRAME=${g.frame}`, desc: `onset=${g.onset},frame=${g.frame}` }));
    } else {
      grid = [0.4, 0.5, 0.6].map((c) => ({ env: `${base} EVAL_CONFIDENCE=${c}`, desc: `conf=${c}` }));
    }
    const trials = await parallel(
      grid.map((g, i) => () =>
        agent(runEvalPrompt(`${g.env} EVAL_LABEL=${band.id}-tune${i}`, `${band.id}-tune${i}`), {
          label: `tune:${band.id}/${g.desc}`,
          phase: 'Tune',
          schema: F1_SCHEMA,
        }).then((r) => ({ desc: g.desc, ...r })),
      ),
    );
    const valid = trials.filter(Boolean);
    valid.sort((a, b) => b.overallF1 - a.overallF1);
    log(`band ${band.id} (${prov}) tuned: ${valid.map((v) => `${v.desc}:${v.overallF1.toFixed(2)}`).join(', ')}`);
    return { band: band.id, provider: prov, window: { minF: band.minF, maxF: band.maxF, hp: band.hp }, bestThresholds: valid[0]?.desc, bestF1: valid[0]?.overallF1, ranked: valid };
  }),
);

phase('Synthesize');
const summary = tuned.filter(Boolean);
return {
  recommendation: summary.map((s) => ({
    band: s.band,
    provider: s.provider,
    window: s.window,
    bestThresholds: s.bestThresholds,
    bestF1: s.bestF1,
  })),
  probe: bandResults.filter(Boolean).map((br) => ({
    band: br.band.id,
    ranked: br.ranked.map((r) => ({ provider: r.provider, f1: r.overallF1 })),
  })),
};
