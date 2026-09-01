/**
 * Fetch URMP (University of Rochester Multi-Modal Music Performance) and convert
 * a SUBSET of its isolated single-instrument tracks into the eval harness's
 * *real* corpus layout. This is the harness's only source of real MONOPHONIC
 * INSTRUMENT audio — every other real dataset is singing, and the instrument
 * side of the product was until now tested exclusively against fluidsynth
 * renders, which say nothing about real attacks, bow noise, or breath.
 *
 * Output: scripts/fixtures/eval-real/benchmark/urmp-<instrument>/<clip>.truth.json ({bpm, notes})
 *         scripts/fixtures/eval-real/benchmark/urmp-<instrument>/<clip>__real.wav
 *         scripts/fixtures/eval-real/benchmark/urmp-<instrument>/dataset.json        (manifest)
 *
 * One dataset directory PER INSTRUMENT (urmp-violin, urmp-flute, …) because the
 * adaptive instrument hint lives in `dataset.json` and is therefore per-dataset
 * (see lib/realCorpus.ts): URMP mixes instruments inside a single piece, so a
 * flat `urmp/` dir could only carry one — wrong — hint.
 *
 * Source : https://doi.org/10.5061/dryad.ng3r749  (Dryad)
 * License: CC0 1.0 (public domain dedication; no attribution required, though
 *          the authors ask that the IEEE TMM 2019 paper be cited).
 *
 * DOWNLOAD: Dryad ships the corpus as ONE 12 GB `Dataset.tar.gz` — 95% of which
 * is multi-track video we have no use for, and a gzip stream cannot be fetched
 * partially. So by default we pull only the files we need (the note annotations,
 * plus a byte RANGE of each isolated WAV covering just the clip window) from the
 * public file-per-file mirror of the same dataset on Hugging Face. Total
 * download is ~120 MB instead of 12 GB. Overridable:
 *   URMP_BASE_URL=<url-prefix>   another file-per-file mirror
 *   URMP_LOCAL_DIR=<path>        an already-extracted Dryad `Dataset/` tree,
 *                                which is the canonical, mirror-independent path
 *
 * Per-track annotations (`Notes_<part>_<instr>_<piece>.txt`, tab-separated):
 *   onset(s)  pitch(Hz, NOT quantised — it is the measured mean F0 of the note)
 *   duration(s)
 * Pitch is converted with hzToMidi and rounded, matching the other fetchers'
 * integer-MIDI truth format.
 *
 * Subset: 149 isolated tracks exist; we keep <=MAX_PER_INSTRUMENT per instrument
 * (50 clips over 13 instruments) and trim each to a WINDOW_SEC excerpt starting
 * at its first annotated note — full pieces are 40-120 s each, and the harness is
 * re-run constantly, so breadth across instruments buys far more than length.
 *
 * Idempotent; the fetched annotations and audio slices are cached (gitignored)
 * under scripts/eval/.cache/urmp.
 *
 * Run: pnpm --filter api exec tsx scripts/eval/fetch/fetch-urmp.ts
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import ffmpegPath from 'ffmpeg-static';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { hzToMidi } from '../lib/groundTruth';
import type { GroundTruth, TruthNote } from '../types';

// File-per-file mirror of the Dryad tarball (same 149 tracks, unmodified), which
// is what makes the range-fetch strategy above possible.
const BASE_URL =
  process.env.URMP_BASE_URL ?? 'https://huggingface.co/datasets/Eredis02/URMP/resolve/main';
// Set to an extracted Dryad `Dataset/` directory to bypass the network entirely.
const LOCAL_DIR = process.env.URMP_LOCAL_DIR;

const CACHE = resolve(__dirname, '../.cache', 'urmp');
const FIXTURES = resolve(__dirname, '../../fixtures/eval-real/benchmark');

// Excerpt length per clip, and the silence kept before the first note so the
// pipeline's pitch scan has a moment of noise floor to adapt to (the live app
// always sees some lead-in before the player starts).
const WINDOW_SEC = 15;
const LEAD_SEC = 0.25;

// A clip must contain at least this many fully-enclosed notes to be worth
// scoring; sparse windows make note-F1 dominated by one or two events.
const MIN_NOTES = 6;

// 149 tracks -> 50 clips. Distribution is heavily skewed (34 violin vs 3 bassoon
// tracks), so a per-instrument cap is what actually buys timbral breadth.
const MAX_PER_INSTRUMENT = 4;

// URMP performances are conducted to a click but no tempo is annotated per track.
// bpm only feeds the converter's quantizer; the metrics compare onsets in
// seconds, so it does not affect scoring.
const NOMINAL_BPM = 120;

/**
 * URMP's instrument abbreviations -> the web app's `Instrument.id` (the ids
 * `profiles/instrument-ranges.ts` keys its frequency hints by), so each dataset
 * asks the adaptive profile for the window a user picking that instrument would
 * get. `db` (double bass) maps to the app's `contrabass`; URMP's `sax` parts are
 * played on an alto instrument but the corpus does not distinguish, so the
 * generic `saxophone` range is the honest hint.
 */
