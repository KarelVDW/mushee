import { describe, expect, it } from 'vitest';

import { OnsetDetector } from '../../src/recordings/pipeline/onset-detector';

const SR = 16000;

/**
 * A tone whose amplitude follows `envAt(tSec)`. The detector only ever looks at
 * the RMS envelope, so the carrier is irrelevant and the envelope IS the fixture.
 */
function shaped(seconds: number, envAt: (t: number) => number): Float32Array {
  const out = new Float32Array(Math.floor(seconds * SR));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    out[i] = envAt(t) * Math.sin(2 * Math.PI * 220 * t);
  }
  return out;
}

/** Two notes with a genuine silent gap between them. */
function twoNotesWithGap(gapSec: number): Float32Array {
  const noteSec = 0.4;
  return shaped(noteSec * 2 + gapSec, (t) =>
    t < noteSec || t >= noteSec + gapSec ? 0.5 : 0.0,
  );
}

/**
 * One held note whose envelope merely SAGS briefly — the shape a reverberant
 * room produces when its tail partly fills what would have been a gap. Depth is
 * below the 0.5 dip ratio so the historical detector fires on it.
 */
function saggingHeldNote(sagSec: number): Float32Array {
  const noteSec = 0.4;
  return shaped(noteSec * 2 + sagSec, (t) =>
    t < noteSec || t >= noteSec + sagSec ? 0.5 : 0.1,
  );
}

describe('OnsetDetector', () => {
  it('finds the re-attack after a genuine inter-note gap', () => {
    const onsets = new OnsetDetector().detect(twoNotesWithGap(0.2), SR);
    expect(onsets.length).toBe(1);
    // The gap runs 0.40–0.60 s; the onset is reported at the envelope trough.
    expect(onsets[0]).toBeGreaterThan(0.35);
    expect(onsets[0]).toBeLessThan(0.62);
  });

  it('detectFromEnvelope reproduces detect() exactly', () => {
    const detector = new OnsetDetector();
    const samples = twoNotesWithGap(0.2);
    const hop = Math.round(detector.hopSec * SR);
    expect(
      detector.detectFromEnvelope(detector.envelope(samples, SR), hop, SR),
    ).toEqual(detector.detect(samples, SR));
  });

  it('fires on a brief envelope sag by default — the reverb false positive', () => {
    // Documents the behaviour `minTroughSec` exists to fix: a 40 ms sag inside
    // one held note reads as a re-articulation, and `NoteExtractor.splitAtOnsets`
    // then cuts the note in two.
    expect(new OnsetDetector().detect(saggingHeldNote(0.04), SR).length).toBe(1);
  });

  it('minTroughSec rejects a brief sag but keeps a real gap', () => {
    const guarded = new OnsetDetector({ minTroughSec: 0.12 });
    expect(guarded.detect(saggingHeldNote(0.04), SR)).toEqual([]);
    expect(guarded.detect(twoNotesWithGap(0.2), SR).length).toBe(1);
  });

  it('minTroughSec of 0 is exactly the historical behaviour', () => {
    const samples = saggingHeldNote(0.04);
    expect(new OnsetDetector({ minTroughSec: 0 }).detect(samples, SR)).toEqual(
      new OnsetDetector().detect(samples, SR),
    );
  });

  it('returns nothing for audio shorter than one analysis window', () => {
    expect(new OnsetDetector().detect(new Float32Array(100), SR)).toEqual([]);
    expect(new OnsetDetector().envelope(new Float32Array(100), SR).length).toBe(0);
  });
});
