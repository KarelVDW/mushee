/**
 * Per-(clip, acoustic variant) cache of everything upstream of note
 * segmentation — the same contract as `trackCache.ts`, but keyed on the
 * degradation condition too.
 *
 * `TrackCache` only ever reads `<clip>__real.wav`, which makes it structurally
 * unable to answer the question "what does reverb do to this clip?". This class
 * loads `<clip>__<variant>.wav` (`variant = 'real'` is the clean take), so the
 * clean and reverberant passes over the SAME clip land on the SAME frame grid
 * and can be diffed frame by frame. That paired view is the whole point: it
 * separates "the model's f0 estimate moved" from "the voicing gate closed" from
 * "the segmenter drew different boundaries", which guessing cannot.
 *
 * Beyond `TrackCache` it also stores:
 *   - the raw 100 Hz RMS envelope `OnsetDetector` reads, so re-attack detection
 *     can be re-swept under new thresholds for free (`OnsetDetector.envelope` /
 *     `.detectFromEnvelope`);
 *   - the pitch scan's noise telemetry, so the profile resolver's reverb
 *     classification is inspectable without re-decoding.
 *
 * Bump CACHE_VERSION whenever the decoder, resolver, or CREPE decode changes
 * meaning.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { AudioDecoder } from '../../../src/recordings/pipeline/audio-decoder';
import { OnsetDetector } from '../../../src/recordings/pipeline/onset-detector';
import { PitchTrack } from '../../../src/recordings/pipeline/pitch-track';
import type { PipelineProfile } from '../../../src/recordings/pipeline/profiles/pipeline-profile';
import { scanPitch } from '../../../src/recordings/pipeline/profiles/pitch-scan';
import { ProfileResolver } from '../../../src/recordings/pipeline/profiles/profile-resolver';
import { CrepeProvider } from '../../../src/recordings/pipeline/providers/crepe-provider';
import { ProviderRegistry } from '../../../src/recordings/pipeline/providers/provider-registry';
import type { GroundTruth } from '../types';
import type { AudioFrontEnd } from './dereverb';
import type { RealDataset } from './realCorpus';

/** 2: the track gained per-frame pitch candidates (E3/R9) — see trackCache v6. */
const CACHE_VERSION = 2;
const DETECT_SR = 16000;

/** The clean take plus the two reverberant conditions this study is about. */
export const CLEAN_VARIANT = 'real';

export interface ScanTelemetry {
  voiced: boolean;
  medianHz: number;
  p10Hz: number;
  p90Hz: number;
  voicedFrames: number;
  snrDb?: number;
  noisiness: number;
}

interface CacheMeta {
  version: number;
  clip: string;
  variant: string;
  frames: number;
  hopSec: number;
  durationSec: number;
  providerName: string;
  profile: PipelineProfile;
  scan: ScanTelemetry;
  onsetTimesSec: number[];
  /** `hop` and `sampleRate` OnsetDetector used, so replays reproduce its floats. */
  onsetHop: number;
  onsetSampleRate: number;
  envelopeFrames: number;
  /** Pitch candidates per frame stored in the blob (0 = none). */
  candK?: number;
}

/** One (clip, variant) pair, with the expensive part already computed. */
export interface CachedVariant {
  dataset: string;
  clip: string;
  variant: string;
  truth: GroundTruth;
  profile: PipelineProfile;
  scan: ScanTelemetry;
  providerName: string;
  track: PitchTrack;
  /** Amplitude re-attack times (seconds), at the shipping thresholds. */
  onsetTimesSec: number[];
  /** Raw 100 Hz RMS envelope — replay `OnsetDetector.detectFromEnvelope` on it. */
  envelope: Float32Array;
  onsetHop: number;
  onsetSampleRate: number;
  /** Per-frame RMS on the track's frame grid. */
  energy: Float32Array;
  durationSec: number;
}

