/**
 * Fetch the STUDENT subset of JaCRC (Jingju a Cappella Recordings Collection)
 * as a PITCHLESS / onset-only dataset built from manual syllable boundaries.
 *
 * Output: scripts/fixtures/eval-real/benchmark/jacrc-students/<clip>.truth.json
 *         scripts/fixtures/eval-real/benchmark/jacrc-students/<clip>__real.wav
 *         scripts/fixtures/eval-real/benchmark/jacrc-students/dataset.json
 *
 * Source : https://zenodo.org/records/6536490
 * License: CC-BY-4.0 (Zenodo record licence field, verified 2026-08-13), and the
 *          record states the student recordings carry explicit written performer
 *          consent for public release.
 *
 * ## Why only the students folder
 *
 * The collection mixes provenances: `JaCRC-recordings/` at the top level holds
 * professional and commercially-released material, some of it sourced from SVAD
 * (Isophonics, CC-BY-NC-SA) — research/research-voice-datasets.md flags those rows as
 * must-exclude. `JaCRC-recordings/JaCRC-students-recordings/` is the subset the
 * project recorded itself, from conservatory students (adults and children),
 * with the documented consent. Only that folder is converted, which sidesteps
 * the provenance question entirely rather than trying to filter around it.
 *
 * Amateur students are also simply the better match for our users than the
 * professional recordings would be.
 *
 * ## What the truth is, and the one metric that means something
 *
 * The annotation is a manual SYLLABLE segmentation (`_syllable.txt`, tab
 * separated `start_sec, end_sec, label`, with `sil` for the gaps). Every
 * non-`sil` segment start is a real, human-placed onset with no pitch tracker
 * anywhere in the chain — which is exactly the independent onset evidence
 * research/research-voice-transcription.md wants for the re-onset problem.
 *
 * ⚠️ **Read RECALL here, not F1.** Jingju is heavily melismatic: one syllable is
 * routinely sung across many notes over several seconds. So the syllable onsets
 * are a strict SUBSET of the note onsets — a note onset the pipeline correctly
 * finds inside a melisma is a true detection that this truth does not list, and
 * counts as a false positive. Precision is therefore understated by
 * construction and is not a defect measurement; recall ("did we find the
 * syllable boundaries at all?") is the honest number. run-eval.ts reports
 * `onsetRecall` per scenario for exactly this reason, and `pitchless: true`
 * keeps the dataset out of the pooled headline.
 *
 * This is a hard case on purpose: long melismatic phrases on amateur voices are
 * the far end of the difficulty range, not a representative sample.
 *
 * Only the bytes needed are transferred — the 7.1 GB recordings archive is read
 * member-by-member through `lib/remoteZip.ts` ranged GETs.
 *
 * Idempotent. Run: pnpm --filter @mushee/api exec tsx scripts/eval/fetch/fetch-jacrc.ts
 */

import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { basename, join, resolve } from 'path';

import { readCentralDirectory, readZipEntry } from '../lib/remoteZip';
import type { GroundTruth, TruthNote } from '../types';

const ANNOT_URL =
  'https://zenodo.org/api/records/6536490/files/JaCRC-annotations.zip/content';
const AUDIO_ZIP_URL =
  'https://zenodo.org/api/records/6536490/files/JaCRC-recordings.zip/content';

const CACHE = resolve(__dirname, '../.cache', 'jacrc');
const ANNOT_ZIP = join(CACHE, 'JaCRC-annotations.zip');
const ANNOT_DIR = join(CACHE, 'annotations');
const OUT = resolve(__dirname, '../../fixtures/eval-real/benchmark/jacrc-students');

const NOMINAL_BPM = 120;
const EXCERPT_SEC = Number(process.env.JACRC_EXCERPT_SEC) || 30;
const MAX_EXCERPTS_PER_FILE = Number(process.env.JACRC_MAX_EXCERPTS) || 4;
/** Fewer syllables than this in a window is not worth a pipeline run. */
const MIN_ONSETS = 4;
/** No pitch exists in this corpus; TruthNote needs the field regardless. */
const PLACEHOLDER_MIDI = 60;

