/**
 * The voice flow's experiment harness — the counterpart to `sweep-segmenter.ts`,
 * specialised for the one input the pipeline is worst at.
 *
 * Two things it does that the general sweep does not, both needed to make the
 * voice experiments legible:
 *
 *  - **It scores two slices at once.** The VOICE slice is what a change is trying
 *    to improve; the GUARD slice (every monophonic instrument corpus) is what it
 *    must not break. A voice decode is a profile-gated change, so a guard
 *    regression is not automatically fatal — but it has to be *visible*, and in the
 *    general sweep a 16-dataset mean hides it.
 *  - **It reports where the loss is, not just how big.** COn (onset-only) beside
 *    COnP separates "the boundary is wrong" from "the pitch written on it is
 *    wrong"; `segErrors` says split vs merged vs missed; `onsetClasses` says
 *    re-onset vs transition recall — the metric that tells whether a new boundary
 *    channel actually found the same-pitch repeats it was built for.
 *
 * Everything runs off `TrackCache`, so a full sweep is seconds.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/sweep-voice.ts
 * Env: EVAL_SPLIT=dev|test|all   (default dev — tune here, confirm on test once)
 *      VOICE_EXP=<group,...>     which experiment groups to run (default base,e1)
 *      VOICE_ONLY=substr         run only configs whose name contains substr
 *      VOICE_GUARD=0             skip the instrument guard slice (faster iteration)
 *
 * Experiment groups, in the order they were run — the sequence matters, because
 * several later nulls are nulls only because an earlier group removed the failure
 * they targeted (see the 2026-08 findings log in `README.md`):
 *
 *   base  the shipping segmenter, and the decoder at pYIN's own defaults
 *   e1a   onset placement            → the single largest effect (+0.15). Do this first.
 *   e1    transition structure × change cost × trust, ± the shipping cleanup
 *   e1b   cost/trust refinement      → shows the decode saturates into mandatory-silence
 *   e1c   the remaining decode knobs, one family at a time
 *   e2    octave prior at voicing onsets                              (null)
 *   e3    SiPTH sustained-deviation merge guard                       (null)
 *   e4    boundary-evidence channels (volume decay + pitch dip)       (+0.005, ships)
 *   e4b   evidence-gated DIRECT transitions                           (ships)
 *   e4c   in-decode re-onset transition + Ryynänen accent             (null)
 *   e5    low-false-alarm voicing sweep                               (null)
 *   e6    pitch measured over the arrived part of the note only       (null)
 *   e7    a second, cheaper price for wide intervals                  (null, informative)
 *   e8    Hann-weighted-median vs α-trimmed-mean note pitch           (null)
 *   r15   WaoN joint duration × velocity note filters (plugin pass task 2)
 *   r19   block-level voiced-fraction quorum on the gate (plugin pass task 3)
 *   r21   fill 1–2-frame unvoiced dropouts on the track (plugin pass task 4)
 *   r7    re-attack detector report delay, both consumers (plugin pass task 5)
 *   r9    pYIN multi-candidate emission + octave tie-break (plugin pass E3)
 *   best  the candidate, with its cleanup and onset constant re-checked
 *   ship  the exact shipping configuration × cleanup variants
 *   all   every group
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder';
import { NoteExtractor, type NoteExtractorOptions } from '../../src/recordings/pipeline/note-extractor';
import { OnsetDetector, type OnsetDetectorOptions } from '../../src/recordings/pipeline/onset-detector';
import { estimateReverberance } from '../../src/recordings/pipeline/profiles/profile-resolver';
import { segmentNotes } from '../../src/recordings/pipeline/providers/pitch-decoder';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import {
  type VoiceDecodeOptions,
  VoiceNoteDecoder,
} from '../../src/recordings/pipeline/voice-note-decoder';
import { type EstNote, scoreNotesBest, scoreOnsets } from './lib/metrics';
import {
  addOnsetClassStats,
  emptyOnsetClassStats,
  formatOnsetClasses,
  type OnsetClassStats,
  onsetRecallByClass,
} from './lib/onsetClasses';
import { discoverRealDatasets, listRealClips } from './lib/realCorpus';
import {
  formatSegErrors,
  type SegErrorCounts,
  segErrors,
} from './lib/segErrors';
import { ensureFluxCache, loadFlux, splitAtSpectralPeaks } from './lib/spectralFlux';
import { inSplit, splitFromEnv } from './lib/split';
import { formatComparison, pairedDiffCI } from './lib/stats';
import { type CachedClip, TrackCache } from './lib/trackCache';

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const CACHE_ROOT = resolve(__dirname, '../fixtures/eval-cache');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

/**
 * The E1 optimum, and the base every later experiment is measured on top of.
 *
 * `via-silence` rather than a large `changeCost` because the sweep showed the two
 * are the *same decode*: at changeCost ≥ 2.5 the direct note→note jump is never
 * taken (c2.5/c3/c4/c6 score identically to three decimals), so the model has
 * already chosen mandatory-silence on its own. Saying so structurally is honest
 * about what it does and removes a knob.
 */
const BEST: VoiceDecodeOptions = {
  transitionMode: 'direct',
  changeCost: 2.5,
  evidenceDiscount: 0.35,
  trust: 0.7,
};

/** The cleanup the trajectory path ships with (see `AudioConverter.cleanupFor`). */
const SHIPPED_CLEANUP: NoteExtractorOptions = {
  maxGridDivisor: 4,
  steps: { pitchOutliers: false, merge: false },
  adaptiveFloorFraction: 0.3,
};

/**
 * The VOICE cleanup as production ships it (`AudioConverter.cleanupFor`,
 * `isVoice` branch): onsetSplit + adaptive floor + the widened syllabic
 * seam-fill. The seam-fill only extends durations toward the next onset, so
 * COnP (onset+pitch, no offset gate) must not move — the `ship seam-fill`
 * config exists to keep that claim measured rather than assumed.
 */
const VOICE_SHIPPED_CLEANUP: NoteExtractorOptions = {
  maxGridDivisor: 4,
  adaptiveFloorFraction: 0.3,
  seamFillBeats: 0.6,
  steps: {
    pitchOutliers: false, merge: false, transients: false, monophonic: false,
  },
};