export class VariantTrackCache {
  private readonly decoder = new AudioDecoder();
  private readonly resolver = new ProfileResolver();
  private readonly onsetDetector = new OnsetDetector();
  private readonly memo = new Map<string, CachedVariant | null>();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly cacheRoot: string,
  ) {}

  /**
   * @param frontEnd optional audio transform applied to the decoded PCM before
   *   the pitch scan and the model — i.e. a candidate DECODER-stage fix
   *   (dereverberation). Its `id` is part of the cache key, so each front end
   *   gets its own cached trajectories and a front-end sweep is paired against
   *   the untreated run on identical clips.
   */
  async load(
    ds: RealDataset,
    clip: string,
    variant: string,
    frontEnd?: AudioFrontEnd,
  ): Promise<CachedVariant | null> {
    const key = `${ds.id}/${clip}/${variant}/${frontEnd?.id ?? ''}`;
    const memoized = this.memo.get(key);
    if (memoized !== undefined) return memoized;
    let result: CachedVariant | null;
    try {
      result = await this.compute(ds, clip, variant, frontEnd);
    } catch {
      result = null;
    }
    this.memo.set(key, result);
    return result;
  }

  /** True when the variant's audio exists on disk (nothing decoded). */
  static hasAudio(ds: RealDataset, clip: string, variant: string): boolean {
    return existsSync(join(ds.dir, `${clip}__${variant}.wav`));
  }

  private async compute(
    ds: RealDataset,
    clip: string,
    variant: string,
    frontEnd?: AudioFrontEnd,
  ): Promise<CachedVariant | null> {
    let truth: GroundTruth;
    try {
      truth = JSON.parse(
        readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8'),
      ) as GroundTruth;
    } catch {
      return null;
    }

    const dir = join(this.cacheRoot, ds.id);
    const suffix = frontEnd ? `__fe-${frontEnd.id}` : '';
    const metaPath = join(dir, `${clip}__${variant}${suffix}.meta.json`);
    const binPath = join(dir, `${clip}__${variant}${suffix}.bin`);
    const cached = this.readFromDisk(ds, clip, variant, truth, metaPath, binPath);
    if (cached) return cached;

    let wav: Buffer;
    try {
      wav = readFileSync(join(ds.dir, `${clip}__${variant}.wav`));
    } catch {
      return null;
    }

    const rawDet = await this.decoder.decode(wav, DETECT_SR, {
      loudnorm: false,
      highpassHz: 30,
    });
    const det = frontEnd
      ? { ...rawDet, samples: frontEnd.apply(rawDet.samples, DETECT_SR) }
      : rawDet;
    const rawScan = scanPitch(det.samples, DETECT_SR);
    const scan: ScanTelemetry = {
      voiced: rawScan.voiced,
      medianHz: rawScan.medianHz,
      p10Hz: rawScan.p10Hz,
      p90Hz: rawScan.p90Hz,
      voicedFrames: rawScan.voicedFrames,
      snrDb: rawScan.snrDb,
      noisiness: rawScan.noisiness,
    };
    const profile = this.resolver.resolve(det.samples, DETECT_SR, {
      instrumentId: ds.instrumentId,
      // Explicit so the audio source classifier never votes during a cache
      // build — a cached profile must be a pure function of the dataset.
      sourceKind: ds.kind === 'voice' ? 'voice' : 'instrument',
    });
    const provider = this.registry.get(profile.providerName);
    if (!(provider instanceof CrepeProvider)) return null;

    const rawDecoded = await this.decoder.decode(wav, provider.sampleRate, {
      loudnorm: provider.normalizeLoudness,
      highpassHz: profile.highpassHz,
      denoise: profile.denoise,
    });
    const decoded = frontEnd
      ? {
          ...rawDecoded,
          samples: frontEnd.apply(rawDecoded.samples, provider.sampleRate),
        }
      : rawDecoded;
    const track = await provider.track(decoded.samples);
    if (!track) return null;

    const onsetHop = Math.max(
      1,
      Math.round(this.onsetDetector.hopSec * provider.sampleRate),
    );
    const envelope = this.onsetDetector.envelope(
      decoded.samples,
      provider.sampleRate,
    );
    const onsetTimesSec = this.onsetDetector.detectFromEnvelope(
      envelope,
      onsetHop,
      provider.sampleRate,
    );
    const energy = frameEnergy(
      decoded.samples,
      provider.sampleRate,
      track.hopSec,
      track.frames,
    );

    mkdirSync(dir, { recursive: true });
    const meta: CacheMeta = {
      version: CACHE_VERSION,
      clip,
      variant,
      frames: track.frames,
      hopSec: track.hopSec,
      durationSec: decoded.duration,
      providerName: provider.name,
      profile,
      scan,
      onsetTimesSec,
      onsetHop,
      onsetSampleRate: provider.sampleRate,
      envelopeFrames: envelope.length,
      candK: track.candK,
    };
    writeFileSync(metaPath, JSON.stringify(meta));
    // cents | confidence | energy (each `frames`), the envelope, then the
    // pitch candidates (candCents | candStrength, each `frames × candK`).
    const candLen = track.frames * track.candK;
    const blob = new Float32Array(track.frames * 3 + envelope.length + candLen * 2);
    blob.set(track.cents.subarray(0, track.frames), 0);
    blob.set(track.confidence.subarray(0, track.frames), track.frames);
    blob.set(energy, track.frames * 2);
    blob.set(envelope, track.frames * 3);
    if (track.candK > 0 && track.candCents && track.candStrength) {
      const base = track.frames * 3 + envelope.length;
      blob.set(track.candCents.subarray(0, candLen), base);
      blob.set(track.candStrength.subarray(0, candLen), base + candLen);
    }
    writeFileSync(binPath, Buffer.from(blob.buffer, 0, blob.byteLength));

    return {
      dataset: ds.id,
      clip,
      variant,
      truth,
      profile,
      scan,
      providerName: provider.name,
      track,
      onsetTimesSec,
      envelope,
      onsetHop,
      onsetSampleRate: provider.sampleRate,
      energy,
      durationSec: decoded.duration,
    };
  }

  private readFromDisk(
    ds: RealDataset,
    clip: string,
    variant: string,
    truth: GroundTruth,
    metaPath: string,
    binPath: string,
  ): CachedVariant | null {
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
    const candK = meta.candK ?? 0;
    const candLen = n * candK;
    if (floats.length < n * 3 + meta.envelopeFrames + candLen * 2) return null;
    const candBase = n * 3 + meta.envelopeFrames;
    return {
      dataset: ds.id,
      clip,
      variant,
      truth,
      profile: meta.profile,
      scan: meta.scan,
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
      onsetTimesSec: meta.onsetTimesSec,
      envelope: floats.slice(n * 3, n * 3 + meta.envelopeFrames),
      onsetHop: meta.onsetHop,
      onsetSampleRate: meta.onsetSampleRate,
      energy: floats.slice(n * 2, n * 3),
      durationSec: meta.durationSec,
    };
  }
}

/** RMS per track frame, centred on the frame start (matches `TrackCache`). */
function frameEnergy(
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
