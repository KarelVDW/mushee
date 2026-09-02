/**
 * HumTrans (Liu et al., ICASSP 2024) — real HUMMING at scale: 10 hummers, 500
 * melodies × 2 segments × 2 repetitions, 56 h, 44.1 kHz. Each segment ships the
 * reference MIDI the hummer followed. `dadinghh2/HumTrans` on Hugging Face,
 * licence **CC BY-NC 4.0**.
 *
 * Why it is here despite NC. The register barred it twice (research-voice-datasets
 * §4.1): NC, and "labels not aligned". On 2026-09-01 the product owner reset the
 * bar to *defensible use* — internal evaluation, nothing redistributed, nothing of
 * it enters the product — and asked for the humming benchmark group to be
 * completed; this is the only hummed corpus in existence with any note truth at
 * all. It is recorded as `licenceRestricted` (lib/realCorpus.ts): reported,
 * shown with its licence, never a benchmark-tier dataset, deletable in one
 * `rm -r` if the decision changes.
 *
 * What the labels are, and what this fetcher does about them. The MIDI is the
 * melody the subject was asked to hum, "synchronised with the rhythm of the
 * played melody… without any post-processing" — so note IDENTITY is exact and
 * TIMING is the reference's, not the performance's (Dynamic HumTrans, arXiv
 * 2410.05455 §1.2). That is precisely the shape `fetch/align-prescribed-truth.ts`
 * repairs: identity from the score, onsets from the audio. This fetcher writes
 * the prescribed truth as `humtrans` (context, `noteTruthDerived`) and the
 * aligned sibling is produced by
 *
 *   ALIGN_MIN_HZ=70 ALIGN_MAX_HZ=1200 ALIGN_OCTAVE_INVARIANT=1 \
 *     tsx scripts/eval/fetch/align-prescribed-truth.ts --dataset=context/humtrans --out=humtrans-aligned
 *
 * Subset: the corpus's own TEST split (769 segments) by default — nobody's
 * tuning set, and the half its own baselines are reported on. The 14.7 GB
 * archive is never downloaded: `lib/remoteZip.ts` reads its central directory
 * and pulls only the wanted members by byte range (~1 MB each).
 *
 * Env: HUMTRANS_SPLIT=TEST|VALID|TRAIN (TEST), HUMTRANS_MAX (all), HUMTRANS_FORCE=1
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { parseMidiNotes } from '../lib/midi';
import { readCentralDirectory, readZipEntry, type ZipEntry } from '../lib/remoteZip';
import { wavToFloat } from '../lib/wav';
import type { GroundTruth } from '../types';

const REPO = 'https://huggingface.co/datasets/dadinghh2/HumTrans/resolve/main';
const CACHE = resolve(__dirname, '../.cache/humtrans');
const OUT = resolve(__dirname, '../../fixtures/eval-real/context/humtrans');
const SPLIT = (process.env.HUMTRANS_SPLIT ?? 'TEST').toUpperCase();
const MAX = Number(process.env.HUMTRANS_MAX) || Infinity;

function download(url: string, dest: string): void {
  if (existsSync(dest)) return;
  execFileSync('curl', ['-sL', '--fail', '--max-time', '900', '-o', dest, url], { stdio: 'inherit' });
}

/** The archive lives behind a signed CDN redirect; ranged GETs need the final URL. */
function resolveRedirect(url: string): string {
  const head = execFileSync('curl', ['-sIL', url], { encoding: 'utf8' });
  const locations = [...head.matchAll(/^location:\s*(\S+)/gim)].map((m) => m[1]);
  return locations.length ? locations[locations.length - 1] : url;
}

