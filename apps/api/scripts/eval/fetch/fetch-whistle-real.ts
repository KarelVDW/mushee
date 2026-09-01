/**
 * Stage REAL human whistling audio for annotation.
 *
 * Why this script is shaped differently from every other fetch-*.ts: there is no
 * whistling corpus to fetch. `research/research-whistle-corpus.md` records the sweep in
 * full — no note-annotated whistling dataset exists anywhere, and even
 * *unannotated* whistling audio under a licence we may use is scarce enough to
 * enumerate by hand (Wikimedia Commons: seven files; one MIT-licensed teaching
 * repo; Freesound's CC0 slice, behind a token). So this script does the half a
 * fetcher can do — acquire the audio, verify each file's licence against the
 * source's own API, normalise it, record provenance — and stops there. The truth
 * comes from `fetch/draft-note-labels.ts` (an auto-draft, deliberately from a
 * different algorithm family than anything we ship) and then from a human
 * correcting it; `fetch/import-note-labels.ts` turns the corrected labels into a
 * scoreable dataset.
 *
 *   1. fetch/fetch-whistle-real.ts    → .cache/whistle-staging/<dataset>/<clip>.wav
 *   2. fetch/draft-note-labels.ts     → annotations/<dataset>/<clip>.labels.tsv   (TRACKED)
 *   3. (human corrects the TSVs in Audacity / Sonic Visualiser)
 *   4. fetch/import-note-labels.ts    → fixtures/eval-real/<tier>/<dataset>/            (scoreable)
 *
 * Audio is cached, never committed (it is re-fetchable from the URLs below).
 * The label TSVs ARE committed — they are the only part nobody can regenerate.
 *
 * Two datasets, deliberately not one:
 *   whistle-real     — modern, clean, unaccompanied. The whistle tier proper.
 *   whistle-vintage  — public-domain art-whistling 78s (Alice J. Shaw, Frank
 *                      Stafford). Real whistling, but with piano/orchestra
 *                      behind it and acoustic-era surface noise, so it is a
 *                      separate dataset that must never be pooled with the
 *                      clean one.
 *
 * Env:
 *   WHISTLE_INCLUDE_ENCUMBERED=1  also stage the clips whose underlying
 *                                 COMPOSITION is still in copyright (the
 *                                 melody-detection repo's Pink Panther
 *                                 phrases). Off by default — see §1e of
 *                                 research/research-voice-datasets.md for why the
 *                                 recording's licence does not settle this.
 *   FREESOUND_TOKEN=<key>         additionally search Freesound for CC0
 *                                 whistling and stage the previews. Get a key at
 *                                 https://freesound.org/apiv2/apply/ (free,
 *                                 instant) and copy the **Client secret/Api key**
 *                                 column. Instead of an env var you can drop it
 *                                 in `scripts/eval/.freesound-token` (gitignored,
 *                                 one line) — same effect, and the key then lives
 *                                 in exactly one place on disk rather than in
 *                                 shell history. Without either, the source is
 *                                 skipped with a notice.
 *   FREESOUND_MAX=250             how many CC0 candidates to SCREEN (not keep —
 *                                 most search hits are not whistling; see below).
 *   WHISTLE_LOCAL_DIR=<dir>       stage every *.wav in <dir> as dogfood takes
 *                                 (our own recordings — the only route to
 *                                 whistling at volume; protocol in
 *                                 research/research-whistle-corpus.md §6).
 *
 * Run: pnpm --filter api exec tsx scripts/eval/fetch/fetch-whistle-real.ts
 */

import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import ffmpegPath from 'ffmpeg-static';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, join, resolve } from 'path';

import { whistleScreen } from '../lib/sineTrack';
import { wavToFloat } from '../lib/wav';

const CACHE = resolve(__dirname, '../.cache');
const STAGE_ROOT = join(CACHE, 'whistle-staging');
const DOWNLOAD_DIR = join(CACHE, 'whistle-downloads');

/** Everything is normalised to this before annotation, so labels are portable. */
const SAMPLE_RATE = 44100;

const UA = 'solkey-eval-harness/1.0 (research; karel@advantitge.com)';

/**
 * Licences we may use, as the SOURCE's own machine-readable licence id. Checked
 * against the live API response per file, never assumed from this table — a
 * Commons file can be re-licensed, and the whole point of the check is to notice.
 * NC and ND are absent on purpose (research/research-voice-datasets.md §4.0).
 */
