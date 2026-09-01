/**
 * Draft note labels for staged audio, for a human to correct.
 *
 * Step 2 of the whistle-corpus chain (see fetch/fetch-whistle-real.ts's header). Reads
 * every clip staged under `.cache/whistle-staging/<dataset>/`, tracks the
 * strongest sinusoid (lib/sineTrack.ts — deliberately not our production model
 * family, and deliberately dumb), groups it into semitone runs, and writes:
 *
 *   annotations/<dataset>/<clip>.labels.tsv   TRACKED. Audacity's label format:
 *                                             `start<TAB>end<TAB>note`, one note
 *                                             per line, nothing else — so it
 *                                             opens directly in Audacity
 *                                             (File ▸ Import ▸ Labels) and in
 *                                             Sonic Visualiser.
 *   annotations/<dataset>/<clip>.meta.json    TRACKED. Provenance: which tool
 *                                             drafted it, with what parameters,
 *                                             and `verifiedBy` — null until a
 *                                             human has checked the clip.
 *
 * An existing .labels.tsv is NEVER overwritten (that file may be an hour of
 * somebody's ears); `--force` overrides, `--only=<substr>` narrows.
 *
 * The correction loop, per clip (~2–4 min for 10 s of whistling):
 *   1. Audacity ▸ open <dataset>/<clip>.wav, Import ▸ Labels ▸ <clip>.labels.tsv
 *   2. switch the track to Spectrogram view — whistling is one bright line, so
 *      onsets and offsets are visible, not inferred
 *   3. fix boundaries, split runs the drafter merged, delete artefacts, correct
 *      note names (a whistle an octave off is the drafter's most likely error)
 *   4. Export Labels over the same file, then set `verifiedBy` in the .meta.json
 *   5. fetch/import-note-labels.ts turns the result into a scoreable dataset
 *
 * Run: pnpm --filter api exec tsx scripts/eval/fetch/draft-note-labels.ts
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { draftNotes, trackSinusoid } from '../lib/sineTrack';
import { wavToFloat } from '../lib/wav';

const STAGE_ROOT = resolve(__dirname, '../.cache/whistle-staging');
const ANNOTATIONS = resolve(__dirname, '../annotations');

/**
 * Tracker settings, recorded into every .meta.json so a re-draft is comparable.
 * The band is the whistle profile's own (`instrument-ranges.ts`: 500–4300 Hz),
 * widened slightly at both ends so a clip that leaves the profile's range is
 * visible in the draft rather than silently truncated.
 */
const TRACK = { fftSize: 2048, hopSec: 0.01, minHz: 400, maxHz: 5000, minTonality: 0.35, minLevel: 0.06 };
const SEGMENT = { minNoteSec: 0.06, maxDropoutSec: 0.05, medianFrames: 5 };

/**
 * Per-dataset overrides, because "strongest peak in the band" only reads as a
 * measurement when the whistle IS the strongest peak.
 *
 * On `whistle-real` it is, overwhelmingly: 0.95 of the frame energy sits in the
 * peak's three bins (measured on commons-donna). On `whistle-vintage` the sides
 * carry piano/orchestra plus 78-rpm surface noise, and the accompaniment's
 * fundamentals sit UNDER the whistle — median tonality 0.45, and the unrestricted
 * tracker spends most frames on the piano at ~680 Hz while the whistle is up at
 * 1.3–2.2 kHz. Raising the floor to 700 Hz and demanding a cleaner peak keeps the
 * draft on the whistled line. It is still the roughest draft in the corpus; the
 * vintage tier is annotation work, not a free lunch.
 */
const DATASET_OVERRIDES: Record<
  string,
  { track?: Partial<typeof TRACK>; segment?: Partial<typeof SEGMENT> }
