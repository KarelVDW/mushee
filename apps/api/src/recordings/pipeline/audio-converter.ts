import type { DecodeOptions } from './audio-decoder'
import { envNumber } from './env'
import { ExtractedNotes, NoteExtractor, type NoteExtractorOptions } from './note-extractor'
import { OnsetDetector } from './onset-detector'
import { AT_PITCH_PROVIDER_NAME, type PipelineProfile } from './profiles/pipeline-profile'
import type { PitchProvider, PitchSession, PitchTranscribeOptions } from './providers/pitch-provider'

/**
 * Same-pitch gap bridge for sustained instruments (INST-H4), in seconds. SHIPPED
 * 2026-11 at 0.12 s with the 0.2 s fragment condition; `EXTRACTOR_BRIDGE_GAP_SEC=0`
 * is the kill-switch (`EXTRACTOR_BRIDGE_FRAGMENT_SEC=0` drops the fragment
 * condition, i.e. the any-length rule below). See
 * `NoteExtractorOptions.bridgeSamePitchGapSec` for what it does and
 * `AudioConverter.bridgesSamePitchGaps` for who gets it.
 *
 * Confirmed on the final 2026-11 harness (corrected adverse tier + grid/tempo
 * corrections; cached replay, all conditions, performance-cluster CIs). Dev:
 * instrument +0.0074 [+0.0045, +0.0102]. **The one test look: instrument +0.0046
 * [+0.0030, +0.0062]** (0.759 → 0.764; URMP +0.0050, bowed +0.014, woodwind
 * +0.003, brass −0.001; distant +0.008, wind +0.006, street +0.003 significant,
 * real +0.003, echoey +0.004; one family cell negative, echoey × brass −0.007),
 * ALL +0.0026, human +0.0030; singing and GuitarSet note-identical; URMP
 * re-onsets 124 → 123 of 190 and same-pitch repeats 403 → 399 of 510 (both n.s.).
 * Under the whistle family's pitch-down routing (`RECORDING_WHISTLE_PITCHDOWN`)
 * whistles leave the gate: exactly 0 on top of it (dev).
 *
 * Measured 2026-11-01 on DEV only (cached replay of the production decode, all
 * five conditions on the corrected adverse tier; Δ COnP on the mean of dataset
 * means, CI = performance-cluster bootstrap within dataset; URMP dev is 24
 * clips, 0–3 per instrument):
 *
 *   gap 0.06 / 0.08 / 0.10 / 0.12, any length: instrument +0.0076 / +0.0080 /
 *     +0.0089 / +0.0098 [+0.0062, +0.0133]*; it saturates past 0.12 (0.15
 *     +0.0104, 0.20 +0.0102). Bowed gain most (URMP bowed +0.020*), brass least.
 *   gap 0.12 + fragment < 0.2 s (what ships): instrument +0.0074
 *     [+0.0045, +0.0102]*, URMP pooled by family +0.0064 [+0.0026, +0.0108]*,
 *     ALL +0.0043*, human-only +0.0048*; every condition positive (real +0.006*,
 *     echoey +0.008*, distant +0.012*, wind +0.005*, street +0.007*).
 *   GuitarSet and singing: note-identical (the gate). TinySOL: note-identical.
 *   Whistling +0.005* — at-pitch whistles count as sustained until a whistle
 *     family sets the octave-down provider or a 0 dip (both leave the gate).
 *
 * The onset veto carries it: without it the same bridge is +0.0047 n.s. on URMP,
 * against +0.0092* with it (performances pooled; the 2026-07 `merge` lesson: a
 * trajectory segmenter's same-pitch neighbours are often real repeats). The fragment condition exists because the veto alone still
 * eats repeats whose re-attack the detector misses: any-length joins cost URMP
 * echoey-room same-pitch repeats (≤ 250 ms apart) 122 → 115 of 168, and on the
 * realistic synthetic cello/contrabass (exact truth) re-onset recall 39 → 35 of
 * 85, repeats 212 → 185 of 450. With the 0.2 s fragment limit: URMP repeats
 * 665 → 666 of 840, synthetic 212 → 210, re-onset recall 197 → 199 / 39 → 39,
 * synthetic COnP +0.0049 (n.s.). The limit was chosen after seeing that
 * synthetic result, so the other 34 synthetic instruments (home-phone + room,
 * 362 performances, scored only afterwards) are the fresh check: COnP +0.0010
 * [+0.0003, +0.0017]*, re-onset recall 95 → 96 of 312, repeats 1026 → 1022 of
 * 2496 (any-length rule: 95 → 90, 1026 → 977); brass −0.0007 n.s.; piano,
 * guitar and bass guitar exactly 0.
 * Wider veto margins (50–100 ms) were measured too: they save fewer repeats than
 * they cost fragment joins (URMP COnP lower at every margin).
 *
 * Undeclared input — what the app sends (no `sourceKind`; the score is whatever the
 * user picked; `EVAL_UNDECLARED_SOURCE=1`, cached, all conditions, both splits as a
 * guard, nothing tuned; 2026-11-01): the guards above were declared-hint only, and
 * GuitarSet on a `voice-lead` or empty score got the sustained dip and this bridge.
 * Bridge on vs off there: COnP +0.005 [+0.000, +0.009]* dev (rooms +0.009*, clean
 * −0.004) / +0.005 n.s. test, but COnPOff −0.007* dev (clean −0.011*); synthetic
 * piano / guitar / bass guitar −0.002 n.s. (home-phone −0.004). Such takes now get the
 * struck/plucked family from the audio (`RECORDING_PLUCKED_DETECT`, profile-resolver.ts):
 * on a `voice-lead` score, the declared `guitar` row note for note on test. A plucked or
 * struck take on a score that names a SUSTAINED instrument still gets the dip and the
 * bridge; the numbers above (voice-lead and empty scores) stand in for what that costs.
 */
