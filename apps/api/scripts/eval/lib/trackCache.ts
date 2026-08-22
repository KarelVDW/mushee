/**
 * Per-clip cache of everything *upstream* of note segmentation: the resolved
 * pipeline profile, the frame-level `PitchTrack` from the model, the amplitude
 * re-attack onsets, and the clip's ground truth.
 *
 * Why this exists: model inference dominates a corpus run (~40 min over the real
 * corpus), but every accuracy question worth asking tonight — segmentation,
 * cleanup, tempo estimation, quantization — lives *downstream* of the forward
 * pass and is arithmetic on a few thousand floats. Caching the trajectory turns
 * a 40-minute experiment into a sub-second one, which is the difference between
 * testing five ideas and testing five hundred.
 *
 * The cache is keyed by clip only. It deliberately does NOT key on the pitch
 * options, because the trajectory doesn't depend on them: the frequency window,
 * confidence gate and note-length floor are all applied by the *segmenter*,
 * reading the track. (The profile's `highpassHz` DOES affect decoding, and is
 * part of the resolved profile stored alongside — so a change to the resolver or
 * the decoder must bump CACHE_VERSION.)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { AudioDecoder } from '../../../src/recordings/pipeline/audio-decoder';
import { OnsetDetector } from '../../../src/recordings/pipeline/onset-detector';
import { PitchTrack } from '../../../src/recordings/pipeline/pitch-track';
import type { PipelineProfile } from '../../../src/recordings/pipeline/profiles/pipeline-profile';
import { ProfileResolver } from '../../../src/recordings/pipeline/profiles/profile-resolver';
import type {
  PitchProvider,
  PitchSession,
} from '../../../src/recordings/pipeline/providers/pitch-provider';
import { frameEnergy } from '../../../src/recordings/pipeline/providers/pitch-decoder';
import { ProviderRegistry } from '../../../src/recordings/pipeline/providers/provider-registry';
import type { GroundTruth } from '../types';
import type { RealDataset } from './realCorpus';

/**
 * Bump whenever the decoder, resolver, or CREPE trajectory changes meaning.
 *
 * 3: the resolver gained a reverberance-adaptive voicing gate, so a cached
 *    `profile.confidenceThreshold` from before it is no longer what the pipeline
 *    would choose for that clip — and since the segmenters read the gate straight
 *    out of the cached profile, a stale entry would silently score the old policy.
 * 4: the resolver gained voice routing (`applyVoice`), so a cached profile carries
 *    neither `segmentMode` nor `isVoice` and a voice clip would replay as an
 *    instrument. The trajectory bytes themselves are unaffected — the overlay
 *    touches no gate, window or high-pass — but the rule is bump-on-resolver-change
 *    precisely because that judgement is easy to get wrong, so this bumps.
 * 5: adds the 10 ms `OnsetDetector` envelope. The 20 ms trajectory-grid energy
 *    already stored is the wrong instrument for re-attack work: at identical
 *    thresholds the detector finds re-onset recall 0.218 on it against 0.329 on its
 *    own 10 ms grid, because a re-articulation dip lasts 30–50 ms. A sweep over the
 *    coarse envelope measures the frame rate, not the rule.
 * 6: the track gained per-frame pitch CANDIDATES (E3/R9 — top-5 activation
 *    maxima with sub-bin cents), which only exist at decode time; a stale entry
 *    would replay a candidate-less track under a decoder expecting them.
 *
 * NOT bumped for the 2026-08-22 basic-pitch removal, deliberately: every entry
 * this cache can hold is a crepe-tiny low/mid/high routing (basic-pitch
 * routings returned null and were never written), and for those the new
 * resolver's window ceiling, gates and overlays are byte-identical to the old
 * one's. The change only affects routes that never produced an entry (the
 * very-high band; the default fallback, which now caches where it used to
 * null) — additive, not stale.
 */
const CACHE_VERSION = 6;
const DETECT_SR = 16000;

interface CacheMeta {
  version: number;
  clip: string;
  frames: number;
  hopSec: number;
  durationSec: number;
  providerName: string;
  profile: PipelineProfile;
  onsetTimesSec: number[];
  /** Per-frame RMS of the decoded audio, aligned to the track's frame grid. */
  hasEnergy: boolean;
  /** Frames in `fineEnergy`, and its hop — `OnsetDetector`'s own 10 ms grid. */
  fineFrames: number;
  fineHopSec: number;
  /** Pitch candidates per frame stored in the blob (0 = none). */
  candK?: number;
}