> = {
  'whistle-vintage': {
    track: { minHz: 700, minTonality: 0.55, minLevel: 0.08 },
    segment: { minNoteSec: 0.08 },
  },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI number → scientific pitch name (60 → C4), the notation an annotator reads. */
function noteName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

interface ClipMeta {
  clip: string;
  dataset: string;
  /** Null until a human has listened to the clip and corrected the labels. */
  verifiedBy: string | null;
  verifiedAt: string | null;
  draftedBy: string;
  draftParams: { track: typeof TRACK; segment: typeof SEGMENT };
  draftNotes: number;
  draftMedianCentsOffset: number;
  /** `sha256` pins the exact bytes these labels describe — see fetch/import-note-labels.ts. */
  audio: { sampleRate: number; durationSec: number; sha256: string };
  /** Copied from staging.json so the licence travels with the annotation. */
  provenance?: unknown;
}

function main(): void {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length);

  if (!existsSync(STAGE_ROOT)) {
    console.error(`No staged audio at ${STAGE_ROOT} — run fetch/fetch-whistle-real.ts first.`);
    process.exit(1);
  }

  let drafted = 0;
  let kept = 0;
  for (const ds of readdirSync(STAGE_ROOT, { withFileTypes: true })) {
    if (!ds.isDirectory()) continue;
    const stageDir = join(STAGE_ROOT, ds.name);
    const outDir = join(ANNOTATIONS, ds.name);
    mkdirSync(outDir, { recursive: true });

    const override = DATASET_OVERRIDES[ds.name] ?? {};
    const track = { ...TRACK, ...override.track };
    const segment = { ...SEGMENT, ...override.segment };

    const staging = existsSync(join(stageDir, 'staging.json'))
      ? (JSON.parse(readFileSync(join(stageDir, 'staging.json'), 'utf8')) as {
          clips?: { id: string }[];
        })
      : {};
    const provenanceFor = new Map(
      (staging.clips ?? []).map((c) => [c.id, c] as const),
    );

    for (const file of readdirSync(stageDir).filter((f) => f.endsWith('.wav')).sort()) {
      const clip = file.replace(/\.wav$/, '');
      if (only && !clip.includes(only)) continue;
      const tsv = join(outDir, `${clip}.labels.tsv`);
      if (existsSync(tsv) && !force) {
        kept += 1;
        continue;
      }

      const audioBytes = readFileSync(join(stageDir, file));
      const { samples, sampleRate } = wavToFloat(audioBytes);
      const frames = trackSinusoid(samples, sampleRate, track);
      const notes = draftNotes(frames, track.hopSec, segment);

      writeFileSync(
        tsv,
        notes
          .map(
            (n) =>
              `${n.onsetSec.toFixed(6)}\t${(n.onsetSec + n.durSec).toFixed(6)}\t${noteName(n.midi)}`,
          )
          .join('\n') + (notes.length ? '\n' : ''),
      );

      const offsets = notes.map((n) => Math.abs(n.centsOffset)).sort((a, b) => a - b);
      const meta: ClipMeta = {
        clip,
        dataset: ds.name,
        verifiedBy: null,
        verifiedAt: null,
        draftedBy: 'lib/sineTrack.ts (framewise FFT peak + semitone runs)',
        draftParams: { track, segment },
        draftNotes: notes.length,
        draftMedianCentsOffset: offsets.length ? offsets[Math.floor(offsets.length / 2)] : 0,
        audio: {
          sampleRate,
          durationSec: samples.length / sampleRate,
          sha256: createHash('sha256').update(audioBytes).digest('hex'),
        },
        provenance: provenanceFor.get(clip),
      };
      writeFileSync(join(outDir, `${clip}.meta.json`), `${JSON.stringify(meta, null, 2)}\n`);

      const pitches = notes.map((n) => n.midi);
      console.log(
        `  ${ds.name}/${clip}: ${notes.length} draft notes, ` +
          `${(samples.length / sampleRate).toFixed(1)} s, ` +
          (pitches.length
            ? `${noteName(Math.min(...pitches))}–${noteName(Math.max(...pitches))}, `
            : '') +
          `median |Δ¢| ${meta.draftMedianCentsOffset}`,
      );
      drafted += 1;
    }
  }

  console.log(`\nDrafted ${drafted} label files (${kept} left alone — pass --force to redraft).`);
  console.log(`Correct them in Audacity, then: pnpm --filter api exec tsx scripts/eval/fetch/import-note-labels.ts`);
}

main();
