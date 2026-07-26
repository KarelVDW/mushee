/**
 * Fetch N20EMv2 and convert a SUBSET of its solo singing recordings into the
 * eval harness's *real* corpus layout. This is the most credibly annotated
 * singing corpus we have: the note-level truth was produced coarse-to-fine — a
 * Melodyne draft, then corrected by TWO music experts — where vocadito's two
 * annotators disagree with each other (F1 0.760, see annotator-agreement.ts) and
 * mir-qbsh's labels are self-reported frame pitch with no note events at all
 * (see the findings log in scripts/eval/README.md).
 *
 * It is also the only corpus in the harness that comes with an EXTERNAL YARDSTICK
 * at our own tolerances. The dataset's own audio-only baseline (Gu et al.,
 * arXiv:2304.12082, SSL + CRNN, trained on this corpus) reports on its test split:
 *
 *   COnPOff 73.06 | COnP 79.56 | COn 93.66
 *   (pitch tolerance 50 cents, onset tolerance 50 ms,
 *    offset tolerance max(50 ms, 0.2 x note duration))
 *
 * Those numbers are recorded in each dataset.json so a run of ours can be put next
 * to them. Note that what run-eval calls note-F1 is COnP at ±100 ms (§4.4c), i.e.
 * a *looser* onset gate than their 79.56 — do not read a gap as being smaller than
 * it is.
 *
 * Output: scripts/fixtures/eval-real/n20emv2/<clip>.truth.json      ({bpm, notes})
 *         scripts/fixtures/eval-real/n20emv2/<clip>__real.wav
 *         scripts/fixtures/eval-real/n20emv2/dataset.json           (manifest)
 *         scripts/fixtures/eval-real/n20emv2-test/…                 (same layout)
 *
 * TWO dataset directories, because the corpus ships its own train/valid/test
 * split and its published numbers are on that test split. `n20emv2` holds the
 * train+valid songs and is what tuning may look at; `n20emv2-test` holds the 18
 * test songs and exists so a comparison against the figures above is possible
 * WITHOUT the corpus's test material ever entering a sweep. Every clip also
 * records its source split in the manifest's `clipSplits`.
 * Use `EVAL_SCENARIOS=…` / `SWEEP_EXCLUDE=n20emv2-test` to keep it out of a
 * tuning loop, exactly as the harness's own dev/test discipline requires.
 *
 * Source : https://zenodo.org/records/10814703  (N20EMv2, Zenodo 2024)
 * License: CC BY-SA 4.0 (attribution + share-alike; open access, no request form).
 * Code   : https://github.com/guxm2021/SVT_SpeechBrain (Apache-2.0) — the
 *          `data/<entry>/vocals.wav` + `annotations.json` layout below is the one
 *          its N20EMv2/audio_only/prepare_n20emv2.py reads.
 *
 * DOWNLOAD: the record is 11.5 GB in ten `data_sub<N>.zip` files (one per
 * subject), ~90% of which is `video_50fps.npy` lip-motion tensors we have no use
 * for. There is no file-per-file mirror, so instead of pulling whole zips this
 * script treats each zip as the random-access archive it is: it range-fetches the
 * end-of-central-directory record, then the central directory, then — per chosen
 * song — only the DEFLATE bytes of that song's `vocals.wav` up to the end of the
 * excerpt window, and inflates that prefix (zlib tolerates a truncated stream with
 * Z_SYNC_FLUSH). ~1.5 MB per clip, ~180 MB for the default 120 clips, against
 * 11.5 GB for the naive route. Overridable:
 *   N20EMV2_LOCAL_DIR=<path>   an already-extracted tree containing `data/<entry>/
 *                              vocals.wav` (+ annotations.json), which is the
 *                              canonical, network-independent path
 *   N20EMV2_TARGET=<n>         subset size (default 120)
 *
 * Annotations (`annotations.json`, one entry per song):
 *   { "<entry>": { "split": "train"|"valid"|"test",
 *                  "midi": [[onsetSec, offsetSec, midi], …] } }
 * Pitch is already integer MIDI (verified over all 38 857 notes: no overlaps, no
 * zero-length notes, range 40–73), so unlike URMP/GuitarSet nothing has to be
 * rounded — this is a note-event annotation, not a quantised pitch track.
 *
 * Subset: 157 songs (8 h 22 m) exist; a full run would be 8 h of audio, so each
 * song contributes ONE WINDOW_SEC excerpt — the earliest window holding at least
 * MIN_NOTES fully-enclosed notes (mean 25). Songs are drawn round-robin over the
 * ten subjects so the subset cannot collapse onto a few voices.
 *
 * Idempotent; central directories and the fetched DEFLATE prefixes are cached
 * (gitignored) under scripts/eval/.cache/n20emv2.
 *
 * Run: pnpm --filter api exec tsx scripts/eval/fetch-n20emv2.ts
 */

import { execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { constants as zlibConstants, inflateRawSync } from 'zlib';

import type { GroundTruth, TruthNote } from './types';

const RECORD = 'https://zenodo.org/api/records/10814703/files';
// Set to a tree holding `annotations.json` + `data/<entry>/vocals.wav` to bypass
// the network (and the zip plumbing) entirely.
const LOCAL_DIR = process.env.N20EMV2_LOCAL_DIR;

const CACHE = resolve(__dirname, '.cache', 'n20emv2');
const FIXTURES = resolve(__dirname, '../fixtures/eval-real');

/** Their train+valid songs, and their test songs, as separate datasets. */
const DEV_DATASET = 'n20emv2';
const TEST_DATASET = 'n20emv2-test';

// Excerpt length per clip, and the audio kept before the first note so the
// pipeline's pitch scan has a moment of noise floor to adapt to (the live app
// always sees some lead-in before the singer starts).
const WINDOW_SEC = 15;
const LEAD_SEC = 0.25;

// A window must hold at least this many fully-enclosed notes to be worth
// scoring; sparse windows make note-F1 dominated by one or two events.
const MIN_NOTES = 8;

// Total clips across both datasets. 157 songs exist; the harness is re-run
// constantly, so breadth over the ten subjects buys more than length or count.
const TARGET_CLIPS = Number(process.env.N20EMV2_TARGET ?? 120);

// N20EMv2 subjects sing pop songs to a backing track, so a real tempo exists but
// is not annotated. bpm only feeds the converter's quantizer; the metrics compare
// onsets in seconds, so it does not affect scoring.
const NOMINAL_BPM = 120;

// Enough to hold the end-of-central-directory record plus any comment.
const TAIL_BYTES = 64 * 1024;

// First fetch of a member: enough DEFLATE bytes to be certain of covering the
// RIFF header, before the byte rate is known.
const HEAD_BYTES = 64 * 1024;

// The corpus's audio format, used ONLY to turn a zip entry's uncompressed size
// into a duration (see durationOf).
const NOMINAL_BYTE_RATE = 16000 * 4; // 16 kHz mono float32

/** The ten per-subject zips, `data_sub1.zip` … `data_sub10.zip`. */
const SUBJECT_ZIPS = Array.from({ length: 10 }, (_, i) => `data_sub${i + 1}.zip`);

/** The dataset's own split of each song. */
type CorpusSplit = 'train' | 'valid' | 'test';

interface Annotation {
  split: CorpusSplit;
  /** [onsetSec, offsetSec, midi] triples, expert-corrected. */
  midi: [number, number, number][];
}

/** One `vocals.wav` member of one zip, as described by that zip's central directory. */
interface ZipMember {
  zip: string;
  /** Song id, e.g. `1.22.b-12`. */
  entry: string;
  /** Offset of the LOCAL file header (the central directory's copy is not it). */
  localHeaderOffset: number;
  /** 0 = stored, 8 = deflate. */
  method: number;
  compressedSize: number;
  uncompressedSize: number;
}

function zipUrl(zip: string): string {
  return `${RECORD}/${zip}/content`;
}

/**
 * Fetch `[from, from+length)` of a URL to `dest` unless already cached, and
 * return the bytes. `from < 0` means "the last -from bytes" (an HTTP suffix
 * range), which is how the central directory is found without knowing the zip's
 * length. `--max-filesize` is the guard against a server that ignores Range and
 * would otherwise stream a whole 1.4 GB zip into the cache.
 */
function fetchRange(url: string, from: number, length: number, dest: string): Buffer {
  if (!existsSync(dest)) {
    mkdirSync(join(dest, '..'), { recursive: true });
    const range = from < 0 ? `-${-from}` : `${from}-${from + length - 1}`;
    // Downloaded to `.part` and renamed only on success: a run makes hundreds of
    // range requests, and Zenodo throttles (HTTP 429) — a half-written file left
    // at `dest` by an aborted transfer would be indistinguishable from a valid
    // cache entry on the next run. `--retry` covers the throttling itself (curl
    // retries 429/5xx), so a rate-limited run slows down instead of dying.
    const part = `${dest}.part`;
    execFileSync(
      'curl',
      [
        '-sL', '--fail', '--max-time', '900',
        '--retry', '5', '--retry-delay', '5', '--retry-all-errors',
        '--max-filesize', String(length * 2 + 1024),
        '-r', range,
        '-o', part, url,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    renameSync(part, dest);
  }
  return readFileSync(dest);
}

/**
 * The `vocals.wav` members of one zip, read from its central directory.
 *
 * A zip's index lives at the END of the file, which is what makes a 1.4 GB
 * archive randomly accessible over HTTP: the last TAIL_BYTES give the
 * end-of-central-directory record, which points at the central directory, which
 * lists every member's offset and compressed size. Two small range requests per
 * zip (cached), and no member we do not want is ever transferred.
 */
function listMembers(zip: string): ZipMember[] {
  const url = zipUrl(zip);
  const tail = fetchRange(url, -TAIL_BYTES, TAIL_BYTES, join(CACHE, 'zip', `${zip}.tail`));
  const eocd = tail.lastIndexOf('PK\x05\x06', tail.length, 'binary');
  if (eocd < 0) throw new Error(`${zip}: no end-of-central-directory record in the last ${TAIL_BYTES} B`);
  const entryCount = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error(`${zip}: ZIP64 archive, not supported here`);

  const cd = fetchRange(url, cdOffset, cdSize, join(CACHE, 'zip', `${zip}.cd`));
  const members: ZipMember[] = [];
  let pos = 0;
  let seen = 0;
  while (pos + 46 <= cd.length && cd.toString('binary', pos, pos + 4) === 'PK\x01\x02') {
    const method = cd.readUInt16LE(pos + 10);
    const compressedSize = cd.readUInt32LE(pos + 20);
    const uncompressedSize = cd.readUInt32LE(pos + 24);
    const nameLen = cd.readUInt16LE(pos + 28);
    const extraLen = cd.readUInt16LE(pos + 30);
    const commentLen = cd.readUInt16LE(pos + 32);
    const localHeaderOffset = cd.readUInt32LE(pos + 42);
    const name = cd.toString('utf8', pos + 46, pos + 46 + nameLen);
    // `data_sub3/1.22.b-12/vocals.wav` -> entry `1.22.b-12`. accomp.wav (the
    // backing track the subject sang along to) and video_50fps.npy are skipped.
    if (name.endsWith('/vocals.wav')) {
      members.push({
        zip,
        entry: name.split('/')[1],
        localHeaderOffset,
        method,
        compressedSize,
        uncompressedSize,
      });
    }
    pos += 46 + nameLen + extraLen + commentLen;
    seen += 1;
  }
  if (seen !== entryCount) throw new Error(`${zip}: read ${seen} of ${entryCount} central-directory entries`);
  return members;
}

/**
 * Byte offset of a member's payload. The central directory points at the LOCAL
 * file header, whose own name/extra fields are not necessarily the same length as
 * the central copy's, so it has to be read.
 */
function memberDataOffset(member: ZipMember): number {
  const head = fetchRange(
    zipUrl(member.zip),
    member.localHeaderOffset,
    128,
    join(CACHE, 'zip', `${member.zip}.${member.entry}.lfh`),
  );
  if (head.toString('binary', 0, 4) !== 'PK\x03\x04') {
    throw new Error(`${member.entry}: no local file header at ${member.localHeaderOffset}`);
  }
  return member.localHeaderOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
}

/**
 * Inflate as much of a TRUNCATED deflate stream as it contains. Z_SYNC_FLUSH is
 * what makes this legal: the default Z_FINISH insists on reaching the stream's
 * end-of-data marker and throws on a prefix, which is exactly the case here —
 * that a partial member decompresses at all is the whole reason this script does
 * not have to download 11.5 GB.
 */
function inflatePrefix(compressed: Buffer): Buffer {
  return inflateRawSync(compressed, { finishFlush: zlibConstants.Z_SYNC_FLUSH });
}

interface WavFormat {
  /** Byte offset of the first PCM sample. */
  dataOffset: number;
  /** WAVE format tag: 1 = integer PCM, 3 = IEEE float. */
  formatTag: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

/**
 * Read the RIFF chunk table out of a WAV prefix. Needed because the excerpt is
 * cut by byte offset: to turn "seconds 9.8 .. 24.8" into a slice we must know the
 * frame size and where the samples start. N20EMv2 ships 16 kHz mono 32-bit FLOAT
 * (format tag 3) with a `fact` chunk before `data`, so neither the tag nor the
 * chunk order can be assumed — both are parsed.
 */
function parseWavFormat(head: Buffer): WavFormat {
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let formatTag = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let pos = 12;
  while (pos + 8 <= head.length) {
    const id = head.toString('ascii', pos, pos + 4);
    const size = head.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      formatTag = head.readUInt16LE(pos + 8);
      channels = head.readUInt16LE(pos + 10);
      sampleRate = head.readUInt32LE(pos + 12);
      bitsPerSample = head.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      if (!channels || !sampleRate || !bitsPerSample) throw new Error('data chunk before fmt');
      return { dataOffset: pos + 8, formatTag, channels, sampleRate, bitsPerSample };
    }
    pos += 8 + size + (size % 2); // chunks are word-aligned
  }
  throw new Error('no data chunk in WAV prefix');
}

/** ffmpeg's raw-PCM demuxer name for a WAVE format tag + width. */
function rawFormat(fmt: WavFormat): string {
  if (fmt.formatTag === 3) {
    if (fmt.bitsPerSample === 32) return 'f32le';
    if (fmt.bitsPerSample === 64) return 'f64le';
  }
  if (fmt.formatTag === 1 && [16, 24, 32].includes(fmt.bitsPerSample)) {
    return `s${fmt.bitsPerSample}le`;
  }
  throw new Error(`unsupported WAV format tag ${fmt.formatTag}/${fmt.bitsPerSample} bit`);
}

/**
 * The song's audio from the start of the file up to at least `neededSec`,
 * together with its format. Over HTTP this fetches a DEFLATE prefix sized from
 * the member's own compression ratio and inflates it; the size is a guess, so a
 * short read is retried with progressively more slack (and finally the whole
 * member) rather than silently yielding a truncated window.
 */
function readAudioPrefix(member: ZipMember, neededSec: number): { pcm: Buffer; fmt: WavFormat } {
  const dataOffset = memberDataOffset(member);
  const url = zipUrl(member.zip);
  const cachePath = join(CACHE, 'audio', `${member.entry}.bin`);

  // The first slice only has to reach the RIFF header, which is 58 bytes in.
  let raw =
    member.method === 0
      ? fetchRange(url, dataOffset, HEAD_BYTES, cachePath)
      : inflatePrefix(fetchRange(url, dataOffset, HEAD_BYTES, cachePath));
  const fmt = parseWavFormat(raw);
  const frameBytes = fmt.channels * (fmt.bitsPerSample / 8);
  const needed = fmt.dataOffset + Math.ceil(neededSec * fmt.sampleRate) * frameBytes;

  for (const slack of [1.15, 1.4, Infinity]) {
    if (raw.length >= needed) break;
    const ratio = member.compressedSize / member.uncompressedSize;
    const want =
      slack === Infinity
        ? member.compressedSize
        : Math.min(Math.ceil(needed * ratio * slack) + HEAD_BYTES, member.compressedSize);
    rmSync(cachePath, { force: true });
    const slice = fetchRange(url, dataOffset, want, cachePath);
    raw = member.method === 0 ? slice : inflatePrefix(slice);
  }
  if (raw.length < needed) {
    throw new Error(`${member.entry}: only ${raw.length} of ${needed} audio bytes available`);
  }
  return { pcm: raw, fmt };
}

/**
 * Write `[startSec, startSec + WINDOW_SEC)` as mono 16-bit WAV at the source
 * sample rate (16 kHz — resampling would only interpolate detail that is not
 * there). The slice is handed to the app's bundled ffmpeg as RAW PCM with the
 * format parsed above: feeding a truncated WAV whose header still advertises the
 * full length would leave ffmpeg guessing.
 */
function writeWindowWav(pcm: Buffer, fmt: WavFormat, startSec: number, dest: string): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static binary not available');
  const frameBytes = fmt.channels * (fmt.bitsPerSample / 8);
  const from = fmt.dataOffset + Math.round(startSec * fmt.sampleRate) * frameBytes;
  const to = from + Math.round(WINDOW_SEC * fmt.sampleRate) * frameBytes;
  const slicePath = join(CACHE, 'audio', 'window.pcm');
  mkdirSync(join(CACHE, 'audio'), { recursive: true });
  writeFileSync(slicePath, pcm.subarray(from, Math.min(to, pcm.length)));

  execFileSync(
    ffmpegPath,
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', rawFormat(fmt),
      '-ar', String(fmt.sampleRate),
      '-ac', String(fmt.channels),
      '-i', slicePath,
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      dest,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  rmSync(slicePath, { force: true });
}

/**
 * The annotation's note events. Already integer MIDI and already non-overlapping
 * (verified across all 157 songs), so this only converts offset -> duration and
 * sorts; nothing about the labels is reinterpreted.
 */
function parseNotes(anno: Annotation): TruthNote[] {
  const notes = anno.midi
    .filter(([onsetSec, offsetSec, midi]) => offsetSec > onsetSec && Number.isFinite(midi))
    .map(([onsetSec, offsetSec, midi]) => ({
      onsetSec,
      durSec: offsetSec - onsetSec,
      midi: Math.round(midi),
    }));
  notes.sort((a, b) => a.onsetSec - b.onsetSec);
  return notes;
}

interface Window {
  startSec: number;
  /** Window-relative truth notes. */
  notes: TruthNote[];
}

/**
 * The EARLIEST window holding at least MIN_NOTES fully-enclosed notes, anchored
 * LEAD_SEC before a note onset.
 *
 * Earliest rather than densest on purpose. Every song opens with ~10 s of backing
 * track before the subject sings (measured: first onset 9.9 s mean, 11.5 s max),
 * so anchoring on the first note skips the instrumental lead-in while keeping the
 * fetched DEFLATE prefix ~1.5 MB; searching the whole 3-minute song for the
 * densest window would mean transferring every song in full for a choice that
 * cannot be justified as more representative. Advancing on a sparse window (a
 * one-phrase opening followed by a long rest) is the only reason a later anchor
 * is ever used.
 *
 * KNOWN BIAS, stated rather than hidden: these are all song OPENINGS.
 */
function pickWindow(all: TruthNote[], durationSec: number): Window | null {
  const latestStart = durationSec - WINDOW_SEC;
  for (const anchor of all) {
    const startSec = Math.max(0, anchor.onsetSec - LEAD_SEC);
    if (startSec > latestStart) break;
    const endSec = startSec + WINDOW_SEC;
    const inWindow = all.filter((n) => n.onsetSec >= startSec && n.onsetSec + n.durSec <= endSec);
    if (inWindow.length < MIN_NOTES) continue;
    return {
      startSec,
      notes: inWindow.map((n) => ({ ...n, onsetSec: n.onsetSec - startSec })),
    };
  }
  return null;
}

interface Candidate {
  /** Fixture clip id, e.g. `sub03_1-22-b-12`. */
  clip: string;
  /** The corpus's own song id, e.g. `1.22.b-12`. */
  entry: string;
  /** 1-based subject index, i.e. which `data_sub<N>.zip` the song lives in. */
  subject: number;
  split: CorpusSplit;
  member?: ZipMember;
  /** Local path, when N20EMV2_LOCAL_DIR is set. */
  localWav?: string;
  window: Window;
}

/**
 * Clip id: `sub<NN>_<entry with dots as hyphens>`.
 *
 * The subject goes FIRST because lib/split.ts groups the dev/test split by
 * `clip.split('_')[0]` for the datasets it knows about — one subject contributes
 * a dozen clips, and a per-clip split would put the same voice in both halves
 * (the leak that function exists to prevent). n20emv2 is not in its list yet, so
 * the name makes adding it a one-liner. Dots become hyphens so the clip id is a
 * single filename stem with no extension-like fragments in it.
 */
function clipId(subject: number, entry: string): string {
  return `sub${String(subject).padStart(2, '0')}_${entry.replace(/\./g, '-')}`;
}

/**
 * Up to TARGET_CLIPS songs, deterministically: ALL test-split songs first (they
 * are the external yardstick and there are only 18), then train+valid round-robin
 * over the ten subjects so no voice dominates the tuning set.
 */
function pickSubset(candidates: Candidate[]): Candidate[] {
  const test = candidates
    .filter((c) => c.split === 'test')
    .sort((a, b) => a.clip.localeCompare(b.clip));

  const queues = new Map<number, Candidate[]>();
  for (const c of candidates.filter((x) => x.split !== 'test')) {
    const queue = queues.get(c.subject) ?? [];
    queue.push(c);
    queues.set(c.subject, queue);
  }
  const bySubject = Array.from(queues.keys())
    .sort((a, b) => a - b)
    .map((k) => (queues.get(k) as Candidate[]).sort((a, b) => a.clip.localeCompare(b.clip)));

  const dev: Candidate[] = [];
  const budget = Math.max(0, TARGET_CLIPS - test.length);
  let progress = true;
  while (dev.length < budget && progress) {
    progress = false;
    for (const queue of bySubject) {
      if (dev.length >= budget || !queue.length) continue;
      dev.push(queue.shift() as Candidate);
      progress = true;
    }
  }
  return [...dev, ...test];
}

/** Audio length of a song, from the zip's uncompressed size or the local file. */
function durationOf(candidateSource: ZipMember | string): number {
  if (typeof candidateSource === 'string') {
    const head = readFileSync(candidateSource).subarray(0, 4096);
    const fmt = parseWavFormat(head);
    const bytes = statSync(candidateSource).size - fmt.dataOffset;
    return bytes / (fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8));
  }
  // The zip's central directory gives the uncompressed size but not the format,
  // and the format is only known once a prefix has been fetched — so the corpus's
  // constant 16 kHz mono float32 (+58-byte RIFF header) is assumed HERE ONLY, to
  // bound the last legal window start. Nothing downstream relies on it: the real
  // header is parsed before a single sample is cut, and the bound never binds
  // anyway (shortest song 57 s, latest window start 11.5 s).
  return (candidateSource.uncompressedSize - 58) / NOMINAL_BYTE_RATE;
}

function loadAnnotations(): Record<string, Annotation> {
  const dest = LOCAL_DIR
    ? join(LOCAL_DIR, 'annotations.json')
    : join(CACHE, 'annotations.json');
  if (!existsSync(dest)) {
    mkdirSync(CACHE, { recursive: true });
    console.log('  downloading annotations.json (~1.4 MB) …');
    execFileSync(
      'curl',
      [
        '-sL', '--fail', '--max-time', '300',
        '--retry', '5', '--retry-delay', '5', '--retry-all-errors',
        '-o', `${dest}.part`, `${RECORD}/annotations.json/content`,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    renameSync(`${dest}.part`, dest);
  }
  return JSON.parse(readFileSync(dest, 'utf8')) as Record<string, Annotation>;
}

function main(): void {
  if (LOCAL_DIR) console.log(`  reading local tree: ${LOCAL_DIR}`);
  const annotations = loadAnnotations();
  const entries = Object.keys(annotations).sort();
  console.log(`  ${entries.length} annotated songs in the corpus`);

  // Where each song's audio lives. Over HTTP that means one central directory per
  // subject zip (two small range requests each, cached); locally it is just a path.
  const memberOf = new Map<string, ZipMember>();
  if (!LOCAL_DIR) {
    for (const [index, zip] of SUBJECT_ZIPS.entries()) {
      const members = listMembers(zip);
      for (const m of members) memberOf.set(m.entry, m);
      console.log(`  ${zip}: ${members.length} songs (subject ${index + 1})`);
    }
  }

  const candidates: Candidate[] = [];
  for (const entry of entries) {
    const anno = annotations[entry];
    const member = memberOf.get(entry);
    const localWav = LOCAL_DIR ? join(LOCAL_DIR, 'data', entry, 'vocals.wav') : undefined;
    const source = localWav ?? member;
    if (!source || (localWav && !existsSync(localWav))) {
      console.warn(`  ! ${entry}: audio missing, skipping`);
      continue;
    }
    const notes = parseNotes(anno);
    const window = pickWindow(notes, durationOf(source));
    if (!window) {
      console.warn(`  ! ${entry}: no ${WINDOW_SEC} s window with >=${MIN_NOTES} notes, skipping`);
      continue;
    }
    const subject = member ? Number(member.zip.replace(/\D/g, '')) : 0;
    candidates.push({
      clip: clipId(subject, entry),
      entry,
      subject,
      split: anno.split,
      member,
      localWav,
      window,
    });
  }

  const chosen = pickSubset(candidates);
  console.log(
    `  ${chosen.length} clips selected of ${candidates.length} eligible ` +
      `(${chosen.filter((c) => c.split === 'test').length} from the corpus's test split)`,
  );

  for (const dataset of [DEV_DATASET, TEST_DATASET]) {
    rmSync(join(FIXTURES, dataset), { recursive: true, force: true });
    mkdirSync(join(FIXTURES, dataset), { recursive: true });
  }

  const stats = new Map<
    string,
    { clips: number; totalNotes: number; subjects: Set<number>; splits: Record<string, string> }
  >();
  for (const c of chosen) {
    const dataset = c.split === 'test' ? TEST_DATASET : DEV_DATASET;
    const out = join(FIXTURES, dataset);
    const truth: GroundTruth = { bpm: NOMINAL_BPM, notes: c.window.notes };
    writeFileSync(join(out, `${c.clip}.truth.json`), JSON.stringify(truth, null, 2));

    if (c.localWav) {
      const buf = readFileSync(c.localWav);
      writeWindowWav(buf, parseWavFormat(buf.subarray(0, 4096)), c.window.startSec, join(out, `${c.clip}__real.wav`));
    } else {
      const { pcm, fmt } = readAudioPrefix(c.member as ZipMember, c.window.startSec + WINDOW_SEC);
      writeWindowWav(pcm, fmt, c.window.startSec, join(out, `${c.clip}__real.wav`));
    }

    const agg =
      stats.get(dataset) ?? { clips: 0, totalNotes: 0, subjects: new Set<number>(), splits: {} };
    agg.clips += 1;
    agg.totalNotes += c.window.notes.length;
    agg.subjects.add(c.subject);
    agg.splits[c.clip] = c.split;
    stats.set(dataset, agg);
    console.log(
      `  ${c.clip} -> ${dataset} (${c.window.notes.length} notes from ` +
        `${c.window.startSec.toFixed(1)} s, corpus split ${c.split})`,
    );
  }

  for (const [dataset, agg] of Array.from(stats.entries())) {
    const isTest = dataset === TEST_DATASET;
    // Manifest read by run-eval (EVAL_REAL) for the dataset's display label and
    // adaptive instrument hint — `kind: 'voice'` + 'voice-lead' is what a user
    // picking "voice" sends, matching vocadito and annotated-vocalset.
    const manifest = {
      id: dataset,
      label: `N20EMv2 ${isTest ? 'test split' : 'train+valid'} (real solo singing, expert-corrected notes)`,
      kind: 'voice',
      instrumentId: 'voice-lead',
      source: 'https://zenodo.org/records/10814703',
      license: 'CC-BY-SA-4.0',
      paper: 'https://arxiv.org/abs/2304.12082',
      corpusSplit: isTest ? 'test' : 'train+valid',
      // The corpus ships real note events (expert-corrected), so nothing here is
      // derived from a frame-level pitch track the way mir-qbsh's labels are
      // (lib/realCorpus.ts): this is note-F1-gradeable material.
      noteTruthDerived: false,
      bpmAssumed: NOMINAL_BPM,
      clips: agg.clips,
      totalNotes: agg.totalNotes,
      subjects: Array.from(agg.subjects).sort((a, b) => a - b),
      clipSplits: agg.splits,
      /**
       * Independent check that the labels describe THIS audio, measured on the
       * default 120-clip subset (Hann-windowed Goertzel harmonic energy, 3
       * harmonics, 250 ms of each note's sustain, vs two controls). Re-measure if
       * the subset or the window rule changes.
       */
      validation: {
        harmonicEnergyAtLabelBeats3SemitoneControl: isTest ? '99.4%' : '99.1%',
        harmonicEnergyAtLabelBeatsSamePitch2sLater: isTest ? '93.5%' : '91.9%',
        beatsBothControls: isTest ? '93.2%' : '91.4%',
        harmonicSumPitchWithin50Cents: isTest ? '83.6%' : '86.8%',
        harmonicSumPitchWithin100Cents: isTest ? '97.6%' : '96.8%',
        medianDeviationCents: isTest ? -5 : -10,
        note:
          'Measured at each note\'s SUSTAIN. The same test at the note\'s attack scores ' +
          '~7 points lower with a -13 cent mean bias: singers scoop into notes, which is a ' +
          'property of singing, not of the labels.',
      },
      /** The dataset's own published audio-only baseline — see `notes`. */
      externalBaseline: {
        model: 'Gu et al. 2023 (arXiv:2304.12082), audio-only SSL + CRNN, trained on N20EMv2',
        split: 'test',
        COnPOff: 73.06,
        COnP: 79.56,
        COn: 93.66,
        tolerances: 'pitch 50 cents, onset 50 ms, offset max(50 ms, 0.2 x duration)',
      },
      notes:
        `${agg.clips} songs of the corpus's ${isTest ? 'test' : 'train+valid'} split ` +
        `(${agg.subjects.size} of the 10 subjects), one ${WINDOW_SEC} s excerpt each: the ` +
        `earliest window holding >=${MIN_NOTES} fully-enclosed notes, starting ${LEAD_SEC} s ` +
        'before its anchor note. Because every song opens with ~10 s of backing track, these ' +
        'excerpts are all song openings — a known selection bias. Audio is the subject\'s own ' +
        'microphone track (vocals.wav), 16 kHz mono, NOT source-separated; the backing track ' +
        '(accomp.wav) is not used. Ground truth is the corpus\'s own note-level annotation ' +
        '(onset/offset/pitch), produced coarse-to-fine: a Melodyne draft corrected by two music ' +
        'experts — the most credible annotation provenance of any corpus in this harness. Pitch ' +
        'is already integer MIDI and notes never overlap, so nothing is re-derived here. ' +
        'bpm is nominal: the subjects sang to a backing track but no tempo is annotated. ' +
        'EXTERNAL YARDSTICK (the reason this corpus is here): the dataset\'s own audio-only ' +
        'baseline reports COnPOff 73.06 / COnP 79.56 / COn 93.66 on its TEST split, at pitch ' +
        'tolerance 50 cents, onset tolerance 50 ms, offset tolerance max(50 ms, 0.2 x note ' +
        'duration) — see `externalBaseline`. run-eval\'s note-F1 is COnP at +-100 ms (a deliberately looser gate — see scripts/eval/README.md; ' +
        '§4.4c), a LOOSER onset gate than their 79.56, so a gap read off those two numbers is ' +
        'an underestimate. The corpus\'s train/valid/test split is preserved: this is the ' +
        `${isTest ? 'TEST half — keep it out of sweeps (SWEEP_EXCLUDE=n20emv2-test) and use it ' +
          'only to confirm a decision already made' : 'tunable half'}; per-clip origins are in ` +
        '`clipSplits`.',
    };
    writeFileSync(join(FIXTURES, dataset, 'dataset.json'), JSON.stringify(manifest, null, 2));
  }

  const clips = chosen.length;
  const totalNotes = chosen.reduce((sum, c) => sum + c.window.notes.length, 0);
  console.log(
    `\nConverted ${clips} N20EMv2 clips (${totalNotes} notes) into ` +
      `${FIXTURES}/{${DEV_DATASET},${TEST_DATASET}}`,
  );
  console.log(
    'Run: EVAL_REAL=1 EVAL_ADAPTIVE=1 pnpm --filter api exec tsx scripts/eval/run-eval.ts',
  );
}

main();
