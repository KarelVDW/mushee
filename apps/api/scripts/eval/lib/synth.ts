/**
 * Direct additive synthesis of voice / whistle clips from ground-truth notes.
 *
 * These are deliberately simple proxies — they are NOT meant to sound like a
 * real human, only to reproduce the *pitch characteristics* that break the
 * pipeline: whistles are near-pure high-frequency tones; sung voice is a
 * harmonic-rich tone whose fundamental can sit very low (bass) or fairly high
 * (soprano), with vibrato and a little breath noise.
 */

import type { GroundTruth } from '../types';
import { midiToHz } from './groundTruth';

export interface SynthOptions {
  sampleRate: number;
  kind: 'voice' | 'whistle';
  /** 0..1 master gain before degradation. */
  gain?: number;
  /** Deterministic noise seed so corpus generation is reproducible. */
  seed?: number;
}

/**
 * How the singer separates one note from the next — the axis the whole voice
 * flow turns on, and the one this corpus could not previously express.
 *
 * Li, Demirel, Proutskova & Dixon (NLP4MusA 2021) measured note-transcription F
 * on the same system across lyric content and found a **19-point spread**:
 * Spanish 0.709, English 0.523, /Na/+/La/ 0.520 — and on a corpus sung entirely
 * on /Ta/, plain voicing-based segmentation alone scored 0.645 and beat their
 * full pipeline, because a voiceless plosive delimits every note for free. So
 * articulation is not a nuisance variable, it is the dominant one, and a corpus
 * that holds it fixed cannot tell you whether a boundary channel works.
 *
 * Ordered easiest → hardest for a transcriber:
 *
 *  - `plosive`    — "ta-ta-ta", "puh-duh": a voiceless closure separates every
 *                   note, then a burst. Every note is its own voiced segment.
 *  - `continuant` — "la-la-la", "na", "ma": voicing never stops; the boundary is
 *                   an amplitude dip and a small pitch dip, nothing more. This is
 *                   the case that generates **re-onsets** on repeated pitches, which
 *                   a pitch-trajectory decode is structurally blind to.
 *  - `hum`        — closed mouth: legato, dark spectrum, the faintest boundary.
 *  - `vowel`      — sustained legato "aaah" with portamento between notes: *no*
 *                   boundary evidence at all. The hardest input, and the reason the
 *                   evidence-backed user tip is "try ta-ta-ta", not "sing vowels".
 */
export type Articulation = 'plosive' | 'continuant' | 'hum' | 'vowel';

export interface ArticulatedSynthOptions extends SynthOptions {
  kind: 'voice';
  articulation: Articulation;
  /**
   * Per-note random pitch offset, in cents (std-dev). Mauch, Frieler & Dixon
   * (JASA 2014) measured unaccompanied singers' median note error at **19 cents**,
   * and found per-note scatter — not drift — is what dominates.
   */
  pitchScatterCents?: number;
  /**
   * Slow tuning drift across the whole take, in cents (peak). Same study: whole-
   * performance drift averages only **11 cents** and is significant in 22 % of
   * recordings, so this is deliberately small — a corpus with dramatic drift would
   * be modelling something singers do not actually do.
   */
  driftCents?: number;
  /** Semitones below the target each note is approached from, over ~70 ms. */
  scoopSemitones?: number;
  /**
   * R20 intonation tier: detune every note by exactly this magnitude (cents),
   * random sign, REPLACING the Gaussian scatter — a controlled dose where
   * `pitchScatterCents` is a realistic error model. Undefined keeps the
   * historical scatter path byte-for-byte.
   */
  detuneCents?: number;
  /** Filled with the applied per-note detunes (cents), in onset order. */
  outDetunes?: number[];
}

const ARTICULATION_SHAPE: Record<
  Articulation,
  {
    /** Voiceless silence before each note, in seconds. */
    closureSec: number;
    /** Broadband burst amplitude at the note's start (0 = none). */
    burstAmp: number;
    /** Envelope floor at a legato boundary, as a fraction of full level. */
    dipFloor: number;
    /** Half-width of the boundary dip, in seconds. */
    dipHalfSec: number;
    /** Momentary pitch drop into a legato boundary, in cents. */
    pitchDipCents: number;
    /** Portamento time between two different pitches, in seconds. */
    glideSec: number;
    /** Harmonics rendered — a closed mouth is dark. */
    harmonics: number;
  }
