import { describe, expect, it } from 'vitest';

import { PitchTrack } from '../../src/recordings/pipeline/pitch-track';
import { VoiceNoteDecoder } from '../../src/recordings/pipeline/voice-note-decoder';

/**
 * The decoder reads only a frame-level contour, so the contour IS the fixture —
 * no audio, no model. These tests pin the *behaviours the corpus bought*, not the
 * tuned constants: a sweep can move `changeCost` and should not break a test, but
 * a change that lets vibrato shatter a held note must.
 */

const HOP = 0.02;

interface NoteSpec {
  /** MIDI pitch, or null for a silent gap. */
  midi: number | null;
  sec: number;
  /** Peak-to-peak vibrato width in cents (sinusoidal at 5.5 Hz). */
  vibratoCents?: number;
  /** Semitones below the target the note scoops from, over its first 60 ms. */
  scoopSemitones?: number;
}

/**
 * Build a `PitchTrack` (and matching envelope) from a note list. Unvoiced frames
 * get zero confidence, which is what the voicing gate keys on.
 */
function contour(spec: NoteSpec[]): { track: PitchTrack; energy: Float32Array } {
  const cents: number[] = [];
  const conf: number[] = [];
  const energy: number[] = [];
  for (const n of spec) {
    const frames = Math.round(n.sec / HOP);
    for (let i = 0; i < frames; i += 1) {
      if (n.midi === null) {
        cents.push(0);
        conf.push(0);
        energy.push(0.001);
        continue;
      }
      const t = i * HOP;
      const vib = n.vibratoCents
        ? (n.vibratoCents / 2) * Math.sin(2 * Math.PI * 5.5 * t)
        : 0;
      const scoopFrames = Math.round(0.06 / HOP);
      const scoop =
        n.scoopSemitones && i < scoopFrames
          ? -100 * n.scoopSemitones * (1 - i / scoopFrames)
          : 0;
      cents.push(n.midi * 100 + vib + scoop);
      conf.push(0.9);
      energy.push(0.2);
    }
  }
  return {
    track: new PitchTrack(
      Float32Array.from(cents),
      Float32Array.from(conf),
      cents.length,
      HOP,
    ),
    energy: Float32Array.from(energy),
  };
}

/** The shipping configuration (mirrors `CrepeProvider`'s `VOICE_OPTS`). */
function decoder(over = {}): VoiceNoteDecoder {
  return new VoiceNoteDecoder({
    transitionMode: 'direct',
    changeCost: 2.5,
    evidenceDiscount: 0.35,
    trust: 0.7,
    confidenceThreshold: 0.5,
    minFreqHz: 55,
    maxFreqHz: 1100,
    ...over,
  });
}

describe('VoiceNoteDecoder', () => {
  it('writes one note for a held pitch, not a chain of fragments', () => {
    const { track, energy } = contour([{ midi: 60, sec: 1.2 }]);
    const notes = decoder().decode(track, energy);
    expect(notes).toHaveLength(1);
    expect(notes[0].pitchMidi).toBe(60);
  });

  it('does not shatter a note whose vibrato crosses the semitone boundary', () => {
    // ±60 cents about C4 — the failure mode that made studio singing score 0.45:
    // a semitone-rounding segmenter flips between 59 and 60 for the whole note.
    const { track, energy } = contour([{ midi: 60, sec: 1.5, vibratoCents: 120 }]);
    const notes = decoder().decode(track, energy);
    expect(notes).toHaveLength(1);
    expect(notes[0].pitchMidi).toBe(60);
  });

  it('separates two different pitches sung back to back', () => {
    const { track, energy } = contour([
      { midi: 60, sec: 0.6 },
      { midi: 64, sec: 0.6 },
    ]);
    const notes = decoder().decode(track, energy);
    expect(notes.map((n) => n.pitchMidi)).toEqual([60, 64]);
  });

  it('absorbs a scoop into the note it belongs to', () => {
    // A singer arriving at C4 from two semitones below over 60 ms. Without the
    // wide attack state this is written as a passing A#3/B3 before the real note.
    const { track, energy } = contour([
      { midi: 60, sec: 0.8, scoopSemitones: 2 },
    ]);
    const notes = decoder().decode(track, energy);
    expect(notes).toHaveLength(1);
    expect(notes[0].pitchMidi).toBe(60);
  });

  it('reports the onset where the pitch arrives, not where the glide starts', () => {
    // The attack state is entered as the contour DEPARTS the previous note; the
    // reported onset must be calibrated forward from there, or every note in the
    // take lands ~50 ms early (worth 0.15 COnP on the corpus).
    const { track, energy } = contour([
      { midi: 60, sec: 0.6 },
      { midi: 67, sec: 0.6 },
    ]);
    const notes = decoder().decode(track, energy);
    expect(notes).toHaveLength(2);
    expect(notes[1].startTimeSeconds).toBeGreaterThan(0.55);
    expect(notes[1].startTimeSeconds).toBeLessThan(0.72);
  });

  it('takes a note’s pitch from a trimmed mean, so a scoop cannot drag it flat', () => {
    // Plain-mean pitch over this contour sits low enough to round to 59.
    const { track, energy } = contour([
      { midi: 60, sec: 0.5, scoopSemitones: 3 },
    ]);
    expect(decoder().decode(track, energy)[0].pitchMidi).toBe(60);
  });

  it('emits nothing for a wholly unvoiced take', () => {
    const { track, energy } = contour([{ midi: null, sec: 1 }]);
    expect(decoder().decode(track, energy)).toEqual([]);
  });

  it('ignores pitch outside the resolved register window', () => {
    // Out-of-band frames are not evidence of a note — the window is the pipeline's
    // main adaptive lever and the decoder must honour it, not just the gate.
    const { track, energy } = contour([{ midi: 60, sec: 1 }]);
    const notes = decoder({ minFreqHz: 400, maxFreqHz: 1100 }).decode(track, energy);
    expect(notes).toEqual([]);
  });

  it('rejoins a semitone wobble under the SiPTH guard but keeps a held step', () => {
    const guard = { deltaSemitones: 0.5, gammaSemitoneSec: 0.1 };
    // A brief, low-cost excursion to the neighbour: not enough accumulated area.
    const wobble = contour([
      { midi: 60, sec: 0.5 },
      { midi: 61, sec: 0.08 },
      { midi: 60, sec: 0.5 },
    ]);
    const rejoined = decoder({ mergeGuard: guard }).decode(
      wobble.track,
      wobble.energy,
    );
    expect(rejoined.map((n) => n.pitchMidi)).toEqual([60]);

    // The same interval, genuinely held: area accumulates and the split survives.
    const held = contour([
      { midi: 60, sec: 0.5 },
      { midi: 61, sec: 0.5 },
    ]);
    const kept = decoder({ mergeGuard: guard }).decode(held.track, held.energy);
    expect(kept.map((n) => n.pitchMidi)).toEqual([60, 61]);
  });
});