const INSTRUMENTS: Record<string, { id: string; label: string }> = {
  vn: { id: 'violin', label: 'violin' },
  va: { id: 'viola', label: 'viola' },
  vc: { id: 'cello', label: 'cello' },
  db: { id: 'contrabass', label: 'double bass' },
  fl: { id: 'flute', label: 'flute' },
  cl: { id: 'clarinet', label: 'clarinet' },
  ob: { id: 'oboe', label: 'oboe' },
  bn: { id: 'bassoon', label: 'bassoon' },
  sax: { id: 'saxophone', label: 'saxophone' },
  tpt: { id: 'trumpet', label: 'trumpet' },
  hn: { id: 'french-horn', label: 'horn' },
  tbn: { id: 'trombone', label: 'trombone' },
  tba: { id: 'tuba', label: 'tuba' },
};

interface Track {
  /** Piece directory in the corpus, e.g. 01_Jupiter_vn_vc. */
  pieceDir: string;
  /** Piece id inside the file names, e.g. 01_Jupiter. */
  piece: string;
  /** 1-based part index within the piece. */
  part: string;
  /** URMP instrument abbreviation from the DIRECTORY name — the instrument played. */
  abbr: string;
  /** Abbreviation embedded in this part's FILE names (see PIECES). */
  fileAbbr: string;
  /** Stable clip id used for the fixture file names, e.g. 01_Jupiter_vn1. */
  clip: string;
}

