/**
 * Chooses a `PipelineProfile` for one recording from a coarse pitch scan of the
 * first audio, optionally seeded by an instrument hint. This is what makes the
 * single pipeline adapt to any register: it fits the provider's frequency
 * window and the decoder high-pass to the input instead of using one fixed band.
 */

import { Logger } from '@nestjs/common';

import { rangeForInstrument } from './InstrumentRanges';
import {
  DEFAULT_PROFILE,
  GLOBAL_MAX_FREQ_HZ,
  GLOBAL_MIN_FREQ_HZ,
  type PipelineProfile,
  PROFILE_BANDS,
  TRAJECTORY_MODEL_CEILING_HZ,
} from './PipelineProfile';
import { scanPitch } from './pitchScan';

export interface ProfileHint {
  instrumentId?: string;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function band(id: string): PipelineProfile {
  const found = PROFILE_BANDS.find((b) => b.id === id);
  return found ?? DEFAULT_PROFILE;
}

/**
 * Map the detected median fundamental to a register band. Boundaries chosen so
 * piccolo / whistling (median ≳ 1.3 kHz, with notes reaching above the
 * CREPE/PESTO ~1997 Hz ceiling) land in the basic-pitch `very-high` band, while
 * everything the trajectory providers can fully cover routes to them.
 */
function bandFor(medianHz: number): PipelineProfile {
  if (medianHz >= 1300) return band('very-high');
  if (medianHz >= 550) return band('high');
  if (medianHz >= 200) return band('mid');
  return band('low');
}

export class ProfileResolver {
  private readonly logger = new Logger(ProfileResolver.name);

  /**
   * @param samples     mono PCM of the first ~seconds of the recording
   * @param sampleRate  sample rate of `samples`
   */
  resolve(
    samples: Float32Array,
    sampleRate: number,
    hint?: ProfileHint,
  ): PipelineProfile {
    const scan = scanPitch(samples, sampleRate);
    const hintRange = rangeForInstrument(hint?.instrumentId);

    if (!scan.voiced) {
      // No reliable pitch yet — fall back to a wide default, widened to the
      // hint range if we have one.
      const base = DEFAULT_PROFILE;
      if (!hintRange) return base;
      return this.finalize(base, hintRange.minHz, hintRange.maxHz, base.id + '+hint');
    }

    // Fit a window around the detected distribution, with headroom: pad below
    // for the lowest note's fundamental and above for vibrato / the top note.
    // The low bound is deliberately generous — a too-high floor *clips* notes
    // (catastrophic), while a too-low floor only mildly risks an octave error
    // the high-pass and post-processing still suppress. Allowing ~1.7 octaves
    // below the median guards against the scan locking onto a harmonic of a low
    // brass / double-reed fundamental (e.g. a trombone whose energy peaks at the
    // 3rd harmonic), which would otherwise clip its real low notes with no hint.
    let lowHz = Math.min(scan.p10Hz * 0.6, scan.medianHz * 0.3);
    let highHz = scan.p90Hz * 1.5;

    // Union with the hint range so early/extreme notes aren't clipped before
    // the scan saw them.
    if (hintRange) {
      lowHz = Math.min(lowHz, hintRange.minHz);
      highHz = Math.max(highHz, hintRange.maxHz);
    }

    const base = bandFor(scan.medianHz);
    const profile = this.finalize(base, lowHz, highHz, base.id);
    this.logger.debug(
      `Resolved profile=${profile.id} provider=${profile.providerName} ` +
        `window=${profile.minFreqHz.toFixed(0)}-${profile.maxFreqHz.toFixed(0)}Hz ` +
        `hp=${profile.highpassHz.toFixed(0)} ` +
        `(scan p10/med/p90=${scan.p10Hz.toFixed(0)}/${scan.medianHz.toFixed(0)}/${scan.p90Hz.toFixed(0)}Hz, ` +
        `frames=${scan.voicedFrames}, hint=${hint?.instrumentId ?? 'none'})`,
    );
    return profile;
  }

  /** Apply the dynamic window + high-pass to a band anchor, with safety rules. */
  private finalize(
    base: PipelineProfile,
    lowHz: number,
    highHz: number,
    id: string,
  ): PipelineProfile {
    const isTrajectory = base.providerName !== 'basic-pitch';
    // The CREPE/PESTO trajectory providers can't see above their ~1997 Hz
    // ceiling, so cap their window there rather than demoting the whole clip to
    // the (much weaker) basic-pitch — the band router already sends sources
    // whose register sits above the ceiling to the basic-pitch `very-high` band.
    const ceiling = isTrajectory ? TRAJECTORY_MODEL_CEILING_HZ : GLOBAL_MAX_FREQ_HZ;

    const minFreqHz = clamp(lowHz, GLOBAL_MIN_FREQ_HZ, ceiling - 100);
    const maxFreqHz = clamp(
      Math.max(highHz, minFreqHz + 100),
      minFreqHz + 100,
      ceiling,
    );
    // High-pass must sit safely below the lowest fundamental we want to keep.
    const highpassHz = clamp(minFreqHz * 0.6, 30, 400);

    return {
      ...base,
      id,
      providerName: base.providerName,
      minFreqHz,
      maxFreqHz,
      highpassHz,
    };
  }
}
