/**
 * Deterministic synthesis of the acoustic elements behind the adverse-condition
 * evaluation matrix: room impulse responses (real reverberation, unlike the
 * single-tap `aecho` slapback), gusty wind noise, and speech-shaped babble.
 * Everything is seeded so the corpus is reproducible byte-for-byte.
 */

/** Deterministic PRNG (mulberry32) — same seed, same corpus. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximate gaussian via the sum of three uniforms (plenty for noise beds). */
function gaussian(rand: () => number): number {
  return rand() + rand() + rand() - 1.5;
}

export interface RoomImpulseOptions {
  sampleRate: number;
  /** Time for the tail to decay 60 dB — the "echoey-ness" of the room. */
  rt60Sec: number;
  /** Wet (reverb tail) level relative to the direct spike, in dB. */
  wetDb: number;
  /** Gap between the direct sound and the first reflection. */
  preDelayMs?: number;
  seed?: number;
}

/**
 * A synthetic room impulse response: unit direct spike, a handful of discrete
 * early reflections, then an exponentially decaying diffuse tail whose highs
 * die faster than its lows (one-pole lowpass warmed over time) — the classic
 * shape of a hard-walled room. Convolving a clip with this (ffmpeg `afir`)
 * yields genuine smearing of onsets/offsets, which a single echo tap cannot.
 */
export function synthesizeRoomImpulse(options: RoomImpulseOptions): Float32Array {
  const { sampleRate, rt60Sec, wetDb, preDelayMs = 12, seed = 1234 } = options;
  const rand = mulberry32(seed);
  const lengthSec = rt60Sec * 1.2;
  const ir = new Float32Array(Math.ceil(lengthSec * sampleRate));

  // Direct path: everything else in the IR is scaled relative to this.
  ir[0] = 1;

  const wet = Math.pow(10, wetDb / 20);
  const preDelay = Math.floor((preDelayMs / 1000) * sampleRate);

  // Early reflections: sparse taps over the first ~70 ms, alternating sign.
  // (Amplitudes are relative — the post-direct energy normalization below sets
  // the absolute wet level.)
  const reflections = 8;
  for (let r = 0; r < reflections; r++) {
    const at = preDelay + Math.floor(((r + rand()) / reflections) * 0.07 * sampleRate);
    if (at < ir.length) {
      const sign = r % 2 === 0 ? 1 : -1;
      ir[at] += sign * 2.5 * (1 - r / reflections) * (0.7 + 0.6 * rand());
    }
  }

  // Diffuse tail: gaussian noise under an exp decay hitting -60 dB at RT60,
  // through a one-pole lowpass whose cutoff falls over time (air + walls
  // absorb highs first).
  let lp = 0;
  const tailStart = preDelay + Math.floor(0.02 * sampleRate);
  for (let i = tailStart; i < ir.length; i++) {
    const t = (i - tailStart) / sampleRate;
    const decay = Math.exp((-6.907755 * t) / rt60Sec); // 10^(-3 t / RT60)
    // Cutoff sweeps ~6 kHz -> ~1.2 kHz across the tail.
    const cutoff = 6000 * Math.exp(-t / rt60Sec) + 1200;
    const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
    lp += alpha * (gaussian(rand) - lp);
    ir[i] += decay * lp;
  }

  // Normalize everything after the direct spike so its total ENERGY (which is
  // what sets the level of a convolved sustained tone) sits `wetDb` relative
  // to the direct path — a raw decaying-noise tail would add ~+19 dB.
  let tailEnergy = 0;
  for (let i = 1; i < ir.length; i++) tailEnergy += ir[i] * ir[i];
  const scale = wet / Math.sqrt(tailEnergy || 1);
  for (let i = 1; i < ir.length; i++) ir[i] *= scale;

  return ir;
}

export interface NoiseOptions {
  sampleRate: number;
  durationSec: number;
  seed?: number;
}