function main(): void {
  mkdirSync(CACHE, { recursive: true });
  if (process.env.HUMTRANS_FORCE === '1') rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const midiZip = join(CACHE, 'all_midi.zip');
  const keysPath = join(CACHE, 'train_valid_test_keys.json');
  download(`${REPO}/all_midi.zip`, midiZip);
  download(`${REPO}/train_valid_test_keys.json`, keysPath);
  const midiDir = join(CACHE, 'midi');
  if (!existsSync(midiDir)) {
    mkdirSync(midiDir, { recursive: true });
    execFileSync('unzip', ['-oq', midiZip, '-d', midiDir], { stdio: 'inherit' });
  }

  const keys = JSON.parse(readFileSync(keysPath, 'utf8')) as Record<string, string[]>;
  const wanted = (keys[SPLIT] ?? []).slice(0, MAX);
  if (!wanted.length) throw new Error(`no keys for split ${SPLIT}`);

  console.log(`HumTrans: ${wanted.length} segments from the ${SPLIT} split → ${OUT}`);
  const wavUrl = resolveRedirect(`${REPO}/all_wav.zip`);
  const entries = readCentralDirectory(wavUrl, CACHE);
  const byBase = new Map<string, ZipEntry>();
  for (const e of entries) byBase.set(e.name.split('/').pop() ?? e.name, e);

  let clips = 0;
  let totalNotes = 0;
  const hummers = new Set<string>();
  for (const key of wanted) {
    const entry = byBase.get(`${key}.wav`);
    const midiPath = join(midiDir, 'midi_data', `${key}.mid`);
    if (!entry || !existsSync(midiPath)) {
      console.warn(`  ! ${key}: ${entry ? 'no MIDI' : 'no audio member'}, skipped`);
      continue;
    }
    const wavOut = join(OUT, `${key}__real.wav`);
    if (!existsSync(wavOut)) {
      // The signed URL expires; re-resolve if a member read fails once.
      let wav: Buffer;
      try {
        wav = readZipEntry(wavUrl, entry, CACHE);
      } catch {
        wav = readZipEntry(resolveRedirect(`${REPO}/all_wav.zip`), entry, CACHE);
      }
      wavToFloat(wav); // validates the container before we keep it
      writeFileSync(wavOut, wav);
    }
    const { notes, bpm } = parseMidiNotes(readFileSync(midiPath));
    if (!notes.length) {
      console.warn(`  ! ${key}: empty MIDI, skipped`);
      continue;
    }
    const truth: GroundTruth = { bpm, notes };
    writeFileSync(join(OUT, `${key}.truth.json`), `${JSON.stringify(truth, null, 2)}\n`);
    clips += 1;
    totalNotes += notes.length;
    hummers.add(key.split('_')[0]);
    if (clips % 50 === 0) console.log(`  ${clips}/${wanted.length}`);
  }

  writeFileSync(
    join(OUT, 'dataset.json'),
    `${JSON.stringify(
      {
        id: 'humtrans',
        label: `HumTrans — real humming, ${SPLIT.toLowerCase()} split (reference-MIDI truth)`,
        kind: 'voice',
        material: 'humming',
        instrumentId: 'voice-lead',
        corpusSplit: SPLIT.toLowerCase(),
        noteTruthDerived: true,
        license: 'CC-BY-NC-4.0',
        licenceRestricted: true,
        source: 'https://huggingface.co/datasets/dadinghh2/HumTrans',
        citation: 'Liu, Li et al., "HumTrans: A Novel Open-Source Dataset for Humming Melody Transcription and Beyond", ICASSP 2024',
        clips,
        totalNotes,
        hummers: [...hummers].sort(),
        note:
          'Truth here is the REFERENCE MIDI the subject hummed along to — exact note identity, nominal timing ' +
          '(Dynamic HumTrans §1.2: "not well aligned"). Use the performance-aligned sibling `humtrans-aligned` ' +
          '(fetch/align-prescribed-truth.ts) for any timing-sensitive number. CC BY-NC 4.0: internal evaluation only ' +
          'under the 2026-09-01 defensible-use standard; never redistributed, never pooled into the benchmark tier.',
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\n  → ${clips} clips / ${totalNotes} notes / ${hummers.size} hummers written to ${OUT}`);
}

main();