> = {
  plosive: {
    closureSec: 0.055, burstAmp: 0.5, dipFloor: 1, dipHalfSec: 0,
    pitchDipCents: 0, glideSec: 0.01, harmonics: 24,
  },
  continuant: {
    closureSec: 0, burstAmp: 0, dipFloor: 0.28, dipHalfSec: 0.025,
    pitchDipCents: 45, glideSec: 0.035, harmonics: 20,
  },
  hum: {
    closureSec: 0, burstAmp: 0, dipFloor: 0.6, dipHalfSec: 0.03,
    pitchDipCents: 15, glideSec: 0.05, harmonics: 6,
  },
  vowel: {
    closureSec: 0, burstAmp: 0, dipFloor: 1, dipHalfSec: 0,
    pitchDipCents: 0, glideSec: 0.07, harmonics: 24,
  },
};

/** Tiny deterministic PRNG (mulberry32) so generated audio is reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple formant gain for a harmonic at frequency f (very rough vowel "ah"). */
function formantGain(f: number): number {
  const formants = [
    { freq: 700, bw: 130 },
    { freq: 1220, bw: 70 },
    { freq: 2600, bw: 160 },
  ];
  // Baseline keeps the fundamental and low harmonics audible (real sung voice
  // is not formant-only); formants add a moderate ~3× boost, not 13×.
  let g = 0.4;
  for (const fmt of formants) {
    const d = (f - fmt.freq) / fmt.bw;
    g += 0.7 * Math.exp(-0.5 * d * d);
  }
  return g;
}

/**
 * Articulated singing: one phase-continuous oscillator driven by a per-sample f0
 * and amplitude track, so legato really is legato and a boundary is whatever the
 * articulation says it is.
 *
 * Deliberately a **separate function** from `synthesize`, which the existing
 * `voice-*` scenarios still use unchanged. Folding the two would change the bytes
 * of every clip in the standing corpus and silently invalidate every number in the
 * findings log; the cost of the duplication is one oscillator loop.
 *
 * What it models, and why each piece is here rather than "for realism":
 *
 *  - **The boundary, per articulation** (see `Articulation`) — the point of the
 *    whole thing. On `continuant`/`hum`, two consecutive same-pitch notes come out
 *    as a genuine **re-onset**: continuous voicing, no pitch change, only a dip.
 *    Nothing in the previous synthetic tier could produce one.
 *  - **Scoops** into notes, because the attack state exists to absorb them and an
 *    un-scooped corpus cannot show whether it does.
 *  - **Per-note scatter and slow drift** at the magnitudes JASA 2014 measured, so
 *    that a decode's pitch estimator is tested against the error singers actually
 *    make rather than against exact MIDI.
 */
