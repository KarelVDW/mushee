/**
 * TinySOL (CC-BY-4.0) → real recorded instrument tone in the registers where the
 * harness has none.
 *
 * The gap this closes. The 2026-08-20 provider-routing census found that **zero
 * real pitched clips in the corpus reach the `very-high` band** — URMP's 13
 * instruments and GuitarSet stay under ~700 Hz in practice — so the band's
 * shipping path (basic-pitch @ 500–4300 Hz) and its candidate replacement
 * (`crepe-pitchdown-provider.ts`, the default since basic-pitch’s removal) are both
 * validated on synthesis alone. TinySOL is 2,913 isolated notes recorded at
 * Ircam (Studio On Line, 1996–99), and **742 of them sit at or above F5 (698 Hz),
 * 353 at or above D6 (1175 Hz)** — flute to D7 (2349 Hz), violin to E7 (2637 Hz),
 * accordion to C♯8 (4435 Hz). That is real timbre in the band, which is the one
 * thing synthesis cannot supply.
 *
 * 🔴 What this is NOT. TinySOL ships one note per file, so the *performance* here
 * is ours: notes are trimmed to their attack and spliced into short melodies.
 * Truth is therefore EXACT (we placed every onset) but the phrasing is not human
 * — no performer timing, no legato shaping, no rubato. Each dataset is written
 * with `constructedPerformance: true`, which run-eval.ts keeps out of the pooled
 * headline while still scoring and reporting it. Read these numbers as
 * *register* evidence, never as corpus accuracy, and never compare them against
 * URMP's as if they were the same kind of thing.
 *
 * Layout, and why. Each clip is 8 notes at one dynamic from one instrument,
 * inside one band, alternating between two note layouts so both onset classes
 * exist:
 *   `legato`   — notes butt against each other with no silence, so every onset
 *                after the first is a real pitch TRANSITION. That is the
 *                harness's weakest measured component and the synthetic corpus
 *                cannot produce one honestly (see `scenarios.ts` on `gapSec`).
 *   `detached` — 80 ms of silence between notes: the easy silence-onset case,
 *                kept as the paired control.
 *
 * Output: fixtures/eval-real/context/tinysol-<instrument>/…  (one dataset per instrument,
 * mirroring fetch/fetch-urmp.ts's convention so a per-instrument question stays askable)
 *
 * Source : https://zenodo.org/records/3685367   (TinySOL v6, 1.0 GB tar.gz)
 * License: CC-BY-4.0 — Cella, Ghisi, Lostanlen, Lévy, Fineberg, Maresz.
 *
 * Idempotent; the archive is cached (gitignored) under scripts/eval/.cache.
 * Run: pnpm --filter api exec tsx scripts/eval/fetch/fetch-tinysol.ts
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { floatToWav, wavToFloat } from '../lib/wav';
import type { GroundTruth, TruthNote } from '../types';

const RECORD = 'https://zenodo.org/records/3685367/files';
const CACHE = resolve(__dirname, '../.cache');
const TARBALL = join(CACHE, 'TinySOL.tar.gz');
const META = join(CACHE, 'TinySOL_metadata.csv');
const EXTRACT = join(CACHE, 'tinysol');
const OUT_ROOT = resolve(__dirname, '../../fixtures/eval-real/context');

const SAMPLE_RATE = 44100;

/** How long each spliced note lasts (clip length = PATTERN.length × this). */
const NOTE_SEC = 0.35;
const DETACHED_GAP_SEC = 0.08;
/** Fade applied at the splice point only — the attack is never touched. */
const FADE_OUT_SEC = 0.006;
/**
 * Where a note is considered to start: the first sample above this fraction of
 * the file's peak. SOL's files carry a short lead-in, and a soft flute `pp`
 * attack rises slowly, so the convention matters and is recorded here: −34 dBFS
 * relative to the note's own peak, which leaves the perceptual attack intact and
 * puts the truth onset within ~10 ms of it.
 */
const ONSET_THRESHOLD = 0.02;

/**
 * Bands, named for the profile bands they exercise (`PROFILE_BANDS`). `very-high`
 * is the one that has no real audio today; `high` is included as the paired
 * control, so a difference between them is readable as a band effect rather than
 * as "these clips are constructed".
 */
const BANDS = [
  { id: 'high', minMidi: 77, maxMidi: 85 },
  { id: 'very-high', minMidi: 86, maxMidi: 100 },
] as const;

const DYNAMICS = ['pp', 'mf', 'ff'] as const;

/**
 * Instruments worth extracting: everything whose range actually enters the
 * bands above. `instrumentId` mirrors the app's own ids so the resolver gets the
 * same hint a user picking that instrument would give it; the accordion has no
 * app id, so it is deliberately hinted with nothing and resolves from the audio
 * (which is also the more realistic path for it).
 */
