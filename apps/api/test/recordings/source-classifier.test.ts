import { describe, expect, it } from 'vitest';

import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver';
import {
  decideSource,
  parseClassMap,
  SourceClassifier,
  YAMNET_SAMPLE_RATE,
} from '../../src/recordings/pipeline/profiles/source-classifier';

/**
 * The classifier's decision rule is pure (logits in, verdict out), so it is
 * pinned without the model; one end-to-end case exercises the real YAMNet on
 * the committed weights to guard the loading path and the abstain-on-silence
 * behaviour the resolver's fallback depends on.
 */

/** Build one frame of logits with the named classes set to `logit`. */
function frame(
  classNames: string[],
  hot: Record<string, number>,
): Float32Array {
  // Absent classes at a LOW logit (sigmoid ≈ 0.27) — the abstain band's floor
  // assumptions are about the model's real behaviour, not about zeros.
  const logits = new Float32Array(classNames.length).fill(-1);
  for (const [name, logit] of Object.entries(hot)) {
    const idx = classNames.indexOf(name);
    if (idx < 0) throw new Error(`class not in map: ${name}`);
    logits[idx] = logit;
  }
  return logits;
}

const NAMES = ['Silence', 'Speech', 'Singing', 'Guitar', 'Music', 'Sine wave'];

describe('decideSource', () => {
  it('says voice when a singing class dominates', () => {
    const logits = frame(NAMES, { Singing: 2, Music: 1 });
    expect(decideSource(logits, 1, NAMES.length, NAMES)).toBe('voice');
  });

  it('says instrument when an instrument class dominates', () => {
    const logits = frame(NAMES, { Guitar: 2, Music: 2.5 });
    expect(decideSource(logits, 1, NAMES.length, NAMES)).toBe('instrument');
  });

  it('abstains when nothing rises above the floor (silence / not started)', () => {
    const logits = frame(NAMES, { Silence: 3 });
    expect(decideSource(logits, 1, NAMES.length, NAMES)).toBeUndefined();
  });

  it('abstains when the two groups are within noise of each other', () => {
    const logits = frame(NAMES, { Singing: 1.0, Guitar: 1.001 });
    expect(decideSource(logits, 1, NAMES.length, NAMES)).toBeUndefined();
  });

  it('averages over frames rather than trusting one', () => {
    const a = frame(NAMES, { Singing: 3 });
    const b = frame(NAMES, { Singing: 2.5 });
    const c = frame(NAMES, { Guitar: 0.5 });
    const all = new Float32Array(NAMES.length * 3);
    all.set(a, 0);
    all.set(b, NAMES.length);
    all.set(c, NAMES.length * 2);
    expect(decideSource(all, 3, NAMES.length, NAMES)).toBe('voice');
  });
});

describe('parseClassMap', () => {
  it('handles quoted display names containing commas', () => {
    const csv =
      'index,mid,display_name\n0,/m/09x0r,Speech\n1,/m/0ytgt,"Child speech, kid speaking"\n2,/m/07y_7,"Violin, fiddle"\n';
    expect(parseClassMap(csv)).toEqual([
      'Speech',
      'Child speech, kid speaking',
      'Violin, fiddle',
    ]);
  });
});

describe('ProfileResolver source attribution', () => {
  it('records which evidence decided isVoice, and falls back to the prior on abstain', async () => {
    // Silence: the classifier abstains (nothing rises above its floor), so the
    // decision must fall through to the score-instrument prior — and say so.
    await new SourceClassifier().ready();
    const resolver = new ProfileResolver();
    const silence = new Float32Array(YAMNET_SAMPLE_RATE * 1.5);

    // Silence resolves to the no-pitch basic-pitch fallback, where the voice
    // ROUTING overlay never applies — the BELIEF must still be recorded, which
    // is exactly the distinction sourceBelief exists for.
    const explicit = resolver.resolve(silence, YAMNET_SAMPLE_RATE, {
      instrumentId: 'piano',
      sourceKind: 'voice',
    });
    expect(explicit.sourceDecidedBy).toBe('explicit');
    expect(explicit.sourceBelief).toBe('voice');

    const prior = resolver.resolve(silence, YAMNET_SAMPLE_RATE, {
      instrumentId: 'voice-lead',
    });
    expect(prior.sourceDecidedBy).toBe('prior');
    expect(prior.sourceBelief).toBe('voice');

    const priorInstrument = resolver.resolve(silence, YAMNET_SAMPLE_RATE, {
      instrumentId: 'piano',
    });
    expect(priorInstrument.sourceDecidedBy).toBe('prior');
    expect(priorInstrument.sourceBelief).toBe('instrument');
  });
});

describe('SourceClassifier (real model, committed weights)', () => {
  it('abstains on silence and on too-short/wrong-rate input', async () => {
    const classifier = new SourceClassifier();
    await classifier.ready();
    const silence = new Float32Array(YAMNET_SAMPLE_RATE * 1.5);
    expect(classifier.classify(silence, YAMNET_SAMPLE_RATE)).toBeUndefined();
    // Too short for one YAMNet frame.
    expect(
      classifier.classify(new Float32Array(1000), YAMNET_SAMPLE_RATE),
    ).toBeUndefined();
    // Not the detect rate — classification only runs on the 16 kHz prefix.
    expect(classifier.classify(silence, 44100)).toBeUndefined();
  });
});
