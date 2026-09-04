import type { NoteEventTime } from '../note-event'
import { PitchTrack } from '../pitch-track'
import { CrepeProvider } from './crepe-provider'
import type { ModelBackend } from './model-backend'
import type { PitchProvider, PitchSession, PitchTranscribeOptions } from './pitch-provider'

/**
 * CREPE analysing the audio ONE OCTAVE DOWN — the trajectory provider for the
 * register above CREPE's own ~1997 Hz ceiling (piccolo, whistling). It is what
 * let basic-pitch (and its inference service) be removed on 2026-08-22.
 *
 * The shift is exact and artifact-free: this provider declares
 * `sampleRate = 32 kHz`, so the decoder hands it 32 kHz samples, and the inner
 * CREPE reads them as 16 kHz — the take plays at half speed, every frequency
 * halves (harmonic structure preserved, like a tape machine slowed down), and
 * every duration doubles. The wrapper rescales the note events back
 * (times ÷ 2, pitches + 12 st) and halves the frequency window on the way in.
 * The price is 2× inference cost on this band, and this band only.
 *
 * Effective coverage: 2 × [~32.7, ~1997] Hz ≈ up to ~3.9 kHz — above the
 * highest note the synthetic very-high corpus contains (3 729 Hz), though
 * short of basic-pitch's nominal 4.5 kHz top; see
 * `PITCHDOWN_MODEL_CEILING_HZ`.
 *
 * Measured against basic-pitch before its removal (eval README, 2026-08-20/22
 * provider-consolidation logs): synthetic adaptive 0.589 → 0.605
 * (+0.016 [−0.010, +0.042]); on real audio decisive — TinySOL `very-high`
 * (exact truth, real Ircam timbre) 0.654 → 0.805 (+0.150 [+0.114, +0.185]),
 * whistle-real (117 real whistling clips, draft truth) 0.359 → 0.634
 * (+0.275 [+0.231, +0.323]), dogfood whistling repair effort 3.4× lower.
 * Heavy reverb was the one deficit (−0.03…−0.07). A 2-octave variant measured
 * worse (no content needs the depth, 4× inference cost).
 */
export class CrepePitchdownProvider implements PitchProvider {
    readonly name: string
    /** Slow-down factor: decode at 16 kHz × this, analyse as 16 kHz. */
    private readonly factor = 2
    private readonly semitones = 12
    readonly sampleRate: number
    readonly normalizeLoudness = false
    readonly hasNativeOnsets = false
    readonly cachesAcrossPasses = true
    readonly windowAlignSamples = 1

    private readonly inner: CrepeProvider

    constructor(backend: ModelBackend, name = 'crepe-tiny-down1') {
        this.name = name
        this.inner = new CrepeProvider(backend, name)
        this.sampleRate = this.inner.sampleRate * this.factor
    }

    init(): Promise<void> {
        return this.inner.init()
    }

    createSession(): PitchSession {
        return this.inner.createSession()
    }

    async transcribe(
        samples: Float32Array,
        options?: PitchTranscribeOptions,
        onProgress?: (rawNotes: NoteEventTime[]) => void,
        session?: PitchSession,
    ): Promise<NoteEventTime[]> {
        const k = this.factor
        const scaled: PitchTranscribeOptions = {
            ...options,
            minFreqHz: options?.minFreqHz !== undefined ? options.minFreqHz / k : undefined,
            maxFreqHz: options?.maxFreqHz !== undefined ? options.maxFreqHz / k : undefined,
            // The profile declares its note floor in provider frames; one inner frame
            // covers 1/k of the real time, so the count must scale to keep the floor.
            minFramesPerNote: (options?.minFramesPerNote ?? 4) * k,
            // Same for the semitone smoother: unscaled, the median window covers only
            // 1/k of the real time it covers on the at-pitch provider — the R11 class
            // of inconsistency. Measured as a wash on accuracy (dogfood whistling
            // +0.017*, whistle-real −0.007 n.s., TinySOL exactly 0.000; the cached
            // sweep puts 60–80 ms real on a flat plateau with ≥120 ms worse), kept
            // for the consistency: frame-count knobs mean the same real time on
            // every provider. It is NOT the mechanism of this band's split excess —
            // that question is gated on human-verified whistle labels (see the
            // 2026-08-22 findings log).
            smoothFrames: (options?.smoothFrames ?? 4) * k,
            // The voice decode is calibrated on real-time singing and the very-high
            // band is whistling territory where it deliberately never applied; do not
            // let it run on slowed audio it was never measured on.
            segmentMode: options?.segmentMode === 'voice' ? 'semitone' : options?.segmentMode,
        }
        const raw = await this.inner.transcribe(
            samples,
            scaled,
            onProgress ? (notes) => onProgress(this.unscale(notes)) : undefined,
            session,
        )
        return this.unscale(raw)
    }

    /**
     * Frame-level trajectory in the REAL domain: cents shifted back up an octave
     * and the hop expressed in real seconds (10 ms — half the at-pitch
     * provider's 20 ms, since the model walks its usual hop over half-speed
     * audio). The frames are the same frames `transcribe` segments, so
     * frame-count-denominated knobs replayed on this track mean exactly what
     * they meant in production — which is what lets `TrackCache` (and every
     * cached sweep) finally reach the very-high band.
     */
    async track(samples: Float32Array, session?: PitchSession): Promise<PitchTrack | null> {
        const inner = await this.inner.track(samples, session)
        if (!inner) return null
        const cents = inner.cents.slice()
        for (let i = 0; i < inner.frames; i += 1) cents[i] += this.semitones * 100
        let candCents = inner.candCents
        if (candCents) {
            candCents = candCents.slice()
            for (let i = 0; i < candCents.length; i += 1) candCents[i] += this.semitones * 100
        }
        return new PitchTrack(cents, inner.confidence, inner.frames, inner.hopSec / this.factor, candCents, inner.candStrength, inner.candK)
    }

    /** Model-domain notes (half speed, an octave low) → real-domain notes. */
    private unscale(notes: NoteEventTime[]): NoteEventTime[] {
        const k = this.factor
        return notes.map((n) => {
            // Not on the library type — the trajectory segmenters attach it (E1).
            const float = (n as NoteEventTime & { pitchMidiFloat?: number }).pitchMidiFloat
            return {
                ...n,
                startTimeSeconds: n.startTimeSeconds / k,
                durationSeconds: n.durationSeconds / k,
                pitchMidi: n.pitchMidi + this.semitones,
                ...(float !== undefined && { pitchMidiFloat: float + this.semitones }),
            } as NoteEventTime
        })
    }
}
