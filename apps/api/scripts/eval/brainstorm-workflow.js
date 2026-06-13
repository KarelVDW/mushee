export const meta = {
  name: 'pipeline-improvement-brainstorm',
  description: 'Brainstorm + rank concrete ideas to raise recording-pipeline note-F1 (recall-limited)',
  phases: [
    { title: 'Ideate', detail: 'diverse lenses propose concrete testable changes' },
    { title: 'Rank', detail: 'synthesize, dedupe, score by impact/effort, flag risky claims' },
  ],
};

const CONTEXT = `
You are improving an audio→notes transcription pipeline (NestJS, apps/api/src/recordings).
Architecture:
- Adaptive: a coarse pitch scan picks a register band -> a provider + frequency window.
  Providers: crepe-tiny (CREPE, monophonic pitch TRAJECTORY via Viterbi over per-frame
  activations, NO explicit onset detection) used for low/mid/high; basic-pitch (polyphonic
  CNN WITH onset+frame heads) used only very-high (>~1997Hz, e.g. whistle/piccolo).
- Segmentation: crepe in providers/pitchDecoder.ts segmentNotes() cuts the smoothed
  pitch trajectory into notes by confidence threshold + pitch stability (pitchBinToleranceCents),
  with minFramesPerNote. It has NO amplitude/onset re-articulation detection, so two repeated
  same-pitch notes read as ONE sustained note.
- Post-processing: NoteExtractor.ts does monophonic selection, pitch-outlier removal,
  mergeAdjacent (MERGE_MAX_GAP_BEATS=0.25, MERGE_MAX_PITCH_DIFF=1, MERGE_MAX_OVERLAP_BEATS=0.1)
  -> this MERGES adjacent notes within 1 semitone, then beat-grid quantization. MIN_DURATION_BEATS=0.25.
- Eval (scripts/eval): note-F1, onset tolerance 100ms + exact MIDI. 17 scenarios (instruments via
  fluidsynth soundfont; voice bass->soprano and whistle via synthesis) x 4 melodies x 3 noise/mic
  conditions. Some melodies have repeated notes (Ode-to-Joy) and half-steps.

CURRENT RESULTS (mean F1 0.668). Per scenario PRECISION is high (0.75-0.99) but RECALL is low:
  instruments F1 0.65-0.85 (recall 0.50-0.75); voice F1 ~0.55 (recall ~0.43); whistle/piccolo F1 ~0.55 (recall ~0.43).
KEY DIAGNOSTIC: the bottleneck is RECALL — we MISS 25-55% of notes — while pitches we DO emit are
almost always correct (octave-error ~0). So this is an ONSET/SEGMENTATION problem (repeated &
fast notes collapse), NOT a pitch-accuracy problem.
ALREADY VALIDATED: pitch-shifting high audio down into crepe's range then shifting MIDI back lifts
piccolo 0.56->0.74 (harmonic-rich), but only +0.05 for pure-tone whistle.
`;

const IDEA_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          rationale: { type: 'string' },
          where: { type: 'string', description: 'file/function to change' },
          expectedImpact: { type: 'string', enum: ['high', 'medium', 'low'] },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
          howToTest: { type: 'string' },
          risk: { type: 'string', description: 'why it might NOT help or could regress' },
        },
        required: ['title', 'rationale', 'where', 'expectedImpact', 'effort', 'howToTest', 'risk'],
      },
    },
  },
  required: ['ideas'],
};

phase('Ideate');
const LENSES = [
  { key: 'onset-segmentation', focus: 'Onset / re-articulation detection so repeated and fast notes are not merged. Think amplitude-envelope novelty, spectral flux, confidence dips, splitting a sustained-pitch run where energy re-attacks. This is the recall bottleneck — go deep.' },
  { key: 'provider-dsp', focus: 'Provider/DSP-level changes: pitch-shift normalization into a provider sweet spot, vibrato handling for voice (pitch wobble breaks segmentation), Viterbi/confidence params, hop size/time resolution, median filtering, ensembling basic-pitch onsets WITH crepe pitch.' },
  { key: 'postprocess', focus: 'NoteExtractor post-processing: is mergeAdjacent (merges within 1 semitone) destroying repeated notes and half-steps? Quantization grid, MIN_DURATION, monophonic selection. What loosening recovers recall without hurting precision?' },
  { key: 'eval-validity', focus: 'Is the EVAL itself unfairly capping F1? e.g. synth detach gap (0.04s) makes repeated notes unrealistically hard; 100ms onset tolerance; melody tempo; whether real-world recall would be higher. Separate genuine pipeline gains from test-data artifacts.' },
];

const ideaSets = await parallel(
  LENSES.map((lens) => () =>
    agent(
      `${CONTEXT}\nYour lens: ${lens.focus}\n\nPropose 3-5 CONCRETE, testable changes from THIS lens to raise note-F1 (recall especially). ` +
        `Be specific about the exact file/function and parameter, and be honest about risk. Prefer changes testable via the existing eval harness.`,
      { label: `ideate:${lens.key}`, phase: 'Ideate', schema: IDEA_SCHEMA },
    ).then((r) => ({ lens: lens.key, ideas: r?.ideas ?? [] })),
  ),
);

phase('Rank');
const all = ideaSets.filter(Boolean).flatMap((s) => s.ideas.map((i) => ({ ...i, lens: s.lens })));
const ranked = await agent(
  `${CONTEXT}\nHere are ${all.length} candidate ideas from four lenses:\n${JSON.stringify(all, null, 2)}\n\n` +
    `Dedupe and merge overlapping ideas. Produce a RANKED shortlist (best first) of the changes most likely to raise mean note-F1, ` +
    `weighting expected impact against effort and regression risk. For each, give a crisp implementation sketch and the single most important risk to watch. ` +
    `Explicitly call out any idea that is likely a test-data artifact rather than a real pipeline win.`,
  {
    label: 'rank:synthesize',
    phase: 'Rank',
    schema: {
      type: 'object',
      properties: {
        shortlist: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              rank: { type: 'number' },
              title: { type: 'string' },
              sketch: { type: 'string' },
              expectedImpact: { type: 'string' },
              effort: { type: 'string' },
              keyRisk: { type: 'string' },
            },
            required: ['rank', 'title', 'sketch', 'expectedImpact', 'effort', 'keyRisk'],
          },
        },
        testDataConcerns: { type: 'string' },
      },
      required: ['shortlist', 'testDataConcerns'],
    },
  },
);

return ranked;