/** One clip, with the expensive part already computed. */
export interface CachedClip {
  dataset: string;
  clip: string;
  truth: GroundTruth;
  profile: PipelineProfile;
  providerName: string;
  track: PitchTrack;
  /**
   * Where the clip's audio lives, and where a derived spectral-flux sidecar
   * may be cached (`lib/spectralFlux.ts`). Derived at load time — neither is
   * part of the persisted blob, so adding them costs no CACHE_VERSION bump.
   */
  wavPath: string;
  fluxPath: string;
  /** Amplitude re-attack times (seconds) from `OnsetDetector`. */
  onsetTimesSec: number[];
  /** Per-frame RMS energy on the track's frame grid — for onset/boundary work. */
  energy: Float32Array;
  /**
   * `OnsetDetector`'s own envelope, at its 10 ms hop — the ONLY grid on which a
   * re-attack threshold sweep means anything (see CACHE_VERSION 5).
   */
  fineEnergy: Float32Array;
  fineHopSec: number;
  durationSec: number;
}

export class TrackCache {
  private readonly decoder = new AudioDecoder();
  private readonly resolver = new ProfileResolver();
  private readonly onsetDetector = new OnsetDetector();
  /** In-process memo so repeated loads in one sweep don't re-read from disk. */
  private readonly memo = new Map<string, CachedClip | null>();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly cacheRoot: string,
  ) {}

  /**
   * Load a clip's cached trajectory, computing (and persisting) it on a miss.
   * Returns null when the clip is unreadable or its profile routes to a provider
   * with no frame-level trajectory (basic-pitch) — callers should count those
   * rather than treat them as zero-score.
   */
  async load(ds: RealDataset, clip: string): Promise<CachedClip | null> {
    const key = `${ds.id}/${clip}`;
    const memoized = this.memo.get(key);
    if (memoized !== undefined) return memoized;
    const result = await this.compute(ds, clip);
    this.memo.set(key, result);
    return result;
  }

  private async compute(ds: RealDataset, clip: string): Promise<CachedClip | null> {
    let truth: GroundTruth;
    try {
      truth = JSON.parse(
        readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8'),
      ) as GroundTruth;
    } catch {
      return null;
    }

    const dir = join(this.cacheRoot, ds.id);
    const metaPath = join(dir, `${clip}.meta.json`);
    const binPath = join(dir, `${clip}.bin`);
    const cached = this.readFromDisk(ds, clip, truth, metaPath, binPath);
    if (cached) return cached;

    let wav: Buffer;
    try {
      wav = readFileSync(join(ds.dir, `${clip}__real.wav`));
    } catch {
      return null;
    }

    const det = await this.decoder.decode(wav, DETECT_SR, {
      loudnorm: false,
      highpassHz: 30,
    });
    const profile = this.resolver.resolve(det.samples, DETECT_SR, {
      instrumentId: ds.instrumentId,
      // Explicit so the audio source classifier never votes during a cache
      // build — a cached profile must be a pure function of the dataset.
      sourceKind: ds.kind === 'voice' ? 'voice' : 'instrument',
    });
    const provider = this.registry.get(profile.providerName);
    // Any provider exposing a frame-level trajectory is cacheable — that is
    // both CREPE variants since the octave-down wrapper gained `track()`
    // (real-domain cents + real hop), which is what finally lets the cached
    // sweeps reach the very-high band. (Historically this was an
    // `instanceof CrepeProvider` check, which is why basic-pitch routings and
    // very-high clips never had cache entries.)
    if (!hasTrack(provider)) return null;

    const decoded = await this.decoder.decode(wav, provider.sampleRate, {
      loudnorm: provider.normalizeLoudness,
      highpassHz: profile.highpassHz,
      denoise: profile.denoise,
    });
    const track = await provider.track(decoded.samples);
    if (!track) return null;

    // Computed once and kept, rather than re-derived from `detect`: the harness
    // needs the envelope itself to sweep thresholds over, and it must be the same
    // array the shipping detector saw.
    const fineEnergy = this.onsetDetector.envelope(
      decoded.samples,
      provider.sampleRate,
    );
    const fineHop = Math.max(
      1,
      Math.round(this.onsetDetector.hopSec * provider.sampleRate),
    );
    const onsetTimesSec = this.onsetDetector.detectFromEnvelope(
      fineEnergy,
      fineHop,
      provider.sampleRate,
    );
    // Shared with the production decode (see `frameEnergy`): the voice decoder's
    // dip and accent channels read this exact envelope at runtime, so a private
    // copy here would tune the sweep against something the pipeline never sees.
    const energy = frameEnergy(
      decoded.samples,
      provider.sampleRate,
      track.hopSec,
      track.frames,
    );

    mkdirSync(dir, { recursive: true });
    const candK = track.candK;
    const meta: CacheMeta = {
      version: CACHE_VERSION,
      clip,
      frames: track.frames,
      hopSec: track.hopSec,
      durationSec: decoded.duration,
      providerName: provider.name,
      profile,
      onsetTimesSec,
      hasEnergy: true,
      fineFrames: fineEnergy.length,
      fineHopSec: this.onsetDetector.hopSec,
      candK,
    };
    writeFileSync(metaPath, JSON.stringify(meta));
    // cents | confidence | energy (each `frames`), fineEnergy, then the pitch
    // candidates (candCents | candStrength, each `frames × candK`).
    const candLen = track.frames * candK;
    const blob = new Float32Array(track.frames * 3 + fineEnergy.length + candLen * 2);
    blob.set(track.cents.subarray(0, track.frames), 0);
    blob.set(track.confidence.subarray(0, track.frames), track.frames);
    blob.set(energy, track.frames * 2);
    blob.set(fineEnergy, track.frames * 3);
    if (candK > 0 && track.candCents && track.candStrength) {
      const base = track.frames * 3 + fineEnergy.length;
      blob.set(track.candCents.subarray(0, candLen), base);
      blob.set(track.candStrength.subarray(0, candLen), base + candLen);
    }
    writeFileSync(binPath, Buffer.from(blob.buffer, 0, blob.byteLength));

    return {
      dataset: ds.id,
      clip,
      truth,
      profile,
      providerName: provider.name,
      track,
      wavPath: join(ds.dir, `${clip}__real.wav`),
      fluxPath: join(dir, `${clip}.flux.bin`),
      onsetTimesSec,
      energy,
      fineEnergy,
      fineHopSec: this.onsetDetector.hopSec,
      durationSec: decoded.duration,
    };
  }

  private readFromDisk(
    ds: RealDataset,
    clip: string,
    truth: GroundTruth,
    metaPath: string,
    binPath: string,
  ): CachedClip | null {
    if (!existsSync(metaPath) || !existsSync(binPath)) return null;
    let meta: CacheMeta;
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8')) as CacheMeta;
    } catch {
      return null;
    }
    if (meta.version !== CACHE_VERSION) return null;
    const raw = readFileSync(binPath);
    const floats = new Float32Array(
      raw.buffer,
      raw.byteOffset,
      raw.byteLength / 4,
    );
    const n = meta.frames;
    const fine = meta.fineFrames ?? 0;
    const candK = meta.candK ?? 0;
    const candLen = n * candK;
    if (floats.length < n * 3 + fine + candLen * 2) return null;
    const candBase = n * 3 + fine;
    return {
      dataset: ds.id,
      clip,
      truth,
      profile: meta.profile,
      providerName: meta.providerName,
      track: new PitchTrack(
        floats.slice(0, n),
        floats.slice(n, n * 2),
        n,
        meta.hopSec,
        candK > 0 ? floats.slice(candBase, candBase + candLen) : undefined,
        candK > 0 ? floats.slice(candBase + candLen, candBase + candLen * 2) : undefined,
        candK,
      ),
      wavPath: join(ds.dir, `${clip}__real.wav`),
      fluxPath: binPath.replace(/\.bin$/, '.flux.bin'),
      onsetTimesSec: meta.onsetTimesSec,
      energy: floats.slice(n * 2, n * 3),
      fineEnergy: floats.slice(n * 3, n * 3 + fine),
      fineHopSec: meta.fineHopSec,
      durationSec: meta.durationSec,
    };
  }

}

/** A provider whose frame-level trajectory can be cached. */
interface TrajectoryProvider extends PitchProvider {
  track(
    samples: Float32Array,
    session?: PitchSession,
  ): Promise<PitchTrack | null>;
}

function hasTrack(p: PitchProvider): p is TrajectoryProvider {
  return typeof (p as Partial<TrajectoryProvider>).track === 'function';
}