function download(url: string, dest: string, label: string): void {
  if (existsSync(dest)) {
    console.log(`  ${label} already cached`);
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  console.log(`  downloading ${label} …`);
  execFileSync('curl', ['-sL', '--fail', '--max-time', '900', '-o', dest, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

interface Syllable { startSec: number; endSec: number; label: string }

/** Tab-separated `start end label`; `sil` marks the gaps, not a syllable. */
function parseSyllables(txt: string): Syllable[] {
  const out: Syllable[] = [];
  for (const line of txt.split('\n')) {
    const parts = line.trim().split(/\t+/);
    if (parts.length < 3) continue;
    const startSec = Number(parts[0]);
    const endSec = Number(parts[1]);
    const label = parts[2].trim();
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) continue;
    if (!label || label.toLowerCase() === 'sil') continue;
    out.push({ startSec, endSec, label });
  }
  out.sort((a, b) => a.startSec - b.startSec);
  return out;
}

/** Mono PCM16 WAV reader (chunk-walking), matching the other fetchers. */
function readWav(buf: Buffer): { samples: Buffer; sampleRate: number; channels: number } {
  let pos = 12;
  let sampleRate = 44100;
  let channels = 1;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(pos + 10);
      sampleRate = buf.readUInt32LE(pos + 12);
    } else if (id === 'data') {
      return { samples: buf.subarray(pos + 8, pos + 8 + size), sampleRate, channels };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error('no data chunk in WAV');
}

/** Write [startSec,endSec) of a (possibly stereo) PCM16 buffer as mono WAV. */
function writeWavSlice(
  samples: Buffer,
  sampleRate: number,
  channels: number,
  startSec: number,
  endSec: number,
  dest: string,
): void {
  const frameBytes = 2 * channels;
  const from = Math.max(0, Math.floor(startSec * sampleRate) * frameBytes);
  const to = Math.min(samples.length, Math.floor(endSec * sampleRate) * frameBytes);
  const frames = Math.max(0, Math.floor((to - from) / frameBytes));
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    // Keep only the first channel; the harness's real corpus is mono throughout.
    pcm.writeInt16LE(samples.readInt16LE(from + i * frameBytes), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(dest, Buffer.concat([header, pcm]));
}

function main(): void {
  download(ANNOT_URL, ANNOT_ZIP, 'JaCRC annotations (3 MB)');
  if (!existsSync(ANNOT_DIR)) {
    mkdirSync(ANNOT_DIR, { recursive: true });
    execFileSync('unzip', ['-oq', ANNOT_ZIP, '-d', ANNOT_DIR, '-x', '__MACOSX/*'], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  }

  // Syllable annotations live in `3-students/<name>_syllable.txt`.
  const studentsAnn = join(ANNOT_DIR, 'JaCRC-annotations', '3-students');
  const syllableFiles = readdirSync(studentsAnn).filter((f) => f.endsWith('_syllable.txt'));
  console.log(`  ${syllableFiles.length} syllable annotation files`);

  // Audio: ONLY the students-recordings folder (see the provenance note above).
  const entries = readCentralDirectory(AUDIO_ZIP_URL, CACHE);
  const studentAudio = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    if (!e.name.includes('/JaCRC-students-recordings/')) continue;
    if (!e.name.toLowerCase().endsWith('.wav')) continue;
    studentAudio.set(basename(e.name, '.wav'), e);
  }
  console.log(`  ${studentAudio.size} student recordings in the archive`);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  let clips = 0;
  let totalOnsets = 0;
  let skippedNoAudio = 0;
  const performers = new Set<string>();
  const sylDurations: number[] = [];

  for (const annFile of syllableFiles.sort()) {
    const stem = annFile.replace('_syllable.txt', '');
    const audio = studentAudio.get(stem);
    if (!audio) {
      // Teacher (`-T`) reference takes live in the top-level folder, which we
      // deliberately do not touch; they simply drop out here.
      skippedNoAudio += 1;
      continue;
    }
    const syllables = parseSyllables(readFileSync(join(studentsAnn, annFile), 'utf8'));
    if (syllables.length < MIN_ONSETS) continue;

    const { samples, sampleRate, channels } = readWav(readZipEntry(AUDIO_ZIP_URL, audio, CACHE));
    const durSec = samples.length / (2 * channels) / sampleRate;

    for (let i = 0; i < MAX_EXCERPTS_PER_FILE; i += 1) {
      const start = i * EXCERPT_SEC;
      const end = Math.min(durSec, start + EXCERPT_SEC);
      if (end - start < EXCERPT_SEC * 0.6) break;

      const inWin = syllables.filter((s) => s.startSec >= start && s.endSec <= end);
      if (inWin.length < MIN_ONSETS) continue;

      const notes: TruthNote[] = inWin.map((s) => {
        sylDurations.push(s.endSec - s.startSec);
        return {
          onsetSec: s.startSec - start,
          durSec: s.endSec - s.startSec,
          midi: PLACEHOLDER_MIDI,
        };
      });

      const clip = `${stem.replace(/[^A-Za-z0-9_-]/g, '_')}_ex${String(i).padStart(2, '0')}`;
      const truth: GroundTruth = { bpm: NOMINAL_BPM, notes };
      writeFileSync(join(OUT, `${clip}.truth.json`), JSON.stringify(truth, null, 2));
      writeWavSlice(samples, sampleRate, channels, start, end, join(OUT, `${clip}__real.wav`));
      clips += 1;
      totalOnsets += notes.length;
      // Trailing `-<school>-S<n>` identifies the performer within the corpus.
      // Match stops at the digits so `S2(1)`/`S2(2)` — two takes by the same
      // student — count as one performer, mirroring lib/split.ts's group key.
      const m = /-([a-z]+)-(S\d+)/.exec(stem);
      if (m) performers.add(`${m[1]}-${m[2]}`);
    }
  }

  sylDurations.sort((a, b) => a - b);
  const medianSyl = sylDurations.length
    ? sylDurations[Math.floor(sylDurations.length / 2)]
    : 0;

  const manifest = {
    id: 'jacrc-students',
    label: 'JaCRC students (amateur jingju, manual syllable onsets)',
    kind: 'voice',
    instrumentId: 'voice-lead',
    source: 'https://zenodo.org/records/6536490',
    license: 'CC-BY-4.0',
    pitchless: true,
    clips,
    totalOnsets,
    performers: performers.size,
    excerptSec: EXCERPT_SEC,
    medianSyllableSec: Number(medianSyl.toFixed(2)),
    notes:
      'Conservatory STUDENT recordings only (JaCRC-students-recordings/), which ' +
      'the record documents as carrying explicit written performer consent; the ' +
      'top-level folder mixes professional and commercially-released material ' +
      'including CC-BY-NC-SA SVAD sources and is deliberately untouched. Truth ' +
      'is the manual SYLLABLE segmentation with `sil` dropped — human-placed, no ' +
      'pitch tracker in the chain. READ RECALL, NOT F1: jingju is heavily ' +
      `melismatic (median syllable ${medianSyl.toFixed(2)} s), so syllable onsets ` +
      'are a strict subset of note onsets and a correct in-melisma detection ' +
      'scores as a false positive — precision is understated by construction. ' +
      `midi is a constant placeholder (${PLACEHOLDER_MIDI}). A deliberately hard ` +
      'case: long melismatic phrases on amateur voices.',
  };
  writeFileSync(join(OUT, 'dataset.json'), JSON.stringify(manifest, null, 2));

  if (skippedNoAudio) {
    console.log(`  ${skippedNoAudio} annotations had no student audio (teacher takes), skipped`);
  }
  console.log(
    `\nConverted ${clips} JaCRC student excerpts (${totalOnsets} syllable onsets, ` +
      `${performers.size} performers, median syllable ${medianSyl.toFixed(2)} s) into ${OUT}`,
  );
}

main();