/** Fetch a URL (or copy a local file) to `dest` unless already cached. */
function fetchFile(relPath: string, dest: string, range?: [number, number]): void {
  if (existsSync(dest)) return;
  mkdirSync(join(dest, '..'), { recursive: true });
  if (LOCAL_DIR) {
    const src = join(LOCAL_DIR, relPath);
    const buf = readFileSync(src);
    writeFileSync(dest, range ? buf.subarray(range[0], range[1] + 1) : buf);
    return;
  }
  const args = ['-sL', '--fail', '--max-time', '600'];
  if (range) args.push('-r', `${range[0]}-${range[1]}`);
  args.push('-o', dest, `${BASE_URL}/${relPath}`);
  execFileSync('curl', args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

/**
 * The 44 URMP pieces: [directory name, the abbreviation each part's FILES use].
 * A dir like `31_Slavonic_tpt_tpt_hn_tbn` names its parts in order, and part N's
 * files are `<kind>_<N>_<abbr>_<piece>.<ext>` — so the dir name would normally be
 * enough. It is not: in `15_Surprise_tpt_tpt_tbn` the third part's files are
 * named `..._3_tpt_15_Surprise` while the dir says `tbn`, so the file abbrs are
 * listed explicitly. The DIRECTORY is trusted for the instrument (part 3 spans
 * MIDI 50.9-65.2, i.e. below the trumpet's practical bottom — it is the
 * trombone, and the file name is the corpus's own typo); the file abbrs are used
 * only to build paths.
 *
 * Hard-coded rather than crawled: the corpus is frozen (2019, no revisions) and
 * a listing call would only re-derive this table while tying the script to one
 * mirror's API.
 */
const PIECES: [string, string][] = [
  ['01_Jupiter_vn_vc', 'vn vc'], ['02_Sonata_vn_vn', 'vn vn'],
  ['03_Dance_fl_cl', 'fl cl'], ['04_Allegro_fl_fl', 'fl fl'],
  ['05_Entertainer_tpt_tpt', 'tpt tpt'], ['06_Entertainer_sax_sax', 'sax sax'],
  ['07_GString_tpt_tbn', 'tpt tbn'], ['08_Spring_fl_vn', 'fl vn'],
  ['09_Jesus_tpt_vn', 'tpt vn'], ['10_March_tpt_sax', 'tpt sax'],
  ['11_Maria_ob_vc', 'ob vc'], ['12_Spring_vn_vn_vc', 'vn vn vc'],
  ['13_Hark_vn_vn_va', 'vn vn va'], ['14_Waltz_fl_fl_cl', 'fl fl cl'],
  ['15_Surprise_tpt_tpt_tbn', 'tpt tpt tpt'],
  ['16_Surprise_tpt_tpt_sax', 'tpt tpt sax'], ['17_Nocturne_vn_fl_cl', 'vn fl cl'],
  ['18_Nocturne_vn_fl_tpt', 'vn fl tpt'], ['19_Pavane_cl_vn_vc', 'cl vn vc'],
  ['20_Pavane_tpt_vn_vc', 'tpt vn vc'],
  ['21_Rejouissance_cl_tbn_tba', 'cl tbn tba'],
  ['22_Rejouissance_sax_tbn_tba', 'sax tbn tba'],
  ['23_Rejouissance_cl_sax_tba', 'cl sax tba'],
  ['24_Pirates_vn_vn_va_vc', 'vn vn va vc'],
  ['25_Pirates_vn_vn_va_sax', 'vn vn va sax'],
  ['26_King_vn_vn_va_vc', 'vn vn va vc'],
  ['27_King_vn_vn_va_sax', 'vn vn va sax'],
  ['28_Fugue_fl_ob_cl_bn', 'fl ob cl bn'], ['29_Fugue_fl_fl_ob_cl', 'fl fl ob cl'],
  ['30_Fugue_fl_fl_ob_sax', 'fl fl ob sax'],
  ['31_Slavonic_tpt_tpt_hn_tbn', 'tpt tpt hn tbn'],
  ['32_Fugue_vn_vn_va_vc', 'vn vn va vc'],
  ['33_Elise_tpt_tpt_hn_tbn', 'tpt tpt hn tbn'],
  ['34_Fugue_tpt_tpt_hn_tbn', 'tpt tpt hn tbn'],
  ['35_Rondeau_vn_vn_va_db', 'vn vn va db'],
  ['36_Rondeau_vn_vn_va_vc', 'vn vn va vc'],
  ['37_Rondeau_fl_vn_va_cl', 'fl vn va cl'],
  ['38_Jerusalem_vn_vn_va_vc_db', 'vn vn va vc db'],
  ['39_Jerusalem_vn_vn_va_sax_db', 'vn vn va sax db'],
  ['40_Miserere_fl_fl_ob_cl_bn', 'fl fl ob cl bn'],
  ['41_Miserere_fl_fl_ob_sax_bn', 'fl fl ob sax bn'],
  ['42_Arioso_tpt_tpt_hn_tbn_tba', 'tpt tpt hn tbn tba'],
  ['43_Chorale_tpt_tpt_hn_tbn_tba', 'tpt tpt hn tbn tba'],
  ['44_K515_vn_vn_va_va_vc', 'vn vn va va vc'],
];

/** Every isolated track in the corpus, in piece order. */
function listTracks(): Track[] {
  const tracks: Track[] = [];
  for (const [pieceDir, fileAbbrList] of PIECES) {
    const segments = pieceDir.split('_');
    const piece = segments.slice(0, 2).join('_');
    const abbrs = segments.slice(2);
    const fileAbbrs = fileAbbrList.split(' ');
    if (fileAbbrs.length !== abbrs.length) throw new Error(`part-count mismatch in ${pieceDir}`);
    abbrs.forEach((abbr, i) => {
      if (!INSTRUMENTS[abbr]) throw new Error(`unknown URMP instrument "${abbr}" in ${pieceDir}`);
      const part = String(i + 1);
      tracks.push({
        pieceDir,
        piece,
        part,
        abbr,
        fileAbbr: fileAbbrs[i],
        clip: `${piece}_${abbr}${part}`,
      });
    });
  }
  return tracks;
}

/**
 * Parse a `Notes_*.txt` annotation: whitespace-separated onset(s), pitch(Hz),
 * duration(s), one note per line. Pitch is the note's measured mean F0, so it is
 * rounded to the nearest semitone for the harness's integer-MIDI truth.
 */
function parseNotes(text: string): TruthNote[] {
  const notes: TruthNote[] = [];
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/).map(Number);
    if (cols.length < 3 || !cols.every(Number.isFinite)) continue;
    const [onsetSec, pitchHz, durSec] = cols;
    if (pitchHz <= 0 || durSec <= 0) continue;
    notes.push({ onsetSec, durSec, midi: Math.round(hzToMidi(pitchHz)) });
  }
  notes.sort((a, b) => a.onsetSec - b.onsetSec);
  return notes;
}