export function synthesizeArticulated(
  truth: GroundTruth,
  opts: ArticulatedSynthOptions,
): Float32Array {
  const sr = opts.sampleRate;
  const gain = opts.gain ?? 0.6;
  const rng = makeRng(opts.seed ?? 1);
  const shape = ARTICULATION_SHAPE[opts.articulation];
  const scatter = opts.pitchScatterCents ?? 19;
  const drift = opts.driftCents ?? 11;
  const scoop = opts.scoopSemitones ?? 0.8;

  const notes = [...truth.notes].sort((a, b) => a.onsetSec - b.onsetSec);
  const last = notes[notes.length - 1];
  const totalSec = (last ? last.onsetSec + last.durSec : 0) + 0.2;
  const n = Math.ceil(totalSec * sr);
  const out = new Float32Array(n);
  if (!notes.length) return out;

  // Per-note target cents: the written pitch plus this singer's own error.
  // Box–Muller off the deterministic RNG so the scatter is Gaussian and the
  // corpus is still byte-reproducible. Under the intonation tier the error is
  // a fixed magnitude with a random sign instead — a controlled dose.
  const targets = notes.map((note) => {
    if (opts.detuneCents !== undefined) {
      const d = (rng() < 0.5 ? -1 : 1) * opts.detuneCents;
      opts.outDetunes?.push(d);
      return note.midi * 100 + d;
    }
    const u = Math.max(1e-9, rng());
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
    const d = g * scatter;
    opts.outDetunes?.push(d);
    return note.midi * 100 + d;
  });

  // Per-sample f0 (cents) and amplitude. Built as tracks rather than per-note
  // renders because legato boundaries are defined BETWEEN notes.
  const cents = new Float32Array(n);
  const amp = new Float32Array(n);
  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i];
    const prev = i > 0 ? notes[i - 1] : null;
    const next = notes[i + 1] ?? null;
    const startSec = note.onsetSec;
    const endSec = note.onsetSec + note.durSec;
    // A plosive closes the mouth before the vowel, eating the tail of the note
    // before it — which is exactly why /Ta/ input is easy to segment.
    const soundStart = startSec;
    const soundEnd = Math.max(startSec + 0.05, endSec - (next ? shape.closureSec : 0.03));
    const from = Math.floor(soundStart * sr);
    const to = Math.min(n, Math.floor(soundEnd * sr));
    const prevTarget = prev ? targets[i - 1] : targets[i];
    // Whether voicing actually stops either side of this note. Legato means the
    // oscillator never fades — applying the per-note attack/release ramps at a
    // legato boundary would insert the very gap the articulation is defined by
    // NOT having, which collapses `vowel`, `continuant` and `hum` into one thing.
    const CONTIGUOUS_SEC = 1e-3;
    const legatoIn =
      prev !== null &&
      shape.closureSec === 0 &&
      startSec - (prev.onsetSec + prev.durSec) <= CONTIGUOUS_SEC;
    const legatoOut =
      next !== null &&
      shape.closureSec === 0 &&
      next.onsetSec - endSec <= CONTIGUOUS_SEC;

    for (let s = from; s < to; s += 1) {
      const t = (s - from) / sr;
      const tEnd = (to - s) / sr;
      let c = targets[i];

      // Portamento or scoop into the note.
      if (legatoIn && t < shape.glideSec && prevTarget !== targets[i]) {
        const k = t / shape.glideSec;
        c = prevTarget + (targets[i] - prevTarget) * k;
      } else if (!legatoIn && t < 0.07) {
        c = targets[i] - 100 * scoop * (1 - t / 0.07);
      }
      // The pitch dip that marks a legato re-articulation — the Kroher channel's
      // whole target, and the only boundary cue when the pitch does not change.
      if (legatoIn && t < shape.dipHalfSec) {
        c -= shape.pitchDipCents * (1 - t / Math.max(1e-6, shape.dipHalfSec));
      }
      // Vibrato + slow drift across the take.
      c += 8 * Math.sin(2 * Math.PI * 5.5 * (s / sr));
      c += drift * Math.sin((Math.PI * s) / n);
      cents[s] = c;

      let a = 1;
      const attack = shape.closureSec > 0 ? 0.012 : 0.02;
      if (!legatoIn && t < attack) a = t / attack;
      if (!legatoOut && tEnd < 0.04) a = Math.min(a, tEnd / 0.04);
      // Legato boundary dip: down into the boundary, back up out of it.
      if (shape.dipHalfSec > 0) {
        if (legatoOut && soundEnd - (s / sr) < shape.dipHalfSec) {
          const k = (soundEnd - s / sr) / shape.dipHalfSec;
          a = Math.min(a, shape.dipFloor + (1 - shape.dipFloor) * k);
        }
        if (legatoIn && t < shape.dipHalfSec) {
          const k = t / shape.dipHalfSec;
          a = Math.min(a, shape.dipFloor + (1 - shape.dipFloor) * k);
        }
      }
      amp[s] = a;
    }

    // The plosive burst: a few ms of broadband noise at the vowel's start.
    if (shape.burstAmp > 0) {
      const burstFrom = Math.max(0, from - Math.floor(0.004 * sr));
      for (let s = burstFrom; s < Math.min(n, from + Math.floor(0.002 * sr)); s += 1) {
        out[s] += shape.burstAmp * (rng() * 2 - 1) * 0.5;
      }
    }
  }

  // One oscillator over the whole take: phase continuity is what makes a legato
  // boundary sound (and measure) like a re-articulation rather than a new note.
  let phase = 0;
  for (let s = 0; s < n; s += 1) {
    const a = amp[s];
    const f0 = 440 * Math.pow(2, (cents[s] - 6900) / 1200);
    phase += (2 * Math.PI * f0) / sr;
    if (a <= 0) {
      out[s] += (rng() * 2 - 1) * 0.004; // room floor through the closures
      continue;
    }
    let sample = 0;
    for (let h = 1; h <= shape.harmonics; h += 1) {
      const fh = f0 * h;
      if (fh > sr / 2 - 500) break;
      // A hum rolls off far faster than an open vowel — that darkness is the
      // whole acoustic difference, and it is what makes humming hard to track.
      const rolloff = opts.articulation === 'hum' ? 1 / (h * h) : 1 / h;
      const amph = h === 1 ? 1 : rolloff * formantGain(fh);
      sample += amph * Math.sin(h * phase);
    }
    out[s] += a * (sample * 0.3 + (rng() * 2 - 1) * 0.02);
  }

  let peak = 0;
  for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    const scale = gain / peak;
    for (let i = 0; i < n; i += 1) out[i] *= scale;
  }
  return out;
}

