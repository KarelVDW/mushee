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
import { CrepeProvider } from '../../../src/recordings/pipeline/providers/crepe-provider';
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
 */
const CACHE_VERSION = 3;
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
}

/** One clip, with the expensive part already computed. */
export interface CachedClip {
  dataset: string;
  clip: string;
  truth: GroundTruth;
  profile: PipelineProfile;
  providerName: string;
  track: PitchTrack;
  /** Amplitude re-attack times (seconds) from `OnsetDetector`. */
  onsetTimesSec: number[];
  /** Per-frame RMS energy on the track's frame grid — for onset/boundary work. */
  energy: Float32Array;
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
    });
    const provider = this.registry.get(profile.providerName);
    if (!(provider instanceof CrepeProvider)) return null;

    const decoded = await this.decoder.decode(wav, provider.sampleRate, {
      loudnorm: provider.normalizeLoudness,
      highpassHz: profile.highpassHz,
      denoise: profile.denoise,
    });
    const track = await provider.track(decoded.samples);
    if (!track) return null;

    const onsetTimesSec = this.onsetDetector.detect(
      decoded.samples,
      provider.sampleRate,
    );
    const energy = this.frameEnergy(
      decoded.samples,
      provider.sampleRate,
      track.hopSec,
      track.frames,
    );

    mkdirSync(dir, { recursive: true });
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
    };
    writeFileSync(metaPath, JSON.stringify(meta));
    // cents | confidence | energy, each `frames` float32s, in that order.
    const blob = new Float32Array(track.frames * 3);
    blob.set(track.cents.subarray(0, track.frames), 0);
    blob.set(track.confidence.subarray(0, track.frames), track.frames);
    blob.set(energy, track.frames * 2);
    writeFileSync(binPath, Buffer.from(blob.buffer, 0, blob.byteLength));

    return {
      dataset: ds.id,
      clip,
      truth,
      profile,
      providerName: provider.name,
      track,
      onsetTimesSec,
      energy,
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
    if (floats.length < n * 3) return null;
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
      ),
      onsetTimesSec: meta.onsetTimesSec,
      energy: floats.slice(n * 2, n * 3),
      durationSec: meta.durationSec,
    };
  }

  /**
   * RMS per track frame, computed over a window centred on the frame start so it
   * lines up with the pitch trajectory. Used by boundary logic that wants to know
   * whether a pitch change is accompanied by an amplitude dip (a real
   * re-articulation) or not (vibrato / portamento).
   */
  private frameEnergy(
    samples: Float32Array,
    sampleRate: number,
    hopSec: number,
    frames: number,
  ): Float32Array {
    const hop = Math.max(1, Math.round(hopSec * sampleRate));
    const half = hop;
    const out = new Float32Array(frames);
    for (let f = 0; f < frames; f += 1) {
      const centre = f * hop;
      const lo = Math.max(0, centre - half);
      const hi = Math.min(samples.length, centre + half);
      let sum = 0;
      for (let i = lo; i < hi; i += 1) sum += samples[i] * samples[i];
      out[f] = hi > lo ? Math.sqrt(sum / (hi - lo)) : 0;
    }
    return out;
  }
}