const BRIDGE_GAP_SEC = envNumber('EXTRACTOR_BRIDGE_GAP_SEC', 0.12)
/** The bridge's fragment condition (`NoteExtractorOptions.bridgeMaxFragmentSec`); 0.2 s ships, `0` = any length. */
const BRIDGE_MAX_FRAGMENT_SEC = envNumber('EXTRACTOR_BRIDGE_FRAGMENT_SEC', 0.2)

/**
 * Provider-agnostic audio → notes pipeline. Hands the PCM samples to the
 * configured `PitchProvider`, then runs the result through `NoteExtractor`'s
 * monophonic + beat-grid post-processing.
 *
 * One converter is created per recording, so it owns the provider's
 * session-scoped state. The session lets incremental providers (e.g. CREPE)
 * cache per-frame outputs across passes within the recording.
 */
export class AudioConverter {
    private readonly extractor: NoteExtractor
    private readonly session: PitchSession
    private readonly onsetDetector: OnsetDetector | null
    /** The provider tuning the profile selects; undefined for an unprofiled converter. */
    private readonly pitchOptions: PitchTranscribeOptions | undefined

    constructor(
        readonly provider: PitchProvider,
        opts: {
            /** Split sustained runs at audio re-attacks to recover repeated notes. */
            enableOnsetSplit?: boolean
            /** Resolved profile — selects the cleanup set (voice vs trajectory vs note-level) and the provider tuning. */
            profile?: PipelineProfile
        } = {},
    ) {
        const { enableOnsetSplit = true, profile } = opts
        this.extractor = new NoteExtractor(AudioConverter.cleanupFor(provider.hasNativeOnsets, profile))
        this.pitchOptions = profile && AudioConverter.pitchOptionsFor(profile)
        this.session = provider.createSession()
        // Only providers without native onset detection (CREPE) need the
        // amplitude re-attack splitter; a note-level provider emits its own onsets, so adding
        // it there would double-split and hurt precision.
        this.onsetDetector =
            enableOnsetSplit && !provider.hasNativeOnsets
                ? new OnsetDetector({
                      delaySec: profile?.onsetDelaySec,
                      dipRatio: profile?.onsetDipRatio,
                      minTroughSec: profile?.onsetMinTroughSec,
                  })
                : null
    }

