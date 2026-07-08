/**
 * Fetch Annotated-VocalSet (note-level annotations over the VocalSet corpus of
 * solo, monophonic, professional singing) and convert a representative SUBSET
 * into the eval harness's *real* corpus layout, so run-eval can score the
 * pipeline against studio-quality human singing of known melodic exercises.
 *
 * Output: scripts/fixtures/eval-real/annotated-vocalset/<clip>.truth.json ({bpm, notes})
 *         scripts/fixtures/eval-real/annotated-vocalset/<clip>__real.wav
 *         scripts/fixtures/eval-real/annotated-vocalset/dataset.json        (manifest)
 *
 * TWO sources are needed — the Zenodo record ships only annotations, not audio:
 *   1. Annotations: https://zenodo.org/records/7061507
 *        "Annotated VocalSet.zip" (~411 MB) — CSV note tables + JPG plots only,
 *        NO audio. License: CC-BY-4.0.
 *   2. Audio: https://zenodo.org/records/1193957  (the original VocalSet release)
 *        "VocalSet.zip" (~2.08 GB) — 3615 mono WAV clips. License: CC-BY-4.0.
 *        Public, un-gated; downloaded once and cached.
 *
 * Annotation format (the "extended 1/without file header" CSVs — header row 1,
 * then one row per detected segment; columns, 0-indexed):
 *    0 Sequence  1 Start time(s)  2 End time(s)  3 Duration(s)  4 Type
 *    5..10 F0 stats   11 Estimated MIDI code (pYIN-derived, fractional)
 *    12 Ground truth Note name   13 Ground Truth Frequency(Hz)
 *    14 Ground Truth MIDI code (integer)   15 Lyric   16.. note-duration / intervals
 * `Type` is Rest | Sound | Transition. Only `Sound` rows are notes. The four
 * "extended N" trees differ only in the F0 smoothing/segmentation that sets the
 * onset/offset boundaries; the Ground-Truth pitch columns (12-14) are IDENTICAL
 * across all four because they come from the exercise's SCORE, not a tracker. We
 * use "extended 1".
 *
 * Ground-truth provenance / circularity note: the note PITCH is the score pitch
 * (the singer was performing a written scale/arpeggio), so it is not derived from
 * any pitch tracker. The note TIMING (onset/offset) is semi-automatic — the
 * authors segmented pYIN+Smart-Median F0 contours and manually reviewed/corrected
 * them. So timing GT is tracker-assisted (pYIN, NOT CREPE) and should be treated
 * as approximate; pitch GT is reliable. Because the dataset's tracker is pYIN and
 * our pipeline's default is CREPE/basic-pitch, the GT is not a tautology against
 * our own estimator — but timing tolerances in scoring should stay generous.
 *
 * Note -> {onsetSec, durSec, midi}: onset/dur from the Start/Duration columns;
 * midi from the integer Ground-Truth MIDI (col 14), falling back to round(hzToMidi
 * (col 13)) if the integer is missing. Zero-duration / pitchless Sound rows are
 * dropped (32 such degenerate rows exist across the corpus).
 *
 * Subset: the corpus has 2688 annotated clips. We convert ~50 spanning all 20
 * singers and a curated set of melodic techniques (scales/arpeggios in standard
 * production styles; the rapid-oscillation trills and pitchless "spoken" clips
 * are excluded), picked round-robin for breadth. Converting all 2688 would be
 * ~1.7 GB of fixture WAV for no extra signal; a balanced subset is enough to
 * characterise the pipeline on real voices.
 *
 * Both zips and their extracted trees are cached (gitignored) under
 * scripts/eval/.cache and re-converted on each run; only this script is tracked,
 * exactly like generate.ts is the tracked source of the synthetic corpus.
 *
 * Idempotent. Run: pnpm --filter api exec tsx scripts/eval/fetch-annotated-vocalset.ts
 */

import { execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { basename,join, resolve } from 'path';

import { hzToMidi } from './lib/groundTruth';
import type { GroundTruth, TruthNote } from './types';

const NOTES_URL =
  'https://zenodo.org/api/records/7061507/files/Annotated%20VocalSet.zip/content';
const AUDIO_URL =
  'https://zenodo.org/api/records/1193957/files/VocalSet.zip/content';

const CACHE = resolve(__dirname, '.cache', 'annotated-vocalset');
const NOTES_ZIP = join(CACHE, 'annotated-vocalset.zip');
const AUDIO_ZIP = join(CACHE, 'vocalset-audio.zip');
const NOTES_EXTRACT = join(CACHE, 'annotations'); // -> Annotated VocalSet/…
const AUDIO_EXTRACT = join(CACHE, 'audio'); // -> FULL/<singer>/…
const OUT = resolve(__dirname, '../fixtures/eval-real/annotated-vocalset');

// Which of the four smoothing variants to read. Pitch GT is identical across
// them; "extended 1" keeps the finest onset/offset segmentation.
const ANNOT_SUBDIR = join('extended 1', 'without file header');

// Singing scales/arpeggios are free-tempo; bpm is only handed to the converter's
// quantizer and does not affect the seconds-based scoring metrics. Mirrors the
// nominal tempo the live pipeline assumes absent a user-set one.
const NOMINAL_BPM = 120;

// Plausible sung register (MIDI). Drops octave-error / garbage GT rows.
const MIN_MIDI = 40;
const MAX_MIDI = 84;

// Target subset size and the per-clip minimum note count for inclusion.
const SUBSET_TARGET = 50;
const MIN_NOTES = 5;

// Techniques worth scoring: standard melodic production of written scales /
// arpeggios with clear, discrete pitch targets. Excludes "spoken" (no melody)
// and the rapid-oscillation trills/lip_trill/trillo (note boundaries are
// ill-defined for a frame-segmenter, so their GT timing is least trustworthy).
const TECHNIQUES = [
  'straight',
  'vibrato',
  'forte',
  'belt',
  'breathy',
  'messa',
  'slow_forte',
  'slow_piano',
  'fast_forte',
  'fast_piano',
];

function download(url: string, dest: string, label: string): void {
  if (existsSync(dest)) {
    console.log(`  ${label} already cached: ${dest}`);
    return;
  }
  mkdirSync(CACHE, { recursive: true });
  console.log(`  downloading ${label} …`);
  execFileSync('curl', ['-sL', '--fail', '--max-time', '3000', '-o', dest, url], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

function extract(zip: string, into: string, sentinel: string, label: string): void {
  if (existsSync(join(into, sentinel))) {
    console.log(`  ${label} already extracted: ${into}`);
    return;
  }
  mkdirSync(into, { recursive: true });
  // -o overwrite, -q quiet, -x drops the macOS resource-fork sidecar files.
  execFileSync('unzip', ['-oq', zip, '-d', into, '-x', '__MACOSX/*'], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/** Recursively collect every file under `root` whose name ends with `suffix`. */
function listFiles(root: string, suffix: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(suffix)) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** Map clip basename (no extension) -> absolute path, for the first occurrence. */
function indexByBasename(paths: string[], suffix: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of paths) {
    const key = basename(p, suffix);
    if (!m.has(key)) m.set(key, p);
  }
  return m;
}

/**
 * Parse one Annotated-VocalSet note CSV (header row 1, then segment rows) into
 * timed integer-MIDI notes. Only `Sound` rows are notes; pitch is the integer
 * Ground-Truth MIDI (col 14), falling back to round(hzToMidi(GT Freq col 13))
 * when the integer is absent. Zero-duration, pitchless, or out-of-register rows
 * are dropped.
 */
function parseNotes(csv: string): TruthNote[] {
  const notes: TruthNote[] = [];
  const lines = csv.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(',');
    // Header / metadata lines: first cell is not a numeric sequence index.
    if (!Number.isFinite(Number(cols[0]))) continue;
    if (cols[4]?.trim() !== 'Sound') continue;

    const onsetSec = Number(cols[1]);
    const durSec = Number(cols[3]);
    if (!Number.isFinite(onsetSec) || !Number.isFinite(durSec) || durSec <= 0) continue;

    const gtMidiInt = Number(cols[14]);
    const gtFreq = Number(cols[13]);
    let midi: number;
    if (Number.isFinite(gtMidiInt) && gtMidiInt > 0) {
      midi = Math.round(gtMidiInt);
    } else if (Number.isFinite(gtFreq) && gtFreq > 0) {
      midi = Math.round(hzToMidi(gtFreq));
    } else {
      continue; // degenerate row with no usable ground-truth pitch
    }
    if (midi < MIN_MIDI || midi > MAX_MIDI) continue;

    notes.push({ onsetSec, durSec, midi });
  }
  notes.sort((a, b) => a.onsetSec - b.onsetSec);
  return notes;
}

/** Singer id (e.g. "f1", "m11") parsed from a clip basename, or null. */
function singerOf(clip: string): string | null {
  const m = /^([fm]\d+)_/.exec(clip);
  return m ? m[1] : null;
}

/**
 * Audio duration in seconds via bundled ffmpeg, or null if it can't be read.
 * Used to reject clips whose annotation timeline overruns the audio — a known
 * inconsistency in the source corpus (a handful of clips were annotated against
 * a different/longer take), which would otherwise place ground-truth notes past
 * the end of the file.
 */
function audioDurationSec(wav: string): number | null {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not available');
  let stderr = '';
  try {
    execFileSync(ffmpegPath, ['-hide_banner', '-i', wav], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    // ffmpeg exits non-zero when given no output (it only prints stream info).
    stderr = String((e as { stderr?: Buffer }).stderr ?? '');
  }
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Technique tag of a clip = the parent directory name of its CSV. */
function techniqueOf(csvPath: string): string {
  return basename(join(csvPath, '..'));
}

interface Candidate {
  clip: string;
  csv: string;
  wav: string;
  technique: string;
  singer: string;
  notes: TruthNote[];
}

/**
 * Materialize a clip's audio as WAV at `dest`. VocalSet already ships WAV, so the
 * common path is a verbatim copy; anything else is transcoded with bundled ffmpeg
 * (kept per the harness contract, in case a future release ships flac/mp3).
 */
function writeWav(src: string, dest: string): void {
  if (src.toLowerCase().endsWith('.wav')) {
    copyFileSync(src, dest);
    return;
  }
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not available for transcode');
  execFileSync(ffmpegPath, ['-y', '-i', src, '-ac', '1', dest], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/**
 * Pick a breadth-first subset that spans both axes of the corpus. We round-robin
 * over techniques, and on each pull take the clip whose SINGER is currently the
 * least represented in the subset (ties broken by clip name). This keeps the
 * result from collapsing onto the alphabetically-first voices (f1, f2, …) and
 * pulls in the male singers and later voices too. Deterministic.
 *
 * `accept` is consulted before a candidate is committed (e.g. an audio/annotation
 * alignment check). A rejected candidate is dropped from its queue and the next
 * eligible clip from the same technique is considered, so rejections do not
 * shrink the subset. Probing lazily here keeps the (slow) ffmpeg duration check
 * to ~the subset size rather than the whole eligible pool.
 */
function pickSubset(
  candidates: Candidate[],
  target: number,
  accept: (c: Candidate) => boolean,
): Candidate[] {
  const byTech = new Map<string, Candidate[]>();
  for (const c of candidates) {
    let list = byTech.get(c.technique);
    if (!list) {
      list = [];
      byTech.set(c.technique, list);
    }
    list.push(c);
  }
  for (const list of Array.from(byTech.values())) list.sort((a, b) => a.clip.localeCompare(b.clip));

  const techQueues = TECHNIQUES.map((t) => byTech.get(t) ?? []).filter((q) => q.length);
  const chosen: Candidate[] = [];
  const singerCount = new Map<string, number>();

  let any = true;
  while (chosen.length < target && any) {
    any = false;
    for (const q of techQueues) {
      if (chosen.length >= target) break;
      // From this technique, repeatedly take the still-available clip whose
      // singer we've used least (then earliest clip name) until one is accepted
      // or the queue is exhausted.
      while (q.length) {
        let bestIdx = -1;
        let bestKey: [number, string] | null = null;
        for (let i = 0; i < q.length; i++) {
          const key: [number, string] = [singerCount.get(q[i].singer) ?? 0, q[i].clip];
          if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
            bestKey = key;
            bestIdx = i;
          }
        }
        const next = q.splice(bestIdx, 1)[0];
        if (!accept(next)) continue; // drop and try the next from this technique
        chosen.push(next);
        singerCount.set(next.singer, (singerCount.get(next.singer) ?? 0) + 1);
        any = true;
        break;
      }
    }
  }
  return chosen;
}

function main(): void {
  download(NOTES_URL, NOTES_ZIP, 'Annotated VocalSet annotations (~411 MB)');
  download(AUDIO_URL, AUDIO_ZIP, 'VocalSet audio (~2.08 GB)');
  extract(NOTES_ZIP, NOTES_EXTRACT, 'Annotated VocalSet', 'annotations');
  extract(AUDIO_ZIP, AUDIO_EXTRACT, 'FULL', 'audio');

  const notesRoot = join(NOTES_EXTRACT, 'Annotated VocalSet', ANNOT_SUBDIR);
  const csvFiles = listFiles(notesRoot, '.csv').filter((p) =>
    TECHNIQUES.includes(techniqueOf(p)),
  );
  const wavByClip = indexByBasename(listFiles(AUDIO_EXTRACT, '.wav'), '.wav');
  console.log(
    `  ${csvFiles.length} annotated clips in target techniques; ${wavByClip.size} audio clips`,
  );

  // Build candidates: clips that have both audio and >= MIN_NOTES parsed notes.
  const candidates: Candidate[] = [];
  for (const csv of csvFiles) {
    const clip = basename(csv, '.csv');
    const wav = wavByClip.get(clip);
    if (!wav) continue;
    const singer = singerOf(clip);
    if (!singer) continue;
    const notes = parseNotes(readFileSync(csv, 'utf8'));
    if (notes.length < MIN_NOTES) continue;
    candidates.push({ clip, csv, wav, technique: techniqueOf(csv), singer, notes });
  }
  candidates.sort((a, b) => a.clip.localeCompare(b.clip));
  console.log(`  ${candidates.length} clips have audio + >=${MIN_NOTES} notes`);

  // Reject clips whose annotation timeline overruns the audio (a handful of
  // source-corpus clips were annotated against a longer take). 0.5 s slack.
  let rejected = 0;
  const aligned = (c: Candidate): boolean => {
    const dur = audioDurationSec(c.wav);
    if (dur === null) return false;
    const lastEnd = c.notes[c.notes.length - 1].onsetSec + c.notes[c.notes.length - 1].durSec;
    if (lastEnd > dur + 0.5) {
      rejected += 1;
      return false;
    }
    return true;
  };

  const chosen = pickSubset(candidates, SUBSET_TARGET, aligned);
  if (rejected) console.log(`  skipped ${rejected} clips whose annotation overran the audio`);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  let clips = 0;
  let totalNotes = 0;
  const singers = new Set<string>();
  const techniques = new Set<string>();
  for (const c of chosen) {
    const truth: GroundTruth = { bpm: NOMINAL_BPM, notes: c.notes };
    writeFileSync(join(OUT, `${c.clip}.truth.json`), JSON.stringify(truth, null, 2));
    writeWav(c.wav, join(OUT, `${c.clip}__real.wav`));
    clips += 1;
    totalNotes += c.notes.length;
    singers.add(c.singer);
    techniques.add(c.technique);
  }

  // Manifest read by run-eval (EVAL_REAL) for the dataset's display label and
  // adaptive instrument hint — 'voice-lead' mirrors a user picking "voice".
  const manifest = {
    id: 'annotated-vocalset',
    label: 'Annotated-VocalSet (real solo singing, subset)',
    kind: 'voice',
    instrumentId: 'voice-lead',
    source: 'https://zenodo.org/records/7061507',
    license: 'CC-BY-4.0',
    clips,
    totalNotes,
    notes:
      `Representative subset of ${clips}/${candidates.length} eligible clips ` +
      `(corpus has 2688 annotated clips), spanning ${singers.size} singers and ` +
      `${techniques.size} techniques (${Array.from(techniques).sort().join(', ')}). ` +
      'Audio is the original VocalSet release (https://zenodo.org/records/1193957, ' +
      'CC-BY-4.0); the Zenodo annotation record ships no audio. Ground-truth note ' +
      'PITCH is the written exercise score (integer MIDI, col "Ground Truth MIDI ' +
      'code"), so it is not pitch-tracker-derived. Ground-truth note TIMING ' +
      '(onset/offset) is SEMI-AUTOMATIC: the authors segmented pYIN+Smart-Median ' +
      'F0 contours and reviewed them, so onsets/durations are approximate — keep ' +
      'scoring tolerances generous. The tracker used (pYIN) differs from the ' +
      "pipeline's CREPE/basic-pitch, so the GT is not circular against our own " +
      'estimator, but it is still tracker-assisted. Only "Sound" rows of the ' +
      '"extended 1" variant are converted; rests/transitions are dropped.',
  };
  writeFileSync(join(OUT, 'dataset.json'), JSON.stringify(manifest, null, 2));

  console.log(
    `\nConverted ${clips} Annotated-VocalSet clips (${totalNotes} notes, ` +
      `${singers.size} singers, ${techniques.size} techniques) into ${OUT}`,
  );
  console.log(
    'Run: EVAL_REAL=1 EVAL_ADAPTIVE=1 pnpm --filter api exec tsx scripts/eval/run-eval.ts',
  );
}

main();