interface WavFormat {
  /** Byte offset of the first PCM sample. */
  dataOffset: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

/**
 * Read the RIFF chunk table out of a WAV prefix. Needed because we slice the
 * audio by byte range: to turn "seconds 4.5 .. 19.5" into a range we must know
 * the frame size and where the samples start. URMP ships 48 kHz mono 24-bit, but
 * the fields are parsed rather than assumed so a mirror re-encoding to 16-bit
 * (or a stray LIST chunk before `data`) does not silently shift the window.
 */
function parseWavFormat(head: Buffer): WavFormat {
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let pos = 12;
  while (pos + 8 <= head.length) {
    const id = head.toString('ascii', pos, pos + 4);
    const size = head.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      channels = head.readUInt16LE(pos + 10);
      sampleRate = head.readUInt32LE(pos + 12);
      bitsPerSample = head.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      if (!channels || !sampleRate || !bitsPerSample) throw new Error('data chunk before fmt');
      return { dataOffset: pos + 8, channels, sampleRate, bitsPerSample };
    }
    pos += 8 + size + (size % 2); // chunks are word-aligned
  }
  throw new Error('no data chunk in WAV prefix');
}

/**
 * Materialize `[startSec, startSec + WINDOW_SEC)` of a track as mono 16-bit WAV.
 * Only that byte range is fetched, and it is handed to bundled ffmpeg as RAW PCM
 * (with the format parsed from the real header) — feeding a truncated WAV whose
 * header still advertises the full length would leave ffmpeg guessing.
 */
function writeWindowWav(track: Track, startSec: number, dest: string): void {
  const rel = `${track.pieceDir}/AuSep_${track.part}_${track.fileAbbr}_${track.piece}.wav`;
  const headPath = join(CACHE, 'audio', `${track.clip}.head`);
  fetchFile(rel, headPath, [0, 1023]);
  const fmt = parseWavFormat(readFileSync(headPath));

  const frameBytes = fmt.channels * (fmt.bitsPerSample / 8);
  const from = fmt.dataOffset + Math.round(startSec * fmt.sampleRate) * frameBytes;
  const to = from + Math.round(WINDOW_SEC * fmt.sampleRate) * frameBytes - 1;
  const pcmPath = join(CACHE, 'audio', `${track.clip}.pcm`);
  fetchFile(rel, pcmPath, [from, to]);

  if (!ffmpegPath) throw new Error('ffmpeg-static binary not available');
  execFileSync(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', `s${fmt.bitsPerSample}le`,
      '-ar', String(fmt.sampleRate),
      '-ac', String(fmt.channels),
      '-i', pcmPath,
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      dest,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

interface Candidate {
  track: Track;
  /** Where the excerpt starts in the source track. */
  startSec: number;
  /** Window-relative truth notes. */
  notes: TruthNote[];
  /** Digest of the full annotation file — the duplicate-take fingerprint. */
  digest: string;
}

/**
 * Build a candidate per track from its (cached, tiny) annotation file: the
 * excerpt window and the truth notes inside it. Tracks with too few notes in
 * their window are dropped here rather than after the per-instrument cap, so a
 * sparse track does not consume a quota slot.
 */
function buildCandidates(tracks: Track[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const track of tracks) {
    const rel = `${track.pieceDir}/Notes_${track.part}_${track.fileAbbr}_${track.piece}.txt`;
    const notesPath = join(CACHE, 'notes', `${track.clip}.txt`);
    fetchFile(rel, notesPath);
    const raw = readFileSync(notesPath, 'utf8');
    const all = parseNotes(raw);
    if (!all.length) {
      console.warn(`  ! ${track.clip}: no annotated notes, skipping`);
      continue;
    }

    // Window starts just before the first note: URMP tracks open with several
    // seconds of the player waiting for their cue, which would otherwise eat most
    // of a 15 s excerpt.
    const startSec = Math.max(0, all[0].onsetSec - LEAD_SEC);
    const endSec = startSec + WINDOW_SEC;
    const notes = all
      .filter((n) => n.onsetSec >= startSec && n.onsetSec + n.durSec <= endSec)
      .map((n) => ({ ...n, onsetSec: n.onsetSec - startSec }));
    if (notes.length < MIN_NOTES) {
      console.warn(`  ! ${track.clip}: only ${notes.length} notes in window, skipping`);
      continue;
    }

    candidates.push({
      track,
      startSec,
      notes,
      digest: createHash('sha1').update(raw).digest('hex'),
    });
  }
  return candidates;
}

/**
 * Up to MAX_PER_INSTRUMENT clips per instrument, deterministically.
 *
 * URMP re-uses the SAME recorded take across instrumentation variants of a piece
 * (24_Pirates and 25_Pirates share a viola track byte for byte), so identical
 * annotations are dropped first — a duplicate take would cost download and eval
 * time while adding no information. Then one track per piece is preferred before
 * doubling up on a piece, so pieces that pair two violins do not fill the violin
 * quota with two parts of the same performance.
 */
function pickSubset(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.digest)) return false;
    seen.add(c.digest);
    return true;
  });
  const duplicates = candidates.length - unique.length;
  if (duplicates) console.log(`  dropped ${duplicates} tracks re-used across pieces`);

  const chosen: Candidate[] = [];
  for (const abbr of Object.keys(INSTRUMENTS)) {
    const forInstrument = unique.filter((c) => c.track.abbr === abbr);
    const usedPieces = new Set<string>();
    const onePerPiece = forInstrument.filter((c) => {
      if (usedPieces.has(c.track.piece)) return false;
      usedPieces.add(c.track.piece);
      return true;
    });
    const rest = forInstrument.filter((c) => !onePerPiece.includes(c));
    chosen.push(...[...onePerPiece, ...rest].slice(0, MAX_PER_INSTRUMENT));
  }
  return chosen;
}