    /**
     * Which `NoteExtractor` cleanup steps suit this provider.
     *
     * The cleanup was written for a **note-level, polyphonic** upstream — its own
     * docstrings say so, e.g. the outlier filter targets "basic-pitch mis-labeling
     * the octave" and the merge exists to rejoin "basic-pitch splitting a held note".
     * A pitch-trajectory provider produces one note at a time by construction, and
     * measured on the real corpus two of those steps are actively harmful there:
     *
     *   dropping `pitchOutliers` + `merge`  →  **+0.027 F1@0.1 [+0.007, +0.051]**
     *   (paired bootstrap over 82 dev clips; the interval excludes zero, and the
     *    worst-dataset score improves too, 0.377 → 0.415)
     *
     * Why they hurt: `pitchOutliers` drops any note sitting ≥7 semitones from both
     * neighbours, which is a *real melodic leap* in instrumental writing, not an
     * octave error; and `merge` rejoins fragments that a trajectory segmenter never
     * split in the first place, so it can only eat genuine repeated notes.
     * `onsetSplit` is the one step measured to genuinely help (removing it costs
     * −0.013, interval excluding zero), and `monophonic` is now an exact no-op here
     * (ρ = 1.00) — it only ever fired via the floating-point bug in TOUCH_EPSILON_SEC.
     *
     * The note-level path keeps every step: it is what they were designed for, and
     * we have no real recorded corpus for that path (whistling/piccolo) to re-tune on.
     *
     * ## The voice path keeps only `onsetSplit`
     *
     * `VoiceNoteDecoder` already does, inside its decode, what the remaining steps
     * were bolted on to approximate: the A-B-A `transients` folder and the adaptive
     * length floor both exist to undo vibrato fragmentation, and the decoder's
     * note-change cost makes that fragmentation not happen in the first place.
     * Measured on the voice slice (`scripts/eval/sweep-voice.ts`, dev), each of them
     * on top of the voice decode is a small *loss*: transients −0.003, adaptive floor
     * as part of the full shipping set −0.008.
     *
     * `onsetSplit` is the exception and stays, because it is the pipeline's only
     * channel for **re-onsets** — a same-pitch re-articulation is invisible to a
     * pitch-trajectory decode by construction. Adding it lifts re-onset recall
     * 0.124 → 0.329 (dev) / 0.168 → 0.389 (test) at no cost to COnP. An in-decode
     * re-onset transition was implemented and measured as the principled alternative
     * (`VoiceDecodeOptions.reonsetCost`/`accentBonus`) and is a null with a broadband
     * envelope — see those docstrings before trying it again.
     *
     * Public so the eval harness can replay the shipped cleanup instead of keeping
     * a copy. The script adoption is still pending (Phase 1 kept scripts/ out of
     * scope): scripts/eval/lib/decodeCached.ts `cleanupAsProduction` still
     * hand-copies it, and its voice branch lacks adaptiveFloorFraction/seamFillBeats.
     */
    static cleanupFor(hasNativeOnsets: boolean, profile?: PipelineProfile): NoteExtractorOptions {
        if (hasNativeOnsets) return {}
        if (profile?.isVoice) {
            return {
                // The adaptive length floor earns its place back on the voice path
                // (2026-08-08, expanded voice slice): +0.009 dev / +0.010 held-out
                // test, spurious notes 26 → 24 per 100, re-onset recall unchanged —
                // and the gain is carried by the bleed-heavy choral corpora while
                // every solo corpus is untouched, i.e. it prunes neighbour-bleed
                // fragments. The earlier "−0.008" that removed it was measured as
                // part of the FULL cleanup set, not alone. `transients` and
                // `monophonic` stay off: re-adding them buys +0.006 more only on
                // choral bleed, at +18 % repair time and a vocadito loss.
                adaptiveFloorFraction: 0.3,
                // Syllabic singing phonates ~50–70 % of the beat slot ("Frè-re
                // Jac-ques" at 120 BPM sounds ~300 ms per 500 ms quarter), so the
                // default 0.3-beat seam-fill leaves every note a fragment followed by
                // a rest and ties. Widening the fill to the gaps consonants and
                // breaths actually leave writes the slot, not the phonation. Real
                // rests (phrase breaths, ≳ a beat) stay above the threshold. Voice
                // only — instruments articulate their own gaps deliberately.
                seamFillBeats: 0.6,
                steps: {
                    pitchOutliers: false,
                    merge: false,
                    transients: false,
                    monophonic: false,
                },
            }
        }
        return {
            steps: { pitchOutliers: false, merge: false },
            ...(BRIDGE_GAP_SEC > 0 &&
                AudioConverter.bridgesSamePitchGaps(profile) && {
                    bridgeSamePitchGapSec: BRIDGE_GAP_SEC,
                    ...(BRIDGE_MAX_FRAGMENT_SEC > 0 && { bridgeMaxFragmentSec: BRIDGE_MAX_FRAGMENT_SEC }),
                }),
            // Scale the spurious-fragment floor to the clip's own median note length.
            // This is the one thing measured to help the remaining failure — sustained
            // vibrato-heavy singing shattering into fragments — because it engages only
            // where the material is genuinely sustained and stays out of the way of fast
            // humming. **+0.008 F1@0.1 [+0.002, +0.016] dev / [+0.002, +0.015] test**,
            // paired over 94 clips, mir-qbsh excluded (its note labels are manufactured
            // by the harness, so gating on it rewards reproducing that artefact).
            // 0.4 and 0.5 measured slightly worse; it shipped as 0 (disabled) until now.
            adaptiveFloorFraction: 0.3,
        }
    }