interface Config {
  name: string;
  group: string;
  /**
   * Re-detect the re-attack onsets from the cached envelope at these settings
   * instead of using the ones the cache stored at the shipping defaults. Only
   * meaningful together with a cleanup that runs `onsetSplit`.
   */
  onsets?: OnsetDetectorOptions;
  /** Notes straight from the decoder, before any `NoteExtractor` cleanup. */
  segment: (c: CachedClip) => NoteEventLike[];
  /** Cleanup to run after segmentation; omit for none. */
  cleanup?: NoteExtractorOptions | null;
  /**
   * Post-cleanup pass over the final notes (e.g. the spectral-flux re-onset
   * splitter). When any active config sets `needsFlux`, the main loop runs the
   * async ODF pre-pass over the voice clips so this stays synchronous.
   */
  post?: (notes: NoteEventLike[], c: CachedClip) => NoteEventLike[];
  needsFlux?: boolean;
  /**
   * Run the per-clip production reverberance estimate (an ffmpeg decode, no
   * model) before the config loop, into `clipReverberance` — for configs that
   * gate a mechanism on the room the way `ProfileResolver` would.
   */
  needsReverberance?: boolean;
}

/** `${dataset}/${clip}` → `estimateReverberance` over the take, as production sees it. */
const clipReverberance = new Map<string, number>();

interface NoteEventLike {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
}

function toEst(notes: NoteEventLike[]): EstNote[] {
  return notes.map((n) => ({
    onsetSec: n.startTimeSeconds,
    durSec: n.durationSeconds,
    midi: n.pitchMidi,
  }));
}

/** The shipping semitone-run segmenter, driven off a cached track. */
function shippedSegment(c: CachedClip): NoteEventLike[] {
  return segmentNotes(c.track.cents, c.track.confidence, c.track.frames, {
    hopSize: 1,
    sampleRate: 1 / c.track.hopSec,
    confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
    minFreqHz: c.profile.minFreqHz,
    maxFreqHz: c.profile.maxFreqHz,
    minFramesPerNote: c.profile.minFramesPerNote ?? 4,
    pitchBinToleranceCents: 50,
    mode: 'semitone',
    smoothFrames: 4,
  });
}

/**
 * Median voiced pitch of the clip, in cents — the stand-in here for the session
 * register the production resolver measures with `PitchScan`. Using the clip's own
 * contour is not cheating for the octave prior: the prior only needs to know which
 * octave the singer is in, and both estimates agree on that whenever the pitch scan
 * is doing its job.
 */