const LICENCE_ALLOW = [/^pd$/, /^cc0$/, /^cc-zero$/, /^cc-by-\d/, /^cc-by-sa-\d/];

function licenceAllowed(id: string): boolean {
  const norm = id.trim().toLowerCase();
  if (/-nc|-nd|noncommercial|noderiv/.test(norm)) return false;
  return LICENCE_ALLOW.some((re) => re.test(norm));
}

interface ClipSpec {
  /** Clip id — becomes the label-file and truth-file base name. */
  id: string;
  /** Which staged dataset it belongs to. */
  dataset: 'whistle-real' | 'whistle-vintage';
  /** Commons `File:` title, or a direct URL for non-Commons sources. */
  commonsTitle?: string;
  url?: string;
  /** Excerpt window, for the long vintage sides. Omit to take the whole file. */
  startSec?: number;
  durSec?: number;
  /** Licence we EXPECT (Commons is verified live; direct URLs rely on this). */
  licence: string;
  attribution: string;
  source: string;
  /**
   * The recording is free but the COMPOSITION performed is not (a whistled film
   * theme). Staged only under WHISTLE_INCLUDE_ENCUMBERED=1.
   */
  compositionEncumbered?: boolean;
  note?: string;
}

const MELODY_DETECTION_RAW =
  'https://raw.githubusercontent.com/ebezzam/melody-detection/master/wav_files';

const CLIPS: ClipSpec[] = [
  // --- Wikimedia Commons, modern and unaccompanied -------------------------
  {
    id: 'commons-donna',
    dataset: 'whistle-real',
    commonsTitle: 'File:Whistling la donna a mobile.ogg',
    licence: 'cc-by-sa-4.0',
    attribution: 'Wikimedia Commons user Ctac, CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Whistling_la_donna_a_mobile.ogg',
    // Verdi died 1901: the composition is public domain, so unlike the
    // melody-detection Pink Panther phrases this one carries no §1e problem.
    note: 'whistled "La donna è mobile" (Verdi, PD composition), ~8.9 s, median f0 ~1.08 kHz',
  },
  {
    id: 'commons-human',
    dataset: 'whistle-real',
    commonsTitle: 'File:Human whistling.ogg',
    licence: 'pd',
    attribution: 'Wikimedia Commons user TwoWings, public domain',
    source: 'https://commons.wikimedia.org/wiki/File:Human_whistling.ogg',
    note: '~1.5 s, median f0 ~1.55 kHz — the shortest clip in the tier',
  },
  {
    id: 'commons-soft',
    dataset: 'whistle-real',
    commonsTitle: 'File:Soft whistle.ogg',
    licence: 'pd',
    attribution: 'Commons upload credited to "stilgar", public domain',
    source: 'https://commons.wikimedia.org/wiki/File:Soft_whistle.ogg',
    note: '~5.4 s, quiet breathy whistling, median f0 ~1.45 kHz',
  },
  {
    id: 'commons-untune',
    dataset: 'whistle-real',
    commonsTitle: 'File:Unidentified Tune.ogg',
    licence: 'pd',
    attribution: 'Wikimedia Commons user El aprendelenguas, public domain',
    source: 'https://commons.wikimedia.org/wiki/File:Unidentified_Tune.ogg',
    note: '~6.5 s whistled tune (uploaded to Commons for identification)',
  },
  {
    id: 'commons-glide',
    dataset: 'whistle-real',
    commonsTitle: 'File:Whistle.ogg',
    licence: 'cc-by-sa-3.0',
    attribution: 'Wikimedia Commons user Ruan, CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Whistle.ogg',
    note: '~11.8 s, reaches ~4.4 kHz — the highest real pitched audio the harness has',
  },

  // --- The MIT-licensed teaching repo -------------------------------------
  // ebezzam/melody-detection (LauzHack 2018 workshop, MIT LICENSE at the repo
  // root). Its wav_files/ holds two very different things, and only one of them
  // is whistling:
  //   pp*.wav  — whistled Pink Panther phrases, 762–1800 Hz, genuinely the
  //              product's signal. The RECORDING is MIT; the COMPOSITION
  //              (Mancini, d. 1994) is not, which is the §1e problem, so these
  //              are staged only under WHISTLE_INCLUDE_ENCUMBERED=1.
  //   a/b/c/c3/c4/a6.wav — NOT whistling. Measured with lib/sineTrack: stable
  //              fundamentals at 247 / 262 / 440 / 523 / 910 Hz with ~0.7 of the
  //              frame energy in the fundamental's three bins, i.e. pitch
  //              reference tones named after their note (the workshop's test
  //              signals). Real whistling in the same tracker reads ~0.95
  //              (commons-donna). Deliberately NOT staged: they would put
  //              synthetic tones into a corpus whose entire purpose is being real.
  ...(
    ['ppA', 'ppAfast', 'ppAslow', 'ppAup', 'ppB', 'ppBdown', 'ppBslow'] as const
  ).map((name): ClipSpec => ({
    id: `mit-${name}`,
    dataset: 'whistle-real',
    url: `${MELODY_DETECTION_RAW}/${name}.wav`,
    licence: 'mit',
    attribution: 'ebezzam/melody-detection (MIT)',
    source: 'https://github.com/ebezzam/melody-detection',
    compositionEncumbered: true,
    note: 'whistled Pink Panther phrase — recording is MIT, the composition is not',
  })),

  // --- Public-domain art whistling (accompanied, acoustic-era) -------------
  // Two of the era's professional whistlers. Real whistling in the same band as
  // the product's users, but with piano/orchestra behind it and 78-rpm surface
  // noise — hence its own dataset. Excerpt offsets are arbitrary; the annotator
  // labels whatever is actually whistled inside the window.
  ...([0, 45, 90] as const).map((startSec, i): ClipSpec => ({
    id: `shaw-${i + 1}`,
    dataset: 'whistle-vintage',
    commonsTitle: 'File:Alice J. Shaw and her daughters whistling.mp3',
    startSec,
    durSec: 30,
    licence: 'pd',
    attribution: 'Alice J. Shaw and her daughters, public domain (via Wikimedia Commons)',
    source:
      'https://commons.wikimedia.org/wiki/File:Alice_J._Shaw_and_her_daughters_whistling.mp3',
    note: 'accompanied art whistling, 134 s source, median f0 ~1.48 kHz',
  })),
  ...([10, 55, 100] as const).map((startSec, i): ClipSpec => ({
    id: `stafford-${i + 1}`,
    dataset: 'whistle-vintage',
    commonsTitle: 'File:Gramophone-gc-2-40644-2405e.ogg',
    startSec,
    durSec: 30,
    licence: 'pd',
    attribution:
      'Frank Stafford, "Der Spottvogel" (Septimus Winner, 1827–1902), public domain',
    source: 'https://commons.wikimedia.org/wiki/File:Gramophone-gc-2-40644-2405e.ogg',
    note: 'accompanied art whistling, 160 s source, median f0 ~1.33 kHz',
  })),
];