    /**
     * Whether a (trajectory-provider) profile is a sustained instrument, the one
     * family the same-pitch gap bridge is for: not a voice (by routing or by
     * belief — under `RECORDING_VOICE_DECODE=0` a sung take reaches this cleanup
     * set with `isVoice` unset), the at-pitch provider (the octave-down band is
     * whistling / piccolo), and a re-attack detector set to a positive dip ratio.
     * That last condition is the onset policy's own family split
     * (`applyOnsetPolicy`): struck / plucked instruments keep the detector's
     * default and leave `onsetDipRatio` unset, and a family that disables the
     * detector sets it to 0. The family is the score's instrument or, when no
     * `sourceKind` was declared and the score names no instrument (a voice part or
     * none), what the audio sounds like (`RECORDING_PLUCKED_DETECT` in the
     * resolver); a plucked or struck take on a score naming a sustained instrument
     * still qualifies — measured on `EXTRACTOR_BRIDGE_GAP_SEC`.
     *
     * Coupled on purpose: `ONSET_POLICY=legacy` leaves every `onsetDipRatio` unset
     * and `ONSET_DIP_RATIO=0` zeroes the sustained one, so either also switches the
     * bridge off and an A/B of those knobs measures both changes (pin
     * `EXTRACTOR_BRIDGE_GAP_SEC=0` in both arms to see the onset knob alone).
     * Decoupling needs a family field of its own on the profile, and under a 0 dip
     * the detector reports no re-attacks, which would leave the bridge's veto blind.
     */
    static bridgesSamePitchGaps(profile: PipelineProfile | undefined): boolean {
        return (
            profile !== undefined &&
            !profile.isVoice &&
            profile.sourceBelief !== 'voice' &&
            profile.providerName === AT_PITCH_PROVIDER_NAME &&
            (profile.onsetDipRatio ?? 0) > 0
        )
    }

    /**
     * How audio must be decoded for `provider` under `profile` — the stream the
     * provider transcribes (the caller adds the container hint). Decode at
     * `provider.sampleRate`.
     */
    static decodeOptionsFor(provider: PitchProvider, profile: PipelineProfile): DecodeOptions {
        return {
            highpassHz: profile.highpassHz,
            loudnorm: provider.normalizeLoudness,
            denoise: profile.denoise,
        }
    }

    /** The provider tuning a resolved profile selects — what every profiled `convert` pass runs with. */
    static pitchOptionsFor(profile: PipelineProfile): PitchTranscribeOptions {
        return {
            minFreqHz: profile.minFreqHz,
            maxFreqHz: profile.maxFreqHz,
            confidenceThreshold: profile.confidenceThreshold,
            minFramesPerNote: profile.minFramesPerNote,
            // Segmentation is a profile decision as of the voice flow: the resolver picks
            // WHERE to listen and now also HOW to decide where notes are.
            segmentMode: profile.segmentMode,
            smoothFrames: profile.smoothFrames,
        }
    }

    /**
     * One pass: transcribe `samples`, then clean and beat-quantize the notes at `bpm`.
     * `pitchOptions` replaces the profile's tuning wholesale — for unprofiled runs
     * (a fixed provider in the eval harness); production passes nothing.
     * `pass.final` marks a streaming session's last pass (see `finalPass`).
     */
    async convert(samples: Float32Array, bpm: number, pitchOptions = this.pitchOptions, pass: { final?: boolean } = {}): Promise<ExtractedNotes> {
        const onsetTimesSec = this.onsetDetector?.detect(samples, this.provider.sampleRate)
        const raw = await this.provider.transcribe(samples, pass.final ? { ...pitchOptions, finalPass: true } : pitchOptions, this.session)
        return this.extractor.extract(raw, { bpm, onsetTimesSec })
    }

    /** Whether an earlier pass decoded under a take-level decision the final one does not agree with (`PitchProvider.voicingAdaptationDrifted`). */
    voicingAdaptationDrifted(): boolean {
        return this.provider.voicingAdaptationDrifted?.(this.session) ?? false
    }
}