/**
 * Outdoor wind at a microphone: brown noise (integrated white, low-frequency
 * dominant — exactly the rumble that swamps low fundamentals) under a slow
 * gust envelope with occasional buffeting bursts. Output is RMS-normalized;
 * the mixing gain sets the SNR.
 */
export function synthesizeWind(options: NoiseOptions): Float32Array {
  const { sampleRate, durationSec, seed = 4242 } = options;
  const rand = mulberry32(seed);
  const n = Math.ceil(durationSec * sampleRate);
  const out = new Float32Array(n);

  // Gust envelope: random walk targets every ~0.6 s, smoothed hard, then
  // shaped (^2) so lulls are quiet and gusts genuinely gust.
  const gustStep = Math.floor(0.6 * sampleRate);
  let gustFrom = 0.3 + 0.5 * rand();
  let gustTo = 0.3 + 0.7 * rand();
  let gustAt = 0;

  let brown = 0;
  let buffet = 0; // extra sub-20 Hz mic-diaphragm pumping during strong gusts
  for (let i = 0; i < n; i++) {
    if (i - gustAt >= gustStep) {
      gustAt = i;
      gustFrom = gustTo;
      gustTo = Math.min(1.3, Math.max(0.05, gustTo + (rand() - 0.48) * 0.8));
    }
    const phase = (i - gustAt) / gustStep;
    const env = gustFrom + (gustTo - gustFrom) * (0.5 - 0.5 * Math.cos(Math.PI * phase));

    // Brown noise: leaky integration of white noise.
    brown = 0.997 * brown + 0.03 * gaussian(rand);
    // Buffeting: very slow large-amplitude pumping, scaled by gust strength.
    buffet = 0.9995 * buffet + 0.004 * gaussian(rand);

    out[i] = (brown + buffet * env * 2) * env * env;
  }

  return rmsNormalize(out);
}

/**
 * Speech-shaped background babble: pink-ish noise band-passed into the speech
 * band with a syllabic-rate (~4 Hz) irregular amplitude modulation — the
 * standard stand-in for a room full of talkers / street chatter.
 */
export function synthesizeSpeechNoise(options: NoiseOptions): Float32Array {
  const { sampleRate, durationSec, seed = 777 } = options;
  const rand = mulberry32(seed);
  const n = Math.ceil(durationSec * sampleRate);
  const out = new Float32Array(n);

  // Pink-ish source: two-stage leaky integrators over white noise.
  let p1 = 0;
  let p2 = 0;
  // Speech band-pass: one-pole highpass at ~300 Hz + lowpass at ~3.4 kHz.
  const hpAlpha = 1 - Math.exp((-2 * Math.PI * 300) / sampleRate);
  const lpAlpha = 1 - Math.exp((-2 * Math.PI * 3400) / sampleRate);
  let hpState = 0;
  let lp = 0;

  // Syllabic AM: new modulation target ~4 times per second.
  const modStep = Math.floor(sampleRate / 4);
  let modFrom = 0.5;
  let modTo = 0.4 + 0.8 * rand();
  let modAt = 0;

  for (let i = 0; i < n; i++) {
    p1 = 0.98 * p1 + 0.1 * gaussian(rand);
    p2 = 0.9 * p2 + 0.3 * gaussian(rand);
    const pink = p1 + p2 * 0.4;

    hpState += hpAlpha * (pink - hpState);
    const highpassed = pink - hpState;
    lp += lpAlpha * (highpassed - lp);

    if (i - modAt >= modStep) {
      modAt = i;
      modFrom = modTo;
      modTo = 0.25 + 0.9 * rand();
    }
    const phase = (i - modAt) / modStep;
    const mod = modFrom + (modTo - modFrom) * (0.5 - 0.5 * Math.cos(Math.PI * phase));

    out[i] = lp * mod;
  }

  return rmsNormalize(out);
}

/** Scale to RMS 0.1 (≈ -20 dBFS) so condition gains mean the same thing everywhere. */
function rmsNormalize(samples: Float32Array): Float32Array {
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length) || 1;
  const scale = 0.1 / rms;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  return samples;
}