export function synthesize(truth: GroundTruth, opts: SynthOptions): Float32Array {
  const sr = opts.sampleRate;
  const gain = opts.gain ?? 0.6;
  const rng = makeRng(opts.seed ?? 1);

  const last = truth.notes[truth.notes.length - 1];
  const totalSec = (last ? last.onsetSec + last.durSec : 0) + 0.2;
  const out = new Float32Array(Math.ceil(totalSec * sr));

  const vibRateHz = opts.kind === 'whistle' ? 5.0 : 5.5;
  const vibDepth = opts.kind === 'whistle' ? 0.004 : 0.008; // fractional f0
  const attack = 0.02;
  const release = opts.kind === 'whistle' ? 0.05 : 0.06;
  // Detach successive notes slightly so onsets are distinguishable.
  const gapSec = 0.04;

  for (const note of truth.notes) {
    const f0 = midiToHz(note.midi);
    const startSample = Math.floor(note.onsetSec * sr);
    const soundDur = Math.max(0.08, note.durSec - gapSec);
    const nSamples = Math.floor(soundDur * sr);

    // Number of harmonics to render (voice = rich, whistle = near-pure).
    const maxHarm = opts.kind === 'whistle' ? 2 : 24;

    let phase = 0;
    for (let i = 0; i < nSamples; i += 1) {
      const t = i / sr;
      const vib = 1 + vibDepth * Math.sin(2 * Math.PI * vibRateHz * t);
      const fInst = f0 * vib;
      phase += (2 * Math.PI * fInst) / sr;

      let sample = 0;
      for (let h = 1; h <= maxHarm; h += 1) {
        const fh = fInst * h;
        if (fh > sr / 2 - 500) break;
        let amp = 1 / h; // sawtooth-ish rolloff
        if (opts.kind === 'whistle') {
          amp = h === 1 ? 1 : 0.06; // almost pure
        } else if (h === 1) {
          // Keep the fundamental prominent — real sung voice carries a strong
          // fundamental; the formant filter must not bury it (an unrealistically
          // thin fundamental was being masked by low-frequency room noise).
          amp = 1;
        } else {
          amp *= formantGain(fh);
        }
        sample += amp * Math.sin(h * phase);
      }

      // Envelope.
      const tEnd = soundDur - t;
      let env = 1;
      if (t < attack) env = t / attack;
      else if (tEnd < release) env = Math.max(0, tEnd / release);

      // Breath / mic noise floor.
      const noise =
        (rng() * 2 - 1) * (opts.kind === 'whistle' ? 0.012 : 0.02);

      const idx = startSample + i;
      if (idx < out.length) out[idx] += env * (sample * 0.3 + noise);
    }
  }

  // Normalize to target peak.
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    const scale = gain / peak;
    for (let i = 0; i < out.length; i += 1) out[i] *= scale;
  }
  return out;
}