const INSTRUMENTS: { abbr: string; dataset: string; instrumentId?: string; label: string }[] = [
  { abbr: 'Fl', dataset: 'tinysol-flute', instrumentId: 'flute', label: 'Flute' },
  { abbr: 'Ob', dataset: 'tinysol-oboe', instrumentId: 'oboe', label: 'Oboe' },
  { abbr: 'ClBb', dataset: 'tinysol-clarinet', instrumentId: 'clarinet', label: 'Clarinet in B♭' },
  { abbr: 'Vn', dataset: 'tinysol-violin', instrumentId: 'violin', label: 'Violin' },
  { abbr: 'Va', dataset: 'tinysol-viola', instrumentId: 'viola', label: 'Viola' },
  { abbr: 'Acc', dataset: 'tinysol-accordion', label: 'Accordion' },
];

/**
 * The pitch pattern a clip walks through the band's available notes, as indices
 * into the sorted list of pitches actually present. Mixes steps with leaps
 * (a pure chromatic run would let a tracker coast on continuity) and returns
 * near its start so a clip covers a compact tessitura rather than a glissando.
 */
const PATTERN = [0, 2, 4, 2, 7, 5, 3, 0];

interface MetaRow {
  path: string;
  abbr: string;
  midi: number;
  dynamics: string;
}