function main(): void {
  if (LOCAL_DIR) console.log(`  reading local Dryad tree: ${LOCAL_DIR}`);
  const tracks = listTracks();
  console.log(`  ${tracks.length} isolated tracks in the corpus; reading annotations …`);
  const chosen = pickSubset(buildCandidates(tracks));
  console.log(`  ${chosen.length} clips selected (<=${MAX_PER_INSTRUMENT} per instrument)`);

  // Clear every previous urmp-* dataset dir up front, so an instrument that
  // stops being selected does not leave stale clips behind.
  for (const { id } of Object.values(INSTRUMENTS)) {
    rmSync(join(FIXTURES, `urmp-${id}`), { recursive: true, force: true });
  }

  const perDataset = new Map<string, { clips: number; totalNotes: number; abbr: string }>();

  for (const { track, startSec, notes } of chosen) {
    const instrument = INSTRUMENTS[track.abbr];
    const out = join(FIXTURES, `urmp-${instrument.id}`);
    mkdirSync(out, { recursive: true });
    const truth: GroundTruth = { bpm: NOMINAL_BPM, notes };
    writeFileSync(join(out, `${track.clip}.truth.json`), JSON.stringify(truth, null, 2));
    writeWindowWav(track, startSec, join(out, `${track.clip}__real.wav`));

    const agg = perDataset.get(instrument.id) ?? { clips: 0, totalNotes: 0, abbr: track.abbr };
    agg.clips += 1;
    agg.totalNotes += notes.length;
    perDataset.set(instrument.id, agg);
    console.log(
      `  ${track.clip} -> urmp-${instrument.id} (${notes.length} notes from ${startSec.toFixed(1)} s)`,
    );
  }

  let clips = 0;
  let totalNotes = 0;
  for (const [id, agg] of Array.from(perDataset.entries())) {
    // Manifest read by run-eval (EVAL_REAL) for the dataset's display label and
    // adaptive instrument hint — `kind: 'instrument'` plus the app's own
    // Instrument.id, i.e. exactly what a user picking this instrument sends.
    const manifest = {
      id: `urmp-${id}`,
      label: `URMP ${INSTRUMENTS[agg.abbr].label} (real isolated monophonic tracks)`,
      kind: 'instrument',
      instrumentId: id,
      source: 'https://doi.org/10.5061/dryad.ng3r749',
      license: 'CC0-1.0',
      bpmAssumed: NOMINAL_BPM,
      clips: agg.clips,
      totalNotes: agg.totalNotes,
      notes:
        `Isolated monophonic ${INSTRUMENTS[agg.abbr].label} tracks (URMP AuSep_*), trimmed to ` +
        `${WINDOW_SEC} s starting ${LEAD_SEC} s before each track's first annotated note. ` +
        'Ground truth is the corpus\'s own note-level annotation (Notes_*.txt: onset s, ' +
        'pitch Hz, duration s), pitch rounded to the nearest semitone; notes not fully ' +
        'inside the window are dropped. The annotations were produced by the URMP authors ' +
        'from score alignment + manually corrected pitch tracking, independent of this ' +
        "pipeline's estimators.",
    };
    writeFileSync(
      join(FIXTURES, `urmp-${id}`, 'dataset.json'),
      JSON.stringify(manifest, null, 2),
    );
    clips += agg.clips;
    totalNotes += agg.totalNotes;
  }

  console.log(
    `\nConverted ${clips} URMP clips (${totalNotes} notes) across ${perDataset.size} ` +
      `instrument datasets into ${FIXTURES}/urmp-*`,
  );
  console.log(
    'Run: EVAL_REAL=1 EVAL_ADAPTIVE=1 pnpm --filter api exec tsx scripts/eval/run-eval.ts',
  );
}

main();