function registerCentsOf(c: CachedClip): number {
  const conf = c.profile.confidenceThreshold ?? 0.5;
  const vals: number[] = [];
  for (let i = 0; i < c.track.frames; i += 1) {
    if (c.track.confidence[i] >= conf) vals.push(c.track.cents[i]);
  }
  if (!vals.length) return 6000;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

function voiceSegment(over: VoiceDecodeOptions, useRegister = false) {
  return (c: CachedClip): NoteEventLike[] =>
    new VoiceNoteDecoder({
      confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
      minFreqHz: c.profile.minFreqHz,
      maxFreqHz: c.profile.maxFreqHz,
      minNoteSec: (c.profile.minFramesPerNote ?? 4) * c.track.hopSec,
      ...(useRegister && { registerCents: registerCentsOf(c) }),
      ...over,
    }).decode(c.track, c.energy);
}

// --- experiment catalogue ----------------------------------------------------

function buildConfigs(groups: Set<string>): Config[] {
  const all = groups.has('all');
  const on = (g: string): boolean => all || groups.has(g);
  const configs: Config[] = [];

  // Always present: the thing every experiment is measured against.
  configs.push({
    name: 'SHIPPED',
    group: 'base',
    segment: shippedSegment,
    cleanup: SHIPPED_CLEANUP,
  });

  if (on('base')) {
    configs.push({
      name: 'shipped no-clean',
      group: 'base',
      segment: shippedSegment,
      cleanup: null,
    });
    // The voice decoder at pYIN's own defaults, direct transitions — the closest
    // thing to `note-segmenter.ts` and therefore the anchor for whether the new
    // machinery (evidence, guard, trimmed pitch) is what moves anything.
    configs.push({
      name: 'voice plain',
      group: 'base',
      segment: voiceSegment({ changeCost: 1.2, trust: 0.1 }),
      cleanup: null,
    });
  }

  // E1a — onset placement. The decode enters `attack` during the scoop, so where
  // the run is said to start is worth ~50 ms of systematic error on its own; fix
  // this before reading anything else, or every other knob is measured through it.
  if (on('e1a')) {
    for (const onsetAt of ['attack', 'mid', 'stable', 'arrival'] as const) {
      configs.push({
        name: `e1a onset=${onsetAt}`,
        group: 'e1a',
        segment: voiceSegment({ ...BEST, onsetAt }),
        cleanup: null,
      });
    }
    for (const cents of [25, 50, 80]) {
      for (const shift of [0, 0.02]) {
        configs.push({
          name: `e1a arrival ${cents}c +${shift * 1000}ms`,
          group: 'e1a',
          segment: voiceSegment({
            ...BEST, onsetAt: 'arrival', arrivalCents: cents, onsetShiftSec: shift,
          }),
          cleanup: null,
        });
      }
    }
    for (const shift of [0.04, 0.05, 0.06, 0.07, 0.08, 0.1]) {
      configs.push({
        name: `e1a attack+${shift * 1000}ms`,
        group: 'e1a',
        segment: voiceSegment({
          ...BEST, onsetAt: 'attack', onsetShiftSec: shift,
        }),
        cleanup: null,
      });
    }
    for (const shift of [-0.02, 0, 0.02, 0.04]) {
      configs.push({
        name: `e1a stable${shift >= 0 ? '+' : ''}${shift * 1000}ms`,
        group: 'e1a',
        segment: voiceSegment({
          ...BEST, onsetAt: 'stable', onsetShiftSec: shift,
        }),
        cleanup: null,
      });
    }
    // Is the shift a property of singing, or of one corpus's annotation habit?
    // The shipping segmenter under the same shift answers that: if it also wants
    // +60 ms, the corpus is late and the decoder is innocent.
    for (const shift of [0.04, 0.06]) {
      configs.push({
        name: `e1a SHIPPED+${shift * 1000}ms`,
        group: 'e1a',
        segment: (c) => shippedSegment(c).map((n) => ({
          ...n,
          startTimeSeconds: n.startTimeSeconds + shift,
          durationSeconds: Math.max(0.02, n.durationSeconds - shift),
        })),
        cleanup: SHIPPED_CLEANUP,
      });
    }
  }

  // E1 — the decode itself: transition structure × change cost × trust, on top of
  // the corrected onset placement, with and without the shipping cleanup (whose
  // `splitAtOnsets` is the only re-onset channel the decode does not have).
  if (on('e1')) {
    for (const changeCost of [0.8, 1.2, 2, 3]) {
      for (const trust of [0.3, 1, 3]) {
        configs.push({
          name: `e1 direct c${changeCost} t${trust}`,
          group: 'e1',
          segment: voiceSegment({ changeCost, trust }),
          cleanup: null,
        });
        configs.push({
          name: `e1 direct c${changeCost} t${trust} +cl`,
          group: 'e1',
          segment: voiceSegment({ changeCost, trust }),
          cleanup: SHIPPED_CLEANUP,
        });
      }
    }
    for (const onCost of [0.2, 0.5, 1.5]) {
      for (const trust of [0.3, 1, 3]) {
        configs.push({
          name: `e1 viaSil on${onCost} t${trust} +cl`,
          group: 'e1',
          segment: voiceSegment({ transitionMode: 'via-silence', onCost, trust }),
          cleanup: SHIPPED_CLEANUP,
        });
      }
    }
  }

  // E1b — refinement around the E1 optimum, one family of knobs at a time.
  if (on('e1b')) {
    for (const changeCost of [1.5, 2, 2.5, 3, 4, 6]) {
      for (const trust of [0.3, 0.5, 0.7, 1, 1.5]) {
        configs.push({
          name: `e1b c${changeCost} t${trust}`,
          group: 'e1b',
          segment: voiceSegment({ changeCost, trust }),
          cleanup: null,
        });
      }
    }
  }
  // E1c — the remaining decode knobs at the E1b optimum, plus a re-check that the
  // onset constant did not move once the cost structure changed.
  if (on('e1c')) {
    for (const shift of [0.05, 0.06, 0.07, 0.08, 0.09]) {
      configs.push({
        name: `e1c shift${shift * 1000}ms`,
        group: 'e1c',
        segment: voiceSegment({ ...BEST, onsetShiftSec: shift }),
        cleanup: null,
      });
    }
    // 60–120 ms = 3–6 frames at the trajectory's 20 ms hop.
    for (const minNoteSec of [0.06, 0.08, 0.1, 0.12]) {
      configs.push({
        name: `e1c minNote${minNoteSec * 1000}ms`,
        group: 'e1c',
        segment: voiceSegment({ ...BEST, minNoteSec }),
        cleanup: null,
      });
    }
    for (const sigmaStableSemitones of [0.6, 0.9, 1.3]) {
      configs.push({
        name: `e1c sigStable${sigmaStableSemitones}`,
        group: 'e1c',
        segment: voiceSegment({ ...BEST, sigmaStableSemitones }),
        cleanup: null,
      });
    }
    // Per 10 ms (0.075/0.175/0.35 ≡ the old per-frame 0.15/0.35/0.7 at 20 ms hop).
    for (const attackFrameCost of [0.075, 0.175, 0.35]) {
      configs.push({
        name: `e1c attackFrame${attackFrameCost}`,
        group: 'e1c',
        segment: voiceSegment({ ...BEST, attackFrameCost }),
        cleanup: null,
      });
    }
    for (const unvoicedPitchCost of [0.8, 1.5, 3]) {
      configs.push({
        name: `e1c unvoiced${unvoicedPitchCost}`,
        group: 'e1c',
        segment: voiceSegment({ ...BEST, unvoicedPitchCost }),
        cleanup: null,
      });
    }
    for (const stepsPerSemitone of [1, 2, 3, 5]) {
      configs.push({
        name: `e1c steps${stepsPerSemitone}`,
        group: 'e1c',
        segment: voiceSegment({ ...BEST, stepsPerSemitone }),
        cleanup: null,
      });
    }
    for (const pitchTrim of [0, 0.15, 0.3, 0.45]) {
      configs.push({
        name: `e1c trim${pitchTrim}`,
        group: 'e1c',
        segment: voiceSegment({ ...BEST, pitchTrim }),
        cleanup: null,
      });
    }
  }

  // E2 — octave prior at voicing onsets, seeded from the register estimate.
  if (on('e2')) {
    for (const w of [0.5, 2, 8]) {
      configs.push({
        name: `e2 octPrior w${w}`,
        group: 'e2',
        segment: voiceSegment({ ...BEST, octavePriorWeight: w }, true),
        cleanup: null,
      });
    }
  }

  // E3 — SiPTH sustained-deviation merge guard, on top of the E1 winner shape.
  if (on('e3')) {
    for (const gamma of [0.05, 0.1, 0.2]) {
      for (const delta of [0.3, 0.5]) {
        configs.push({
          name: `e3 guard d${delta} g${gamma}`,
          group: 'e3',
          segment: voiceSegment({
            ...BEST,
            mergeGuard: { deltaSemitones: delta, gammaSemitoneSec: gamma },
          }),
          cleanup: null,
        });
      }
    }
    // The same guard bolted onto the SHIPPING segmenter, to separate "the guard
    // works" from "the HMM works".
    for (const gamma of [0.1, 0.2]) {
      configs.push({
        name: `e3 shipped+guard g${gamma}`,
        group: 'e3',
        segment: (c) =>
          new VoiceNoteDecoder({
            confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
            minFreqHz: c.profile.minFreqHz,
            maxFreqHz: c.profile.maxFreqHz,
            mergeGuard: { gammaSemitoneSec: gamma },
          }).guardOnly(shippedSegment(c), c.track),
        cleanup: SHIPPED_CLEANUP,
      });
    }
  }

  // E4 — boundary-evidence channels (volume decay + pitch dip) discounting
  // boundary cost inside the decode.
  if (on('e4')) {
    for (const discount of [0.5, 0.2]) {
      for (const dipDb of [-4, -6, -10]) {
        configs.push({
          name: `e4 ev${discount} dip${dipDb}dB`,
          group: 'e4',
          segment: voiceSegment({
            ...BEST,
            evidenceDiscount: discount,
            energyDipDb: dipDb,
          }),
          cleanup: null,
        });
      }
    }
    // Pitch-dip channel alone (energy channel neutralised by an unreachable dB).
    for (const z of [-1.5, -2, -3]) {
      configs.push({
        name: `e4 pitchOnly z${z}`,
        group: 'e4',
        segment: voiceSegment({
          ...BEST,
          evidenceDiscount: 0.2,
          energyDipDb: -200,
          pitchDipZ: z,
        }),
        cleanup: null,
      });
    }
  }

  // E4b — the §3 mechanism proper: keep the DIRECT note→note transition, but price
  // it so it is only affordable where a boundary channel argues for one. Under
  // via-silence a legato slur cannot be written at all (measured: transition recall
  // 0.66 vs the shipping segmenter's 0.75), so this is the shape that could
  // recover slurs without re-admitting vibrato splits.
  if (on('e4b')) {
    for (const changeCost of [1.2, 1.5, 2, 2.5]) {
      for (const evidenceDiscount of [0.2, 0.35, 0.5]) {
        configs.push({
          name: `e4b c${changeCost} ev${evidenceDiscount}`,
          group: 'e4b',
          segment: voiceSegment({
            transitionMode: 'direct',
            trust: 0.7,
            changeCost,
            evidenceDiscount,
          }),
          cleanup: null,
        });
      }
    }
  }

  // E4c — the re-onset transition: stable(p) → attack(p), priced against the
  // evidence channels. This is the boundary the decode structurally cannot see
  // otherwise, and the reason `splitAtOnsets` has to exist downstream at all.
  if (on('e4c')) {
    const SPLIT_ONLY: NoteExtractorOptions = {
      maxGridDivisor: 4,
      steps: {
        pitchOutliers: false, merge: false, transients: false, monophonic: false,
      },
    };
    for (const reonsetCost of [1, 2, 3]) {
      for (const accentBonus of [0.5, 1, 2, 4]) {
        configs.push({
          name: `e4c r${reonsetCost} acc${accentBonus}`,
          group: 'e4c',
          segment: voiceSegment({ ...BEST, reonsetCost, accentBonus }),
          cleanup: null,
        });
        configs.push({
          name: `e4c r${reonsetCost} acc${accentBonus} +sp`,
          group: 'e4c',
          segment: voiceSegment({ ...BEST, reonsetCost, accentBonus }),
          cleanup: SPLIT_ONLY,
        });
      }
    }
  }

  // E5 — low-false-alarm voicing sweep, on the shipping decode and the voice one.
  if (on('e5')) {
    for (const conf of [0.35, 0.5, 0.65]) {
      configs.push({
        name: `e5 shipped conf${conf}`,
        group: 'e5',
        segment: (c) =>
          segmentNotes(c.track.cents, c.track.confidence, c.track.frames, {
            hopSize: 1,
            sampleRate: 1 / c.track.hopSec,
            confidenceThreshold: conf,
            minFreqHz: c.profile.minFreqHz,
            maxFreqHz: c.profile.maxFreqHz,
            minFramesPerNote: c.profile.minFramesPerNote ?? 4,
            pitchBinToleranceCents: 50,
            mode: 'semitone',
            smoothFrames: 4,
          }),
        cleanup: SHIPPED_CLEANUP,
      });
      configs.push({
        name: `e5 voice conf${conf}`,
        group: 'e5',
        segment: voiceSegment({ ...BEST, confidenceThreshold: conf }),
        cleanup: null,
      });
    }
  }

  // The shipping candidate, plus the three questions still open about it: does the
  // existing cleanup earn its place on top, is the onset constant still right at
  // this cost structure, and does the re-onset channel (`splitAtOnsets`) recover
  // the same-pitch repeats the decode structurally cannot see.
  if (on('best')) {
    configs.push({
      name: 'BEST',
      group: 'best',
      segment: voiceSegment(BEST),
      cleanup: null,
    });
    configs.push({
      name: 'BEST +cleanup',
      group: 'best',
      segment: voiceSegment(BEST),
      cleanup: SHIPPED_CLEANUP,
    });
    configs.push({
      name: 'BEST +onsetSplit only',
      group: 'best',
      segment: voiceSegment(BEST),
      cleanup: {
        maxGridDivisor: 4,
        steps: {
          pitchOutliers: false, merge: false, transients: false, monophonic: false,
        },
      },
    });
    configs.push({
      name: 'BEST +split+transients',
      group: 'best',
      segment: voiceSegment(BEST),
      cleanup: {
        maxGridDivisor: 4,
        steps: { pitchOutliers: false, merge: false, monophonic: false },
      },
    });
    for (const trust of [0.5, 0.7, 1]) {
      for (const shift of [0.06, 0.07, 0.08]) {
        configs.push({
          name: `best t${trust} s${shift * 1000}`,
          group: 'best',
          segment: voiceSegment({ ...BEST, trust, onsetShiftSec: shift }),
          cleanup: null,
        });
      }
    }
  }

  // SHIP — the exact candidate, and the last open question about it: which of the
  // downstream cleanup steps still earn their place now that the decode does the
  // work they were compensating for.
  if (on('ship')) {
    const variants: Array<[string, NoteExtractorOptions | null]> = [
      ['none', null],
      ['split', {
        maxGridDivisor: 4,
        steps: {
          pitchOutliers: false, merge: false, transients: false, monophonic: false,
        },
      }],
      ['split+trans', {
        maxGridDivisor: 4,
        steps: { pitchOutliers: false, merge: false, monophonic: false },
      }],
      ['split+floor', {
        maxGridDivisor: 4,
        adaptiveFloorFraction: 0.3,
        steps: {
          pitchOutliers: false, merge: false, transients: false, monophonic: false,
        },
      }],
      ['shipped-cleanup', SHIPPED_CLEANUP],
      ['voice-shipped', VOICE_SHIPPED_CLEANUP],
    ];
    for (const [label, cleanup] of variants) {
      configs.push({
        name: `ship ${label}`,
        group: 'ship',
        segment: voiceSegment(BEST),
        cleanup,
      });
    }
  }

  // E6 — the residual PITCH error, which is now the largest single bucket
  // (pWrong 15/100, and octave errors are 0.001 so it is all semitone-level).
  // The suspect is the scoop: a note's contour is averaged from the run's first
  // frame, which is travel toward the pitch rather than the pitch.
  if (on('e6')) {
    for (const pitchWindow of ['run', 'onset'] as const) {
      for (const pitchTrim of [0.2, 0.3, 0.4]) {
        configs.push({
          name: `e6 ${pitchWindow} trim${pitchTrim}`,
          group: 'e6',
          segment: voiceSegment({ ...BEST, pitchWindow, pitchTrim }),
          cleanup: {
            maxGridDivisor: 4,
            steps: {
              pitchOutliers: false, merge: false, transients: false, monophonic: false,
            },
          },
        });
      }
    }
  }

  // E8 — the pitch estimator. `pWrong` (15/100) is the largest remaining bucket
  // and is NOT octave error (octErr 0.001), so it is semitone-level naming. Yong,
  // Su & Nam's Hann-weighted median is the literature's other answer to the same
  // "boundaries are the expressive part" problem that trimming addresses.
  if (on('e8')) {
    const SPLIT: NoteExtractorOptions = {
      maxGridDivisor: 4,
      steps: {
        pitchOutliers: false, merge: false, transients: false, monophonic: false,
      },
    };
    configs.push({
      name: 'e8 trimmed 0.3 (ships)',
      group: 'e8',
      segment: voiceSegment({ ...BEST }),
      cleanup: SPLIT,
    });
    configs.push({
      name: 'e8 hann-median',
      group: 'e8',
      segment: voiceSegment({ ...BEST, pitchEstimator: 'hann-median' }),
      cleanup: SPLIT,
    });
    for (const pitchTrim of [0.35, 0.4, 0.45]) {
      configs.push({
        name: `e8 trimmed ${pitchTrim}`,
        group: 'e8',
        segment: voiceSegment({ ...BEST, pitchTrim }),
        cleanup: SPLIT,
      });
    }
  }

  // E7 — a second, cheaper price for WIDE intervals. Transition recall is the
  // decode's remaining weak spot (0.65 vs the shipping segmenter's 0.80): one
  // change cost has to price both "semitone wobble, almost certainly vibrato" and
  // "a fourth, almost certainly a real slurred leap", and the cost that protects
  // held notes forbids the leap.
  if (on('e7')) {
    for (const wideIntervalSemitones of [2, 3, 5]) {
      for (const wideChangeCost of [0.6, 1, 1.5]) {
        configs.push({
          name: `e7 wide>=${wideIntervalSemitones} c${wideChangeCost}`,
          group: 'e7',
          segment: voiceSegment({ ...BEST, wideIntervalSemitones, wideChangeCost }),
          cleanup: {
            maxGridDivisor: 4,
            steps: {
              pitchOutliers: false, merge: false, transients: false, monophonic: false,
            },
          },
        });
      }
    }
  }

  // E9 — re-onsets, the one axis the voice decode made WORSE (pooled recall
  // 0.501 → 0.471) and the most user-visible: someone singing "la-la-la" on one
  // pitch gets one note. The decode cannot see these by construction, so the only
  // lever without new DSP is the amplitude re-attack detector that feeds
  // `splitAtOnsets` — whose defaults were tuned for a segmenter that fragmented
  // heavily, i.e. one that needed the splitter to be timid.
  if (on('e9')) {
    const SPLIT: NoteExtractorOptions = {
      maxGridDivisor: 4,
      steps: {
        pitchOutliers: false, merge: false, transients: false, monophonic: false,
      },
    };
    configs.push({ name: 'e9 onsets shipped', group: 'e9', segment: voiceSegment(BEST), cleanup: SPLIT });
    for (const dipRatio of [0.5, 0.65, 0.8]) {
      for (const riseRatio of [1.2, 1.5, 1.8]) {
        configs.push({
          name: `e9 dip${dipRatio} rise${riseRatio}`,
          group: 'e9',
          segment: voiceSegment(BEST),
          cleanup: SPLIT,
          onsets: { dipRatio, riseRatio },
        });
      }
    }
    for (const minIoiSec of [0.06, 0.09, 0.13]) {
      configs.push({
        name: `e9 ioi${minIoiSec}`,
        group: 'e9',
        segment: voiceSegment(BEST),
        cleanup: SPLIT,
        onsets: { dipRatio: 0.65, riseRatio: 1.4, minIoiSec },
      });
    }
  }

  // R15 — WaoN's joint duration × velocity filters (plugin survey §9.3): the
  // short-note floor spares short LOUD runs (real staccato), and a new
  // long-AND-quiet drop targets reverb tails. On this clean corpus the question
  // is safety plus any free win; the adverse-tier measurement these filters were
  // built for lives in sweep-reverb.ts (the `voice *` rows).
  if (on('r15')) {
    configs.push({
      name: 'r15 OFF (anchor)',
      group: 'r15',
      segment: voiceSegment(BEST),
      cleanup: null,
    });
    for (const keepShortLoudRatio of [1.2, 1.5, 2]) {
      configs.push({
        name: `r15 sl${keepShortLoudRatio}`,
        group: 'r15',
        segment: voiceSegment({ ...BEST, keepShortLoudRatio }),
        cleanup: null,
      });
    }
    for (const quietRatio of [0.2, 0.3, 0.45]) {
      configs.push({
        name: `r15 lq${quietRatio}@.35s`,
        group: 'r15',
        segment: voiceSegment({ ...BEST, dropLongQuiet: { minSec: 0.35, quietRatio } }),
        cleanup: null,
      });
    }
    configs.push({
      name: 'r15 sl1.5+lq.3',
      group: 'r15',
      segment: voiceSegment({
        ...BEST,
        keepShortLoudRatio: 1.5,
        dropLongQuiet: { minSec: 0.35, quietRatio: 0.3 },
      }),
      cleanup: null,
    });
  }

  // R19 — block-level voiced-fraction quorum on the voicing gate (plugin survey
  // §11.3/§7.2/§4.5). The adverse-tier measurement lives in sweep-reverb.ts
  // (`voice q*` rows); this group is the clean-corpus safety check.
  if (on('r19')) {
    configs.push({
      name: 'r19 OFF (anchor)',
      group: 'r19',
      segment: voiceSegment(BEST),
      cleanup: null,
    });
    for (const minFraction of [0.25, 0.5, 0.75]) {
      for (const windowSec of [0.06, 0.12, 0.2]) {
        configs.push({
          name: `r19 q${minFraction}w${windowSec * 1000}`,
          group: 'r19',
          segment: voiceSegment({
            ...BEST,
            voicedQuorum: { minFraction, windowSec },
          }),
          cleanup: null,
        });
      }
    }
  }

  // R21 — fill 1–2-frame unvoiced dropouts on the track before decoding (Deep
  // Autotuner's interpolate_pyin, corrected to fill unvoiced frames only). The
  // "done when" is a two-part claim: no regression anywhere, AND the
  // `unvoicedPitchCost` optimum flattens — the sign that cost was doing two
  // jobs (note survival across consonants + pitch identity), of which the fill
  // just took the trivial half.
  if (on('r21')) {
    for (const fill of [undefined, 0.02, 0.04]) {
      for (const unvoicedPitchCost of [0.8, 1.5, 3]) {
        configs.push({
          name: `r21 ${fill === undefined ? 'raw' : `fill${fill * 1000}`} u${unvoicedPitchCost}`,
          group: 'r21',
          segment: voiceSegment({
            ...BEST,
            unvoicedPitchCost,
            ...(fill !== undefined && { fillUnvoicedGapSec: fill }),
          }),
          cleanup: null,
        });
      }
    }
  }

  // R21ad — the reverberance-ADAPTIVE dropout fill (fillSec = scale × the
  // production `estimateReverberance`, off below 20 ms). The always-on fill
  // wins big under reverb and costs the clean slice; this asks whether the
  // production signal can keep the fill away from the clean corpora — esmuc/csd
  // are real choir rooms, so "clean" is not automatically "dry" here. Needs the
  // per-clip reverberance pre-pass (`needsReverberance`).
  if (on('r21ad')) {
    configs.push({
      name: 'r21ad OFF (anchor)',
      group: 'r21ad',
      segment: voiceSegment(BEST),
      cleanup: null,
    });
    for (const scale of [0.1, 0.15, 0.2]) {
      configs.push({
        name: `r21ad x${scale}`,
        group: 'r21ad',
        needsReverberance: true,
        segment: (c) => {
          const r = clipReverberance.get(`${c.dataset}/${c.clip}`) ?? 0;
          const fillSec = scale * r;
          return voiceSegment({
            ...BEST,
            ...(fillSec >= 0.02 && { fillUnvoicedGapSec: fillSec }),
          })(c);
        },
        cleanup: null,
      });
    }
  }

  // R7 — the re-attack detector's aubio-style report delay (plugin pass task 5).
  // The detector reports the trough of the inter-note dip, which precedes the
  // audible re-attack; this calibrates the constant on both consumers of its
  // onsets. Anchors also go through re-detection (delay 0) so the comparison
  // isolates the delay itself.
  if (on('r7')) {
    const SPLIT: NoteExtractorOptions = {
      maxGridDivisor: 4,
      steps: {
        pitchOutliers: false, merge: false, transients: false, monophonic: false,
      },
    };
    const delays = [-0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.05];
    for (const d of delays) {
      configs.push({
        name: `r7 v d${d * 1000}ms`,
        group: 'r7',
        segment: voiceSegment(BEST),
        cleanup: SPLIT,
        onsets: { delaySec: d },
      });
    }
    for (const d of delays) {
      configs.push({
        name: `r7 s d${d * 1000}ms`,
        group: 'r7',
        segment: shippedSegment,
        cleanup: SHIPPED_CLEANUP,
        onsets: { delaySec: d },
      });
    }
  }

  // R17 — the survey's three remaining pitch estimators (plugin pass task 7),
  // in the order the doc ranks them: TalentedHack's slew-limit-with-momentum
  // (arrives and holds), fat1's one-pole (creeps), MXTune's per-note linear
  // detrend. Same SPLIT cleanup as e8, so rows compare against that log.
  if (on('r17')) {
    const SPLIT: NoteExtractorOptions = {
      maxGridDivisor: 4,
      steps: {
        pitchOutliers: false, merge: false, transients: false, monophonic: false,
      },
    };
    configs.push({
      name: 'r17 trimmed (ships)',
      group: 'r17',
      segment: voiceSegment(BEST),
      cleanup: SPLIT,
    });
    for (const slewTimeSec of [0.03, 0.05, 0.1]) {
      configs.push({
        name: `r17 slew${slewTimeSec * 1000}`,
        group: 'r17',
        segment: voiceSegment({ ...BEST, pitchEstimator: 'slew-limit', slewTimeSec }),
        cleanup: SPLIT,
      });
    }
    for (const onePoleTauSec of [0.02, 0.04, 0.08]) {
      configs.push({
        name: `r17 pole${onePoleTauSec * 1000}`,
        group: 'r17',
        segment: voiceSegment({ ...BEST, pitchEstimator: 'one-pole', onePoleTauSec }),
        cleanup: SPLIT,
      });
    }
    configs.push({
      name: 'r17 detrend',
      group: 'r17',
      segment: voiceSegment({ ...BEST, pitchEstimator: 'detrend' }),
      cleanup: SPLIT,
    });
  }

  // R9/R16 (E3) — the headline experiment: pYIN's multi-candidate emission.
  // Kill criteria (from the plan, verbatim): kill if the single-candidate
  // baseline is not beaten on the VOICE slice at k=3 AND k=5.
  if (on('r9')) {
    configs.push({
      name: 'r9 OFF (anchor)',
      group: 'r9',
      segment: voiceSegment(BEST),
      cleanup: null,
    });
    for (const k of [3, 5]) {
      for (const yinTrust of [0.5, 1, 2]) {
        configs.push({
          name: `r9 k${k} y${yinTrust}`,
          group: 'r9',
          segment: voiceSegment({ ...BEST, candidates: { k, yinTrust } }),
          cleanup: null,
        });
      }
    }
    for (const octaveBias of [1, 1.5]) {
      configs.push({
        name: `r9 k5 y1 oct${octaveBias}`,
        group: 'r9',
        segment: voiceSegment({ ...BEST, candidates: { k: 5, yinTrust: 1, octaveBias } }),
        cleanup: null,
      });
    }
  }

  // R10(a) (E4) — interval-proportional change cost, the survey's strongest
  // cross-reference (§16.7). The flat BEST cost is saturated at 2.5 (direct
  // jumps never taken); an interval shape re-opens SMALL intervals cheaply,
  // which is exactly the transition-recall gap (0.65 vs the shipping
  // segmenter's 0.80). Base cost × shape swept together — they trade.
  if (on('r10')) {
    configs.push({
      name: 'r10 OFF (anchor)',
      group: 'r10',
      segment: voiceSegment(BEST),
      cleanup: null,
    });
    for (const changeCost of [0.5, 1, 1.5]) {
      for (const sigmaSemitones of [0.7, 1.5, 3]) {
        configs.push({
          name: `r10 g c${changeCost} s${sigmaSemitones}`,
          group: 'r10',
          segment: voiceSegment({
            ...BEST,
            changeCost,
            intervalChange: { form: 'gaussian', sigmaSemitones },
          }),
          cleanup: null,
        });
      }
      for (const perOctaveNats of [2, 5, 10]) {
        configs.push({
          name: `r10 l c${changeCost} o${perOctaveNats}`,
          group: 'r10',
          segment: voiceSegment({
            ...BEST,
            changeCost,
            intervalChange: { form: 'linear', perOctaveNats },
          }),
          cleanup: null,
        });
      }
    }
  }

  // R10(b) (E4) — pitch memory across silence, Praat's path-lookback. Today a
  // step and a minor tenth cost the same after any rest; this prices the
  // interval from the pitch the silence run left. Amortised (Praat's form —
  // long rests forget) and fixed variants.
  if (on('r10b')) {
    configs.push({
      name: 'r10b OFF (anchor)',
      group: 'r10b',
      segment: voiceSegment(BEST),
      cleanup: null,
    });
    for (const perOctaveNats of [1, 3, 6, 12]) {
      for (const amortize of [true, false]) {
        configs.push({
          name: `r10b ${amortize ? 'am' : 'fix'} o${perOctaveNats}`,
          group: 'r10b',
          segment: voiceSegment({
            ...BEST,
            silenceMemory: { perOctaveNats, amortize },
          }),
          cleanup: null,
        });
      }
    }
  }

  // R6 (E7) — fat1's two-stage voicing decay: release the note-change
  // resistance after N unvoiced frames while `unvoicedPitchCost` alone keeps
  // deciding survival. The case it targets: a slurred pitch change THROUGH a
  // consonant, which the saturated change cost currently forbids.
  if (on('r6')) {
    configs.push({
      name: 'r6 OFF (anchor)',
      group: 'r6',
      segment: voiceSegment(BEST),
      cleanup: null,
    });
    for (const afterSec of [0.04, 0.08]) {
      for (const discount of [0.5, 0.2, 0]) {
        configs.push({
          name: `r6 a${afterSec * 1000} d${discount}`,
          group: 'r6',
          segment: voiceSegment({
            ...BEST,
            unvoicedChangeRelease: { afterSec, discount },
          }),
          cleanup: null,
        });
      }
    }
  }

  // R3 — aubio's adaptive onset threshold (plugin pass task 6), on both
  // consumers of the detector's onsets. The bar its own doc comment sets: beat
  // the fixed ratios on the sustained-singing corpora AND guitarset/vocadito at
  // once, which no fixed setting managed.
  if (on('r3')) {
    const SPLIT: NoteExtractorOptions = {
      maxGridDivisor: 4,
      steps: {
        pitchOutliers: false, merge: false, transients: false, monophonic: false,
      },
    };
    configs.push({
      name: 'r3 v fixed (anchor)',
      group: 'r3',
      segment: voiceSegment(BEST),
      cleanup: SPLIT,
      onsets: {},
    });
    configs.push({
      name: 'r3 s fixed (anchor)',
      group: 'r3',
      segment: shippedSegment,
      cleanup: SHIPPED_CLEANUP,
      onsets: {},
    });
    for (const windowSec of [0.15, 0.3, 0.5]) {
      for (const k of [0.5, 1, 2, 4]) {
        configs.push({
          name: `r3 v w${windowSec * 1000} k${k}`,
          group: 'r3',
          segment: voiceSegment(BEST),
          cleanup: SPLIT,
          onsets: { adaptiveThreshold: { windowSec, k } },
        });
        configs.push({
          name: `r3 s w${windowSec * 1000} k${k}`,
          group: 'r3',
          segment: shippedSegment,
          cleanup: SHIPPED_CLEANUP,
          onsets: { adaptiveThreshold: { windowSec, k } },
        });
      }
    }
  }

  // FLUX — §3.2's selective in-note SuperFlux splitter, the one untried
  // model-free re-onset idea. The broadband envelope is proven unable to see a
  // re-articulation (e9 + the reonsetCost/accentBonus nulls); band-wise flux is
  // the literature's answer, applied at a HIGH threshold and only inside notes
  // that are already long and pitch-flat, so it can only ever cut what some
  // decode already found. Now measurable properly: ESMUC/CSD added ~2,800
  // annotated re-onsets to a slice that previously had a few hundred.
  if (on('flux')) {
    const SPLIT: NoteExtractorOptions = {
      maxGridDivisor: 4,
      steps: {
        pitchOutliers: false, merge: false, transients: false, monophonic: false,
      },
    };
    configs.push({
      name: 'flux OFF (anchor)',
      group: 'flux',
      segment: voiceSegment(BEST),
      cleanup: SPLIT,
    });
    for (const threshold of [0.3, 0.5, 0.7]) {
      for (const minNoteSec of [0.24, 0.4]) {
        for (const flatCents of [60, 100]) {
          configs.push({
            name: `flux t${threshold} n${minNoteSec} f${flatCents}`,
            group: 'flux',
            segment: voiceSegment(BEST),
            cleanup: SPLIT,
            needsFlux: true,
            post: (notes, c) =>
              splitAtSpectralPeaks(
                notes,
                loadFlux(c),
                c.track,
                c.profile.confidenceThreshold ?? 0.5,
                { threshold, minNoteSec, flatCents },
              ),
          });
        }
      }
    }
  }

  return configs;
}

// --- scoring -----------------------------------------------------------------

interface SliceAcc {
  perDataset: Map<string, {
    conp: number[]; con: number[]; est: number[]; ref: number[];
    oct: number[]; chroma: number[];
  }>;
  perClip: number[];
  seg: SegErrorCounts;
  onsets: OnsetClassStats;
  onsetDeltaMs: number[];
}

function newSlice(): SliceAcc {
  return {
    perDataset: new Map(),
    perClip: [],
    seg: {
      clean: 0, split: 0, merged: 0, missed: 0, spurious: 0,
      tangled: 0, pitchWrong: 0, refTotal: 0, estTotal: 0,
    },
    onsets: emptyOnsetClassStats(),
    onsetDeltaMs: [],
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function recordClip(acc: SliceAcc, c: CachedClip, est: EstNote[]): void {
  const m = scoreNotesBest(c.truth, est, { onsetTolSec: 0.1, timingTolSec: 0.3 });
  const con = scoreOnsets(c.truth.notes, est, 0.1);
  let d = acc.perDataset.get(c.dataset);
  if (!d) {
    d = { conp: [], con: [], est: [], ref: [], oct: [], chroma: [] };
    acc.perDataset.set(c.dataset, d);
  }
  d.conp.push(m.f1);
  d.con.push(con.f1);
  d.est.push(est.length);
  d.ref.push(m.refCount);
  d.oct.push(m.octaveErrorRate);
  d.chroma.push(m.chromaF1);
  acc.perClip.push(m.f1);
  const e = segErrors(c.truth.notes, est);
  for (const k of Object.keys(acc.seg) as Array<keyof SegErrorCounts>) acc.seg[k] += e[k];
  addOnsetClassStats(acc.onsets, onsetRecallByClass(c.truth.notes, est, 0.1));
  acc.onsetDeltaMs.push(...m.timing.onsetDeltasMs);
}

function sliceLine(acc: SliceAcc, dsIds: string[]): string {
  const conp = dsIds.map((d) => mean(acc.perDataset.get(d)?.conp ?? []));
  const con = dsIds.map((d) => mean(acc.perDataset.get(d)?.con ?? []));
  const ratio = dsIds.map((d) => {
    const e = acc.perDataset.get(d);
    return e ? mean(e.est) / Math.max(1e-9, mean(e.ref)) : 0;
  });
  return (
    dsIds
      .map((_, i) => `${conp[i].toFixed(2)}/${con[i].toFixed(2)}/${ratio[i].toFixed(2)}`.padEnd(16))
      .join('') + mean(conp).toFixed(3).padEnd(9)
  );
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry(MODELS);
  await registry.initAll();
  const cache = new TrackCache(registry, CACHE_ROOT);
  const split = splitFromEnv();
  const only = process.env.VOICE_ONLY;
  const withGuard = process.env.VOICE_GUARD !== '0';
  const groups = new Set(
    (process.env.VOICE_EXP ?? 'base,e1').split(',').map((s) => s.trim()).filter(Boolean),
  );

  const datasets = discoverRealDatasets(REAL_ROOT).filter(
    (d) => !d.noteTruthDerived && d.corpusSplit !== 'test',
  );
  const voiceIds = datasets.filter((d) => d.kind === 'voice').map((d) => d.id).sort();
  const guardIds = withGuard
    ? datasets.filter((d) => d.kind !== 'voice').map((d) => d.id).sort()
    : [];

  const clips: CachedClip[] = [];
  for (const ds of datasets) {
    if (!voiceIds.includes(ds.id) && !guardIds.includes(ds.id)) continue;
    for (const clip of listRealClips(ds.dir)) {
      if (!inSplit(ds.id, clip, split)) continue;
      let c: CachedClip | null = null;
      try {
        c = await cache.load(ds, clip);
      } catch {
        c = null;
      }
      if (c) clips.push(c);
    }
  }
  const voiceClips = clips.filter((c) => voiceIds.includes(c.dataset));
  const guardClips = clips.filter((c) => guardIds.includes(c.dataset));
  console.log(
    `split=${split} groups=${[...groups].join(',')} ` +
      `voice=${voiceClips.length} clips (${voiceIds.join(' ')}) ` +
      `guard=${guardClips.length} clips (${guardIds.length} datasets)`,
  );

  const configs = buildConfigs(groups).filter((c) => !only || c.name.includes(only));

  // Spectral-flux sidecars for any config that reads them — async (ffmpeg
  // decode) so it runs once up front; the per-config loop stays synchronous.
  if (configs.some((c) => c.needsFlux)) {
    let built = 0;
    for (const c of voiceClips) {
      await ensureFluxCache(c);
      built += 1;
      if (built % 100 === 0) console.log(`  flux sidecars: ${built}/${voiceClips.length}`);
    }
  }

  // Per-clip production reverberance for room-gated configs — decoded exactly
  // the way `ProfileResolver` sees the audio (16 kHz, high-pass 30 Hz, no
  // loudnorm). ffmpeg only; no model inference.
  if (configs.some((c) => c.needsReverberance)) {
    const decoder = new AudioDecoder();
    let built = 0;
    for (const c of clips) {
      const key = `${c.dataset}/${c.clip}`;
      if (clipReverberance.has(key)) continue;
      try {
        const wav = readFileSync(c.wavPath);
        const det = await decoder.decode(wav, 16000, { loudnorm: false, highpassHz: 30 });
        clipReverberance.set(key, estimateReverberance(det.samples, 16000));
      } catch {
        clipReverberance.set(key, 0);
      }
      built += 1;
      if (built % 100 === 0) console.log(`  reverberance: ${built}/${clips.length}`);
    }
  }

  const header =
    'config'.padEnd(26) +
    voiceIds.map((d) => `${d.slice(0, 12)} P/On/rat`.padEnd(16)).join('') +
    'VOICE'.padEnd(9) +
    (guardIds.length ? 'GUARD'.padEnd(9) : '');
  console.log('\n' + header);
  console.log('-'.repeat(header.length));

  interface Result {
    name: string;
    voice: SliceAcc;
    guard: SliceAcc;
    voiceMean: number;
    guardMean: number;
  }
  const results: Result[] = [];

  for (const cfg of configs) {
    const voice = newSlice();
    const guard = newSlice();
    const extractor = cfg.cleanup ? new NoteExtractor(cfg.cleanup) : null;

    for (const c of clips) {
      let notes = cfg.segment(c);
      if (extractor) {
        // Re-detection runs on the FINE (10 ms) envelope, which is the grid the
        // shipping detector uses; the trajectory's 20 ms energy loses a third of
        // the re-onsets before any threshold is applied.
        const onsetTimesSec = cfg.onsets
          ? new OnsetDetector({ ...cfg.onsets, hopSec: c.fineHopSec })
              .detectFromEnvelope(c.fineEnergy, 1, 1 / c.fineHopSec)
          : c.onsetTimesSec;
        notes = extractor.clean(notes as never, {
          bpm: 120,
          onsetTimesSec,
        }) as unknown as NoteEventLike[];
      }
      // Post pass (spectral splitter): sidecars exist only for the voice slice,
      // and `loadFlux` returns null elsewhere, so guard clips are untouched.
      if (cfg.post) notes = cfg.post(notes, c);
      recordClip(voiceIds.includes(c.dataset) ? voice : guard, c, toEst(notes));
    }

    const voiceMean = mean(voiceIds.map((d) => mean(voice.perDataset.get(d)?.conp ?? [])));
    const guardMean = guardIds.length
      ? mean(guardIds.map((d) => mean(guard.perDataset.get(d)?.conp ?? [])))
      : 0;
    console.log(
      cfg.name.padEnd(26) +
        sliceLine(voice, voiceIds) +
        (guardIds.length ? guardMean.toFixed(3).padEnd(9) : ''),
    );
    results.push({ name: cfg.name, voice, guard, voiceMean, guardMean });
  }

  const baseline = results.find((r) => r.name === 'SHIPPED');

  console.log('\n--- how each config is wrong, per 100 VOICE reference notes ---');
  for (const r of [...results].sort((a, b) => b.voiceMean - a.voiceMean)) {
    // chromaF1 − COnP is the share of the loss that is purely OCTAVE; the rest of
    // pWrong is a semitone-level naming error, which wants a different fix.
    const oct = mean(voiceIds.map((d) => mean(r.voice.perDataset.get(d)?.oct ?? [])));
    const chroma = mean(voiceIds.map((d) => mean(r.voice.perDataset.get(d)?.chroma ?? [])));
    console.log(
      `${r.name.padEnd(26)} ${formatSegErrors(r.voice.seg)} ` +
        `octErr=${oct.toFixed(3)} chromaF1=${chroma.toFixed(3)}`,
    );
  }

  console.log(
    '\n--- VOICE onset recall by class (Yong et al.: connected ≤20 ms; same pitch = re-onset) ---',
  );
  for (const r of [...results].sort((a, b) => b.voiceMean - a.voiceMean)) {
    console.log(
      `${r.name.padEnd(26)} ${formatOnsetClasses(r.voice.onsets)} ` +
        `onsetBias=${mean(r.voice.onsetDeltaMs).toFixed(0)}ms ` +
        `med=${median(r.voice.onsetDeltaMs).toFixed(0)}ms`,
    );
  }

  if (baseline) {
    console.log(
      '\n--- vs SHIPPED, paired bootstrap over clips (* = CI excludes 0) ---',
    );
    console.log('config'.padEnd(26) + 'VOICE'.padEnd(46) + 'GUARD');
    for (const r of [...results].sort((a, b) => b.voiceMean - a.voiceMean)) {
      if (r === baseline) continue;
      const v = pairedDiffCI(baseline.voice.perClip, r.voice.perClip);
      const g = guardIds.length
        ? pairedDiffCI(baseline.guard.perClip, r.guard.perClip)
        : null;
      console.log(
        r.name.padEnd(26) +
          formatComparison(v).padEnd(46) +
          (g ? formatComparison(g) : ''),
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