interface StagedClip {
  id: string;
  dataset: string;
  /**
   * SHA-256 of the staged wav. The tracked label files are timestamps into THIS
   * audio, so if the source is ever re-uploaded or re-encoded the labels silently
   * stop describing it. `fetch/import-note-labels.ts` compares this hash against the
   * one recorded in the clip's tracked `.meta.json` and refuses the clip on a
   * mismatch — the alternative is scoring against shifted truth and never knowing.
   */
  sha256: string;
  licence: string;
  licenceVerified: boolean;
  attribution: string;
  source: string;
  sourceUrl: string;
  startSec?: number;
  durSec?: number;
  note?: string;
  compositionEncumbered?: boolean;
}

function ffmpeg(): string {
  if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve a binary path');
  return ffmpegPath;
}

function curl(url: string, out: string): void {
  execFileSync(
    'curl',
    ['-sL', '--fail', '--max-time', '600', '-A', UA, '-o', out, url],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

/**
 * Resolve a Commons `File:` title to its download URL AND its live licence id.
 * The licence is read from the API's `extmetadata.License` — not from our own
 * table — so a re-licensed or mis-recorded file fails the run instead of
 * quietly entering the corpus.
 */
function commonsFile(title: string): { url: string; licence: string; artist: string } {
  const q = new URLSearchParams({
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    titles: title,
    format: 'json',
    formatversion: '2',
  });
  const raw = execFileSync(
    'curl',
    ['-sL', '--fail', '--max-time', '60', '-A', UA, `https://commons.wikimedia.org/w/api.php?${q.toString()}`],
    { encoding: 'utf8' },
  );
  const pages = (JSON.parse(raw) as {
    query?: { pages?: { imageinfo?: { url: string; extmetadata?: Record<string, { value: string }> }[] }[] };
  }).query?.pages;
  const info = pages?.[0]?.imageinfo?.[0];
  if (!info?.url) throw new Error(`Commons: no imageinfo for ${title}`);
  const licence = info.extmetadata?.License?.value ?? '';
  const artist = (info.extmetadata?.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim();
  return { url: info.url, licence, artist };
}

/** Decode anything (ogg/mp3/wav) to the harness's 44.1 kHz mono PCM16, with an optional window. */
function normalise(src: string, out: string, startSec?: number, durSec?: number): void {
  const args = ['-hide_banner', '-loglevel', 'error', '-y'];
  if (startSec !== undefined) args.push('-ss', String(startSec));
  args.push('-i', src);
  if (durSec !== undefined) args.push('-t', String(durSec));
  args.push('-ar', String(SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le', out);
  execFileSync(ffmpeg(), args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function stage(clip: ClipSpec): StagedClip | undefined {
  const outDir = join(STAGE_ROOT, clip.dataset);
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${clip.id}.wav`);

  let sourceUrl = clip.url ?? '';
  let licence = clip.licence;
  let verified = false;
  let attribution = clip.attribution;

  if (clip.commonsTitle) {
    const info = commonsFile(clip.commonsTitle);
    sourceUrl = info.url;
    licence = info.licence || clip.licence;
    verified = true;
    if (info.artist) attribution = `${info.artist} — ${licence}`;
    if (!licenceAllowed(licence)) {
      console.warn(
        `  ⛔ ${clip.id}: Commons reports licence "${licence}", which is not in the allowlist — SKIPPED`,
      );
      return undefined;
    }
  } else if (!licenceAllowed(licence) && licence !== 'mit') {
    console.warn(`  ⛔ ${clip.id}: licence "${licence}" not allowed — SKIPPED`);
    return undefined;
  }

  if (!existsSync(out)) {
    mkdirSync(DOWNLOAD_DIR, { recursive: true });
    const dl = join(DOWNLOAD_DIR, `${clip.id}${extensionOf(sourceUrl)}`);
    if (!existsSync(dl)) curl(sourceUrl, dl);
    normalise(dl, out, clip.startSec, clip.durSec);
  }

  return {
    id: clip.id,
    dataset: clip.dataset,
    sha256: sha256Of(out),
    licence,
    licenceVerified: verified,
    attribution,
    source: clip.source,
    sourceUrl,
    startSec: clip.startSec,
    durSec: clip.durSec,
    note: clip.note,
    compositionEncumbered: clip.compositionEncumbered,
  };
}

/**
 * The Freesound API key, from the environment or from a gitignored one-line file.
 * Token auth (not OAuth2) is all we need: it reaches the previews, and only
 * ORIGINAL-quality downloads require OAuth2, which no unattended script can do.
 */
function freesoundToken(): string | undefined {
  const fromEnv = process.env.FREESOUND_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const file = resolve(__dirname, '../.freesound-token');
  if (!existsSync(file)) return undefined;
  const fromFile = readFileSync(file, 'utf8').trim();
  return fromFile || undefined;
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function extensionOf(url: string): string {
  const m = /\.(wav|ogg|oga|mp3|flac|m4a)(\?|$)/i.exec(url);
  return m ? `.${m[1].toLowerCase()}` : '.bin';
}

interface FreesoundHit {
  id: number;
  name: string;
  license: string;
  duration: number;
  username: string;
  url: string;
  tags?: string[];
  previews?: Record<string, string>;
}

/**
 * The searches, and why they are shaped like this. Measured counts on the CC0
 * slice (1–40 s): bare `whistling` returns **936** hits and its first page is
 * steam locomotives — "Train Passing By 114 with Bells, Horn, Pitch Change,
 * Whistling" and friends — plus stadium crowds, kettles, wind and a shower head.
 * The same query with the obvious exclusions returns **537** and puts real
 * whistling on the first page. `tag:whistling` is more precise (205) but the tag
 * is applied to trains too, and `tag:whistling tag:melody` collapses to 2, so
 * breadth-plus-screening beats a tighter query.
 *
 * CC0 rather than CC-BY is not a compromise here: measured, CC0 has 936 hits
 * against Attribution's 663, so the permissive slice is also the bigger one and
 * we take on no attribution obligations.
 */
const FREESOUND_QUERIES = [
  'whistling -train -crowd -applause -kettle -wind -bird -steam -shower -bottle -referee -horn -cheer',
  'whistling melody',
  'whistled tune',
  'person whistling song',
] as const;

const FREESOUND_FILTER = 'license:"Creative Commons 0" duration:[1.0 TO 40.0]';

/**
 * Metadata gate, applied to name + tags BEFORE anything is downloaded. Two
 * halves, both learned by reading the output rather than trusting it.
 *
 * 🔴 Why the acoustic screen is not enough. `whistleScreen` asks "is nearly all
 * the energy in one moving partial?" — and a **tin whistle**, a **slide
 * whistle**, a sine **synth** and a **marmot** all answer yes. Measured: of 170
 * screened CC0 candidates it kept 82, whose titles included `tin whistle.wav`,
 * `Celtic Whistle Melody`, `Slide-whistle.wav`, `Hoary marmot whistles`, `Retro
 * video game sfx - Wolf Whistle` and `synth Crystal`. No threshold fixes that:
 * acoustically those ARE the same class of signal as human whistling, so the
 * separation has to come from metadata.
 *
 * REQUIRE: the sound must actually be *described* as whistling, in any of the
 * languages Freesound's contributors use. Without this, sound-design coursework
 * (`GARCIA_Marleen_2014_2015_WarningAlarm.wav`, `VASELLI_Chloe_2018_fallAndSplash.wav`)
 * matched the free-text query through prose nobody vetted and passed the
 * acoustic screen on a synth tone.
 *
 * VETO: things that are described as whistling and are not a person — instruments
 * that whistle, synthesis, cartoons and toys, animals, machines, and heavy
 * processing. Also excluded: whistles that are real but not *melodic* (wolf
 * whistle, cat call), since a glide drafts as a staircase of semitones and gives
 * an annotator a decision no answer to.
 *
 * Both are stem matches (leading `\b`, no trailing one) — the first version
 * anchored both ends and `distort` therefore failed to match "distorted", which
 * is how `Highly distorted whistle 01` got through.
 *
 * Deliberately biased towards **precision, not recall**: a wrong clip costs a
 * human's verification time and then poisons the truth, while a missing clip
 * costs only yield — and the pool (537 hits) is far larger than the corpus needs.
 */
/** Freesound allows 60 API requests/minute; searches are paged, so pace them. */
const FREESOUND_SEARCH_PAUSE_MS = 1100;
/** Bump when the metadata gate or the acoustic screen changes, so verdicts are re-earned. */
const SCREEN_VERSION = 3;

const FREESOUND_REQUIRE = /\b(whistl|silb|pfeif|siffl|vissl|fischi|assobi)/i;

const FREESOUND_VETO =
  /\b(tin[-\s]?whistl|slide[-\s]?whistl|penny[-\s]?whistl|recorder|flute|ocarina|kalimba|panpipe|leaf[-\s]?whistl|sax|synth|chiptune|8[-\s]?bit|video[-\s]?game|game[-\s]?sfx|sfx|\bfx\b|cartoon|mickey|nerf|toy|ringtone|soundalike|alarm|siren|warble|marmot|bird|parrot|dolphin|kitten|animal|referee|police|steam|train|locomotive|kettle|boiling|teapot|escalator|canalisation|hose|hiss|machine|cannon|firework|bottle|distort|vocoder|autotune|reverse|granular|noise|wolf|cat[-\s]?call)/i;

function apiGet(url: string, token: string): unknown {
  const raw = execFileSync(
    'curl',
    ['-sL', '--fail', '--max-time', '120', '-A', UA, '-H', `Authorization: Token ${token}`, url],
    { encoding: 'utf8' },
  );
  return JSON.parse(raw) as unknown;
}

/**
 * Page one query until `wanted` hits are collected or the results run out.
 *
 * ⚠️ Pages are constructed with an explicit `page=N`, NOT by following the
 * response's `next` link: Freesound's `next` points at `/apiv2/search/` (no
 * `/text/`), which does not answer — measured, it returns nothing and killed
 * paging silently after the first 150 results. `page=1,2,3…` against
 * `/search/text/` works and reports a stable `count`.
 */
function searchFreesound(token: string, query: string, wanted: number): FreesoundHit[] {
  const hits: FreesoundHit[] = [];
  const pageSize = 150;
  for (let page = 1; hits.length < wanted; page += 1) {
    const params = new URLSearchParams({
      query,
      filter: FREESOUND_FILTER,
      fields: 'id,name,license,duration,username,previews,url,tags',
      page_size: String(pageSize),
      page: String(page),
    });
    let body: { results?: FreesoundHit[]; count?: number };
    try {
      body = apiGet(
        `https://freesound.org/apiv2/search/text/?${params.toString()}`,
        token,
      ) as typeof body;
    } catch {
      console.warn(`  ! Freesound search failed for "${query}" page ${page} (bad token, rate limit, or API down)`);
      break;
    }
    const results = body.results ?? [];
    hits.push(...results);
    if (results.length < pageSize) break;
    execFileSync('sleep', [String(FREESOUND_SEARCH_PAUSE_MS / 1000)]);
  }
  return hits.slice(0, wanted);
}

/**
 * Freesound's CC0 slice, screened. Token-only auth reaches the previews (the
 * ORIGINAL files need OAuth2, which no unattended script can do) — 128 kbps mp3,
 * lossy but harmless at 1–3 kHz, and the manifest records it.
 *
 * 🔴 Search hits are CANDIDATES, not clips. Every one is downloaded, normalised
 * and put through `whistleScreen` (lib/sineTrack.ts), which keeps only clips
 * whose energy really does sit in one moving partial across several distinct
 * pitches. Decisions are cached by sound id in the download dir, so a re-run
 * neither re-downloads nor re-argues a rejection — and the cache is the audit
 * trail for why any given sound is absent.
 */
function stageFreesound(token: string, max: number): StagedClip[] {
  const staged: StagedClip[] = [];
  const outDir = join(STAGE_ROOT, 'whistle-real');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(DOWNLOAD_DIR, { recursive: true });

  const candidates = new Map<number, FreesoundHit>();
  for (const query of FREESOUND_QUERIES) {
    if (candidates.size >= max) break;
    for (const hit of searchFreesound(token, query, max - candidates.size)) {
      if (!candidates.has(hit.id)) candidates.set(hit.id, hit);
    }
  }
  console.log(`  Freesound: ${candidates.size} candidates across ${FREESOUND_QUERIES.length} queries`);

  // Cache of keep/drop decisions, keyed by sound id, so a re-run neither
  // re-downloads nor re-argues a rejection. `SCREEN_VERSION` is part of the file
  // name: changing the criteria must invalidate old verdicts, not inherit them.
  const cachePath = join(DOWNLOAD_DIR, `freesound-screen-v${SCREEN_VERSION}.json`);
  type Verdict = { keep: boolean; reason: string; name?: string };
  const cache: Record<string, Verdict> = existsSync(cachePath)
    ? (JSON.parse(readFileSync(cachePath, 'utf8')) as Record<string, Verdict>)
    : {};

  let kept = 0;
  let dropped = 0;
  let vetoedCount = 0;
  for (const r of candidates.values()) {
    const id = `freesound-${r.id}`;
    // Freesound reports the human-readable licence URL; only CC0 was requested,
    // so anything else here means the filter did not hold and the clip is dropped.
    if (!/publicdomain\/zero|creativecommons\.org\/publicdomain/.test(r.license)) {
      console.warn(`  ⛔ ${id}: licence "${r.license}" — SKIPPED`);
      continue;
    }
    const preview = r.previews?.['preview-hq-mp3'] ?? r.previews?.['preview-hq-ogg'];
    if (!preview) continue;

    const describes = `${r.name} ${(r.tags ?? []).join(' ')}`;
    if (!FREESOUND_REQUIRE.test(describes)) {
      cache[String(r.id)] = { keep: false, reason: 'not described as whistling', name: r.name };
      vetoedCount += 1;
      continue;
    }
    const vetoed = FREESOUND_VETO.exec(describes)?.[0];
    if (vetoed) {
      cache[String(r.id)] = { keep: false, reason: `vetoed on "${vetoed}"`, name: r.name };
      vetoedCount += 1;
      continue;
    }

    const cached = cache[String(r.id)];
    if (cached && !cached.keep) {
      dropped += 1;
      continue;
    }

    const out = join(outDir, `${id}.wav`);
    if (!existsSync(out)) {
      const dl = join(DOWNLOAD_DIR, `${id}${extensionOf(preview)}`);
      if (!existsSync(dl)) curl(`${preview}${preview.includes('?') ? '&' : '?'}token=${token}`, dl);
      normalise(dl, out);
    }

    const { samples, sampleRate } = wavToFloat(readFileSync(out));
    const screen = whistleScreen(samples, sampleRate);
    cache[String(r.id)] = { keep: screen.keep, reason: screen.reason, name: r.name };
    if (!screen.keep) {
      rmSync(out, { force: true });
      dropped += 1;
      continue;
    }

    kept += 1;
    staged.push({
      id,
      dataset: 'whistle-real',
      sha256: sha256Of(out),
      licence: 'cc0',
      licenceVerified: true,
      attribution: `Freesound user ${r.username} (CC0)`,
      source: r.url,
      sourceUrl: preview,
      note:
        `"${r.name}", ${r.duration.toFixed(1)} s, 128 kbps mp3 preview; ` +
        `screen tonal=${screen.tonalFraction.toFixed(2)} median=${Math.round(screen.medianHz)}Hz ` +
        `notes=${screen.notes}/${screen.distinctPitches} pitches`,
    });
  }

  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  console.log(
    `  Freesound: kept ${kept}, vetoed on metadata ${vetoedCount}, screened out on audio ${dropped} ` +
      `(every verdict cached in ${cachePath})`,
  );
  return staged;
}

/** Our own recorded takes — the only route to whistling at volume. */
function stageLocal(dir: string): StagedClip[] {
  const staged: StagedClip[] = [];
  const outDir = join(STAGE_ROOT, 'whistle-dogfood');
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(dir).filter((n) => /\.(wav|webm|m4a|mp3|ogg)$/i.test(n)).sort()) {
    const id = `dogfood-${basename(f).replace(/\.[^.]+$/, '').replace(/[^a-z0-9-]+/gi, '-')}`;
    const out = join(outDir, `${id}.wav`);
    if (!existsSync(out)) normalise(join(dir, f), out);
    staged.push({
      id,
      dataset: 'whistle-dogfood',
      sha256: sha256Of(out),
      licence: 'in-house',
      licenceVerified: true,
      attribution: 'Solkey in-house recording',
      source: join(dir, f),
      sourceUrl: join(dir, f),
      note: 'dogfood take — see research/research-whistle-corpus.md §6 for the capture protocol',
    });
  }
  return staged;
}

function main(): void {
  const includeEncumbered = process.env.WHISTLE_INCLUDE_ENCUMBERED === '1';
  const staged: StagedClip[] = [];

  for (const clip of CLIPS) {
    if (clip.compositionEncumbered && !includeEncumbered) continue;
    try {
      const s = stage(clip);
      if (s) staged.push(s);
    } catch (err) {
      console.warn(`  ! ${clip.id}: ${(err as Error).message}`);
    }
  }

  const token = freesoundToken();
  if (token) {
    staged.push(...stageFreesound(token, Number(process.env.FREESOUND_MAX ?? 250)));
  } else {
    console.log(
      '  (no Freesound key in FREESOUND_TOKEN or scripts/eval/.freesound-token — ' +
        'skipping the CC0 sweep)',
    );
  }

  const localDir = process.env.WHISTLE_LOCAL_DIR;
  if (localDir && existsSync(localDir)) staged.push(...stageLocal(localDir));

  // One manifest per staged dataset, written next to the audio. draft- and
  // fetch/import-note-labels.ts read it; it is the provenance record that makes the
  // corpus reproducible from tracked files alone.
  const byDataset = new Map<string, StagedClip[]>();
  for (const s of staged) {
    const list = byDataset.get(s.dataset) ?? [];
    list.push(s);
    byDataset.set(s.dataset, list);
  }
  for (const [dataset, clips] of byDataset) {
    const dir = join(STAGE_ROOT, dataset);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'staging.json'),
      `${JSON.stringify({ dataset, sampleRate: SAMPLE_RATE, clips }, null, 2)}\n`,
    );
    console.log(`  ${dataset}: ${clips.length} clips staged`);
  }

  const totalSec = [...byDataset.values()].flat().length;
  console.log(`\nStaged ${totalSec} clips under ${STAGE_ROOT}`);
  console.log('Next: pnpm --filter api exec tsx scripts/eval/fetch/draft-note-labels.ts');
}

main();
