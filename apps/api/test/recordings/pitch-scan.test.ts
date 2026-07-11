import { describe, expect, it } from 'vitest';

import { scanPitch } from '../../src/recordings/pipeline/profiles/pitch-scan';
import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver';

const SR = 16000;

/** Deterministic uniform PRNG so noise fixtures are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A harmonic-rich tone (fundamental + 4 harmonics, 1/h rolloff). */
function tone(freqHz: number, seconds: number, gain = 0.5): Float32Array {
  const out = new Float32Array(Math.floor(seconds * SR));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    let s = 0;
    for (let h = 1; h <= 5; h += 1) s += Math.sin(2 * Math.PI * freqHz * h * t) / h;
    out[i] = gain * s * 0.4;
  }
  return out;
}

/** Brown-ish noise: leaky-integrated white — the spectral shape of wind rumble. */
function brownNoise(seconds: number, gain: number, seed = 7): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.floor(seconds * SR));
  let acc = 0;
  for (let i = 0; i < out.length; i += 1) {
    acc = 0.995 * acc + 0.05 * (rand() * 2 - 1);
    out[i] = gain * acc * 4;
  }
  return out;
}

function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i += 1) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

describe('scanPitch', () => {
  it('finds the register of a clean tone and reports it clean', () => {
    const scan = scanPitch(tone(220, 2), SR);
    expect(scan.voiced).toBe(true);
    expect(scan.medianHz).toBeGreaterThan(180);
    expect(scan.medianHz).toBeLessThan(260);
    expect(scan.noisiness).toBeLessThan(0.2);
  });

  it('still finds the fundamental under heavy low-frequency noise (wind)', () => {
    // Wind rumble is low-frequency dominant; without whitening the sub-harmonic
    // summation votes for noise bins and the register collapses downward.
    const scan = scanPitch(mix(tone(440, 2), brownNoise(2, 0.35)), SR);
    expect(scan.voiced).toBe(true);
    expect(scan.medianHz).toBeGreaterThan(350);
    expect(scan.medianHz).toBeLessThan(560);
  });

  it('classifies pure broadband noise as unvoiced instead of inventing a register', () => {
    const scan = scanPitch(brownNoise(2, 0.4), SR);
    expect(scan.voiced).toBe(false);
  });

  it('reports a raised noise floor for a steady backdrop under a gappy melody', () => {
    // A melody with rests: the gaps define the honest floor. Clean input
    // floors far below the loudest frame; a noise bed lifts the gaps.
    const gappy = new Float32Array(2 * SR);
    gappy.set(tone(330, 0.5), 0);
    gappy.set(tone(392, 0.5), SR);
    const clean = scanPitch(gappy, SR);
    const noisy = scanPitch(mix(gappy, brownNoise(2, 0.25, 11)), SR);
    expect(clean.noiseFloorDb).toBeLessThan(-25);
    expect(noisy.noiseFloorDb).toBeGreaterThan(clean.noiseFloorDb);
  });

  it('does not flag a sustained clean note as noisy (no quiet frames != noise)', () => {
    const scan = scanPitch(tone(220, 2), SR);
    expect(scan.noisiness).toBeLessThan(0.08);
  });
});

describe('ProfileResolver noise adaptation', () => {
  it('keeps clean input on the plain band profile', () => {
    const profile = new ProfileResolver().resolve(tone(220, 2), SR);
    expect(profile.id).toBe('mid');
    expect(profile.denoise).toBeUndefined();
  });

  it('flags a noisy backdrop in the profile id, with actions defaulting to no-ops', () => {
    // Like a real take: ambient lead-in (count-off) + notes, over a noise bed —
    // the noise-only frames are what the classifier keys on. The flag is
    // telemetry; the eval measured the tightening/denoise actions as net
    // losses, so their defaults are neutral (see profile-resolver.ts).
    const melody = new Float32Array(3 * SR);
    melody.set(tone(220, 0.8), Math.floor(1.2 * SR));
    melody.set(tone(262, 0.7), Math.floor(2.2 * SR));
    const profile = new ProfileResolver().resolve(
      mix(melody, brownNoise(3, 0.3, 5)),
      SR,
    );
    expect(profile.id).toContain('+noise');
    expect(profile.denoise).toBeUndefined();
    expect(profile.minFramesPerNote).toBe(4);
    // Bump defaults to 0; the threshold stays at the band's value.
    expect(profile.confidenceThreshold).toBe(0.5);
  });

  it('still resolves the right register band under the noisy backdrop', () => {
    const melody = new Float32Array(3 * SR);
    melody.set(tone(220, 0.8), Math.floor(1.2 * SR));
    melody.set(tone(262, 0.7), Math.floor(2.2 * SR));
    const clean = new ProfileResolver().resolve(melody, SR);
    const noisy = new ProfileResolver().resolve(
      mix(melody, brownNoise(3, 0.3, 5)),
      SR,
    );
    expect(noisy.providerName).toBe(clean.providerName);
    expect(noisy.minFreqHz).toBeLessThan(220);
    expect(noisy.maxFreqHz).toBeGreaterThan(220);
  });
});