function download(url: string, out: string, label: string): void {
  if (existsSync(out)) return;
  mkdirSync(CACHE, { recursive: true });
  console.log(`  downloading ${label} …`);
  execFileSync('curl', ['-sL', '--fail', '--max-time', '3600', '-o', out, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function readMetadata(): MetaRow[] {
  const lines = readFileSync(META, 'utf8').split('\n');
  const header = lines[0].split(',');
  const iPath = header.indexOf('Path');
  const iAbbr = header.indexOf('Instrument (abbr.)');
  const iPitch = header.indexOf('Pitch ID');
  const iDyn = header.indexOf('Dynamics');
  const rows: MetaRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    const midi = Number(cols[iPitch]);
    if (!Number.isFinite(midi)) continue;
    rows.push({ path: cols[iPath], abbr: cols[iAbbr], midi, dynamics: cols[iDyn] });
  }
  return rows;
}

/**
 * Extract only the members we will actually splice. TinySOL uncompresses to
 * ~1.5 GB; the selection is a few hundred files, and `tar -T` takes the list.
 *
 * The archive has NO top-level directory — its members are `./Winds/Flute/…`, so
 * the member list is written with that exact `./` prefix (tar matches member
 * names literally) and files land straight under EXTRACT.
 */
function extract(paths: string[]): void {
  const missing = paths.filter((p) => !existsSync(join(EXTRACT, p)));
  if (!missing.length) return;
  mkdirSync(EXTRACT, { recursive: true });
  const listFile = join(CACHE, 'tinysol-members.txt');
  writeFileSync(listFile, `${missing.map((p) => `./${p}`).join('\n')}\n`);
  console.log(`  extracting ${missing.length} members …`);
  execFileSync('tar', ['-xzf', TARBALL, '-C', EXTRACT, '-T', listFile], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/** One note, trimmed to its attack, cut to NOTE_SEC, faded out at the splice. */
function noteSamples(path: string): Float32Array {
  const { samples, sampleRate } = wavToFloat(readFileSync(path));
  if (sampleRate !== SAMPLE_RATE) {
    throw new Error(`${path}: expected ${SAMPLE_RATE} Hz, got ${sampleRate}`);
  }
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const floor = peak * ONSET_THRESHOLD;
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < floor) start += 1;

  const length = Math.min(Math.round(NOTE_SEC * SAMPLE_RATE), samples.length - start);
  const out = samples.slice(start, start + length);
  const fade = Math.min(Math.round(FADE_OUT_SEC * SAMPLE_RATE), out.length);
  for (let i = 0; i < fade; i += 1) {
    out[out.length - fade + i] *= 1 - i / fade;
  }
  return out;
}

interface Clip {
  id: string;
  samples: Float32Array;
  truth: GroundTruth;
}

function buildClip(
  id: string,
  files: { path: string; midi: number }[],
  gapSec: number,
): Clip {
  const gap = Math.round(gapSec * SAMPLE_RATE);
  const parts = files.map((f) => noteSamples(f.path));
  const total = parts.reduce((n, p) => n + p.length, 0) + gap * (parts.length - 1);
  const samples = new Float32Array(total);
  const notes: TruthNote[] = [];
  let cursor = 0;
  for (let i = 0; i < parts.length; i += 1) {
    samples.set(parts[i], cursor);
    notes.push({
      onsetSec: cursor / SAMPLE_RATE,
      durSec: parts[i].length / SAMPLE_RATE,
      midi: files[i].midi,
    });
    cursor += parts[i].length + (i < parts.length - 1 ? gap : 0);
  }
  // bpm is nominal: the metrics compare onsets in seconds (same convention as
  // every other real fetcher), and a spliced clip has no tempo to annotate.
  return { id, samples, truth: { bpm: 120, notes } };
}

function main(): void {
  download(`${RECORD}/TinySOL_metadata.csv?download=1`, META, 'TinySOL_metadata.csv (0.3 MB)');
  download(`${RECORD}/TinySOL.tar.gz?download=1`, TARBALL, 'TinySOL.tar.gz (~1.0 GB)');

  const rows = readMetadata();

  // Plan every clip first, so extraction touches the archive exactly once.
  interface Plan {
    dataset: string;
    id: string;
    gapSec: number;
    files: { path: string; midi: number }[];
  }
  const plans: Plan[] = [];
  for (const inst of INSTRUMENTS) {
    for (const band of BANDS) {
      for (const dyn of DYNAMICS) {
        const pool = rows
          .filter(
            (r) =>
              r.abbr === inst.abbr &&
              r.dynamics === dyn &&
              r.midi >= band.minMidi &&
              r.midi <= band.maxMidi,
          )
          // One file per pitch (SOL has repeated instances/strings for some).
          .reduce((acc: MetaRow[], r) => {
            if (!acc.some((x) => x.midi === r.midi)) acc.push(r);
            return acc;
          }, [])
          .sort((a, b) => a.midi - b.midi);
        const span = Math.max(...PATTERN) + 1;
        if (pool.length < span) continue;

        // Two clips per (instrument, band, dynamic): one of each layout, drawn
        // from the low and high end of the available pitches so the pair also
        // covers the band rather than repeating one tessitura.
        const layouts = [
          { name: 'legato', gapSec: 0, offset: 0 },
          { name: 'detached', gapSec: DETACHED_GAP_SEC, offset: pool.length - span },
        ];
        for (const layout of layouts) {
          const files = PATTERN.map((d) => {
            const row = pool[layout.offset + d];
            return { path: join(EXTRACT, row.path), midi: row.midi };
          });
          plans.push({
            dataset: inst.dataset,
            id: `${inst.abbr.toLowerCase()}-${band.id}-${dyn}-${layout.name}`,
            gapSec: layout.gapSec,
            files,
          });
        }
      }
    }
  }

  extract([
    ...new Set(
      plans.flatMap((p) => p.files.map((f) => f.path.slice(EXTRACT.length + 1))),
    ),
  ]);

  const byDataset = new Map<string, Plan[]>();
  for (const p of plans) {
    const list = byDataset.get(p.dataset) ?? [];
    list.push(p);
    byDataset.set(p.dataset, list);
  }

  let totalClips = 0;
  let totalNotes = 0;
  for (const inst of INSTRUMENTS) {
    const list = byDataset.get(inst.dataset) ?? [];
    if (!list.length) {
      console.log(`  ${inst.dataset}: no band has ${Math.max(...PATTERN) + 1} pitches — skipped`);
      continue;
    }
    const out = join(OUT_ROOT, inst.dataset);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });

    let notes = 0;
    for (const plan of list) {
      const clip = buildClip(plan.id, plan.files, plan.gapSec);
      writeFileSync(join(out, `${clip.id}__real.wav`), floatToWav(clip.samples, SAMPLE_RATE));
      writeFileSync(
        join(out, `${clip.id}.truth.json`),
        `${JSON.stringify(clip.truth, null, 2)}\n`,
      );
      notes += clip.truth.notes.length;
    }

    const pitches = list.flatMap((p) => p.files.map((f) => f.midi));
    writeFileSync(
      join(out, 'dataset.json'),
      `${JSON.stringify(
        {
          id: inst.dataset,
          label: `TinySOL ${inst.label} (real notes, spliced melodies)`,
          kind: 'instrument',
          instrumentId: inst.instrumentId,
          constructedPerformance: true,
          source: 'https://zenodo.org/records/3685367',
          license: 'CC-BY-4.0',
          clips: list.length,
          totalNotes: notes,
          midiRange: [Math.min(...pitches), Math.max(...pitches)],
          noteSec: NOTE_SEC,
          layouts: ['legato (0 ms gap → real pitch transitions)', `detached (${DETACHED_GAP_SEC * 1000} ms gap)`],
          note: 'Real Ircam recordings of single notes, trimmed at −34 dBFS of their own peak and spliced. Truth is exact by construction; the phrasing is not human. Not pooled — see constructedPerformance in lib/realCorpus.ts.',
        },
        null,
        2,
      )}\n`,
    );
    console.log(
      `  ${inst.dataset}: ${list.length} clips, ${notes} notes, MIDI ${Math.min(...pitches)}–${Math.max(...pitches)}`,
    );
    totalClips += list.length;
    totalNotes += notes;
  }

  console.log(`\nBuilt ${totalClips} clips / ${totalNotes} notes under ${OUT_ROOT}`);
  console.log(
    'Run: EVAL_REAL=1 EVAL_ADAPTIVE=1 EVAL_SCENARIOS=tinysol-flute,tinysol-violin ' +
      'pnpm --filter api exec tsx scripts/eval/run-eval.ts',
  );
}

main();
