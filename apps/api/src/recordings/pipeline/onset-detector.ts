/**
 * Re-attack detector. The monophonic pitch-trajectory providers (CREPE)
 * segment only on pitch stability, so two repeated same-pitch notes read as one
 * sustained note — a recall loss. This finds note re-articulations from the
 * audio amplitude envelope so `NoteExtractor` can split a sustained run back
 * into the notes that were actually played.
 *
 * It is deliberately conservative: an onset requires the energy to genuinely
 * DIP (to a fraction of the preceding peak — a real inter-note gap) and then
 * rise back. Vibrato/tremolo ripple and noise never dip that far, so a held
 * note is not shattered (which would wreck the pipeline's high precision).
 */
/** Tunable re-attack sensitivity; defaults reproduce the historical behavior. */
export interface OnsetDetectorOptions {
    /** Minimum spacing between detected onsets, in seconds. */
    minIoiSec?: number
    /** Energy must fall below this fraction of the preceding peak to count as a gap. */
    dipRatio?: number
    /** ...then rise back to this multiple of the trough to count as a re-attack. */
    riseRatio?: number
    /**
     * How long the envelope must STAY down (below `dipRatio` of the preceding
     * peak) before a rise counts as a re-articulation, on the theory that a real
     * inter-note gap is *sustained* (a breath, a finger lift) whereas a reverb wash
     * only wobbles across the ratios.
     *
     * **SHIPS OFF (0 = the historical behaviour, one dipped frame is enough).**
     * Measured 2026-07-25 via `scripts/eval/sweep-reverb.ts`, and the reason it is
     * off is worth keeping so it is not retried blind:
     *
     * - Reverberation *does* damage this detector. Handing the degraded pipeline
     *   the clean take's onsets and changing nothing else recovers **+0.031**
     *   (echoey-room) / **+0.016** (distant-mic) note-F1, CIs excluding zero.
     * - But it is not "the dips get filled and the detector goes blind". Onset
     *   counts move in BOTH directions depending on material: on sustained singing
     *   they rise (3.5 → 5.4 per clip against 8.5 true notes — spurious splits),
     *   on plucked/dense material they fall (10.5 → 8.5 — missed re-attacks).
     * - And the guard cannot tell a real gap from a wobble any better than a
     *   blunt threshold does. On sustained singing every tightening converges on
     *   the same ceiling as switching the splitter off entirely (200 ms trough
     *   +0.035, `dipRatio` 0.25 +0.035, `riseRatio` 4 +0.037, splitter off +0.041)
     *   with recall unchanged to three decimals — it is only removing splits, not
     *   choosing better ones. On guitarset + vocadito every one of those settings
     *   COSTS (−0.006 … −0.019 F1, −0.012 … −0.028 F₂, CIs excluding zero) in both
     *   dry and reverberant audio, because there the re-attacks are real and are
     *   the whole reason the splitter exists.
     *
     * So the useful reading is that whether to split on amplitude is a property of
     * the MATERIAL, not of the room — the same conclusion the findings log reaches (scripts/eval/README.md)
     * for the segmenter's change cost. Kept as an option because it is the right
     * shape for that material-adaptive version and because it keeps the above
     * reproducible.
     */
    minTroughSec?: number
    /**
     * aubio's adaptive peak-picking (R3: `onset/peakpicker.c`), replacing the
     * fixed `dipRatio`/`riseRatio` state machine when set: an onset is a local
     * maximum of the energy-rise novelty that clears
     * `movingMedian(window) + k · movingMean(window)` of its own neighbourhood —
     * a threshold that self-calibrates to local dynamics instead of asking one
     * global ratio to serve both sustained singing and plucked material (the
     * split this file's own doc comment documents). `minIoiSec` and the global
     * silence floor still apply. The window is centred; the fixed detector's
     * trough-vs-rise timing difference is absorbed by `delaySec` if it matters.
     */
    adaptiveThreshold?: { windowSec?: number; k?: number }
    /**
     * R25 (OpenTune's `SilentGapDetector`): a two-tier ABSOLUTE silence rule on
     * top of the relative 8 %-of-peak floor. A frame is silent when its total
     * RMS is ≤ `totalDbfs` (−40), OR ≤ `relaxedTotalDbfs` (−30) while the
     * 60 Hz–3 kHz voice band is < `bandFloorDbfs` (−40) — a rumble-dominated
     * frame classifies as silence above the strict gate, which is exactly the
     * wind/handling shape that fools a broadband floor. Needs the band envelope
     * (`detect` computes it; `detectFromEnvelope` takes it as an argument).
     */
    silenceRule?: { totalDbfs?: number; relaxedTotalDbfs?: number; bandFloorDbfs?: number }
    /**
     * Constant added to every reported onset time, in seconds (+ = later) —
     * aubio's `delay` parameter, the explicit admission that a detector has a
     * systematic latency (R7). This detector reports the TROUGH of the dip,
     * which precedes the audible re-attack (the energy rise back out of it), so
     * a calibrated correction is expected to be positive. 0 (the default)
     * preserves the historical output exactly.
     */
    delaySec?: number
    /**
     * Envelope frame hop, in seconds (default 0.01).
     *
     * Configurable because `detectFromEnvelope` is meant to be driven over a
     * *pre-computed* envelope — that is the whole reason it is split out — and the
     * eval harness's `TrackCache` stores energy on the pitch trajectory's 20 ms grid,
     * not this detector's 10 ms one. Without this, every duration threshold
     * (`minIoiSec`, `minTroughSec`) silently doubles when the harness drives it, and
     * a sweep of those thresholds measures the wrong thing.
     */
    hopSec?: number
}

export class OnsetDetector {
    /** Frame hop for the envelope, in seconds (~10 ms by default). */
    readonly hopSec: number
    private readonly minIoiSec: number
    private readonly dipRatio: number
    private readonly riseRatio: number
    private readonly minTroughSec: number
    private readonly delaySec: number
    private readonly adaptiveThreshold: { windowSec?: number; k?: number } | undefined
    private readonly silenceRule: { totalDbfs?: number; relaxedTotalDbfs?: number; bandFloorDbfs?: number } | undefined

    constructor(opts: OnsetDetectorOptions = {}) {
        this.hopSec = opts.hopSec ?? 0.01
        this.minIoiSec = opts.minIoiSec ?? 0.09
        this.dipRatio = opts.dipRatio ?? 0.5
        this.riseRatio = opts.riseRatio ?? 1.8
        this.minTroughSec = opts.minTroughSec ?? 0
        this.delaySec = opts.delaySec ?? 0
        this.adaptiveThreshold = opts.adaptiveThreshold
        this.silenceRule = opts.silenceRule
    }

    /**
     * Per-frame RMS at `hopSec` — the ONLY thing detection reads out of the audio.
     * Exposed separately so an evaluation harness can cache this ~100 Hz envelope
     * (a few hundred floats per clip) and then re-run `detectFromEnvelope` under
     * different thresholds without re-decoding or re-running any model. Detection
     * is arithmetic on this array; the audio is only needed to produce it.
     */
    envelope(samples: Float32Array, sampleRate: number): Float32Array {
        const hop = Math.max(1, Math.round(this.hopSec * sampleRate))
        const win = hop * 2
        if (samples.length < win * 2) return new Float32Array(0)

        const nFrames = Math.floor((samples.length - win) / hop) + 1
        const rms = new Float32Array(nFrames)
        for (let f = 0; f < nFrames; f += 1) {
            const start = f * hop
            let sum = 0
            for (let i = 0; i < win; i += 1) {
                const s = samples[start + i]
                sum += s * s
            }
            rms[f] = Math.sqrt(sum / win)
        }
        return rms
    }

    /** Returns onset times in seconds (ascending), excluding the very first attack. */
    detect(samples: Float32Array, sampleRate: number): number[] {
        const hop = Math.max(1, Math.round(this.hopSec * sampleRate))
        return this.detectFromEnvelope(
            this.envelope(samples, sampleRate),
            hop,
            sampleRate,
            this.silenceRule ? this.bandEnvelope(samples, sampleRate) : undefined,
        )
    }

    /**
     * Per-frame RMS of the 60 Hz–3 kHz voice band, on `envelope()`'s grid — the
     * second tier of `silenceRule`. One-pole high- and low-pass are crude but
     * the rule only needs "is the energy rumble or voice", not a flat passband.
     */
    bandEnvelope(samples: Float32Array, sampleRate: number): Float32Array {
        const hpAlpha = Math.exp((-2 * Math.PI * 60) / sampleRate)
        const lpAlpha = 1 - Math.exp((-2 * Math.PI * 3000) / sampleRate)
        const banded = new Float32Array(samples.length)
        let hpPrevIn = 0
        let hpPrevOut = 0
        let lp = 0
        for (let i = 0; i < samples.length; i += 1) {
            const x = samples[i]
            hpPrevOut = hpAlpha * (hpPrevOut + x - hpPrevIn)
            hpPrevIn = x
            lp += lpAlpha * (hpPrevOut - lp)
            banded[i] = lp
        }
        return this.envelope(banded, sampleRate)
    }

    /**
     * The detection proper, over a pre-computed `envelope()`. `hop`/`sampleRate` are
     * carried through rather than derived from `hopSec` so onset times are the exact
     * same floats `detect` has always produced.
     */
    detectFromEnvelope(rms: Float32Array, hop: number, sampleRate: number, bandRms?: Float32Array): number[] {
        const nFrames = rms.length
        if (nFrames === 0) return []
        // R25: absolute two-tier silence classification (see `silenceRule`).
        let silent: Uint8Array | null = null
        if (this.silenceRule) {
            const total = Math.pow(10, (this.silenceRule.totalDbfs ?? -40) / 20)
            const relaxed = Math.pow(10, (this.silenceRule.relaxedTotalDbfs ?? -30) / 20)
            const bandFloor = Math.pow(10, (this.silenceRule.bandFloorDbfs ?? -40) / 20)
            silent = new Uint8Array(nFrames)
            for (let f = 0; f < nFrames; f += 1) {
                const inBand = bandRms && f < bandRms.length ? bandRms[f] : rms[f]
                silent[f] = rms[f] <= total || (rms[f] <= relaxed && inBand < bandFloor) ? 1 : 0
            }
        }
        // 3-tap smoothing.
        const env = new Float32Array(nFrames)
        for (let f = 0; f < nFrames; f += 1) {
            env[f] = (rms[Math.max(0, f - 1)] + rms[f] + rms[Math.min(nFrames - 1, f + 1)]) / 3
        }
        if (this.adaptiveThreshold) {
            return this.detectAdaptive(env, hop, sampleRate)
        }

        // Ignore frames quieter than a small fraction of the global peak (silence).
        let globalPeak = 0
        for (let f = 0; f < nFrames; f += 1) globalPeak = Math.max(globalPeak, env[f])
        const floor = globalPeak * 0.08

        const minGapFrames = Math.max(1, Math.round(this.minIoiSec / this.hopSec))
        const minTroughFrames = Math.round(this.minTroughSec / this.hopSec)
        const onsets: number[] = []
        let peak = 0 // running peak since last onset/note start
        let trough = Infinity // min since the last peak
        let troughFrame = -1
        let lastOnsetFrame = -minGapFrames
        // Length (frames) of the contiguous run the envelope has spent below
        // `dipRatio` of the peak, up to and including the previous frame — the
        // DURATION of the candidate gap, not just its depth.
        let downFrames = 0

        for (let f = 0; f < nFrames; f += 1) {
            const e = env[f]
            if (e > peak) {
                peak = e
                trough = e // reset trough tracking after a new peak
                troughFrame = f
                downFrames = 0
            } else if (e < trough) {
                trough = e
                troughFrame = f
            }
            // The rise that triggers an onset can itself climb back above the dip
            // threshold in one frame, so the gap length counts this frame only when it
            // is still down — never resetting the run out from under the check.
            const isDown = e < this.dipRatio * peak
            const gapFrames = isDown ? downFrames + 1 : downFrames
            // A re-attack: we dipped well below the peak and STAYED down long enough
            // to be a real gap, then rose back up.
            if (
                peak > floor &&
                (!silent || !silent[f]) &&
                trough < this.dipRatio * peak &&
                gapFrames >= minTroughFrames &&
                e > this.riseRatio * trough &&
                troughFrame - lastOnsetFrame >= minGapFrames
            ) {
                onsets.push(Math.max(0, (troughFrame * hop) / sampleRate + this.delaySec))
                lastOnsetFrame = troughFrame
                peak = e // start a fresh note
                trough = e
                troughFrame = f
                downFrames = 0
            } else {
                downFrames = isDown ? downFrames + 1 : 0
            }
        }
        return onsets
    }

    /**
     * The adaptive path (see `adaptiveThreshold`): novelty = half-wave-rectified
     * envelope rise; an onset is a 3-frame local maximum of it that clears
     * `movingMedian + k · movingMean` of its centred neighbourhood. The same
     * global silence floor and `minIoiSec` spacing as the fixed detector.
     */
    private detectAdaptive(env: Float32Array, hop: number, sampleRate: number): number[] {
        const nFrames = env.length
        const windowSec = this.adaptiveThreshold?.windowSec ?? 0.3
        const k = this.adaptiveThreshold?.k ?? 1
        const half = Math.max(1, Math.round(windowSec / this.hopSec / 2))

        const novelty = new Float32Array(nFrames)
        for (let f = 1; f < nFrames; f += 1) {
            novelty[f] = Math.max(0, env[f] - env[f - 1])
        }

        let globalPeak = 0
        for (let f = 0; f < nFrames; f += 1) globalPeak = Math.max(globalPeak, env[f])
        const floor = globalPeak * 0.08

        const minGapFrames = Math.max(1, Math.round(this.minIoiSec / this.hopSec))
        const onsets: number[] = []
        let lastOnsetFrame = -minGapFrames
        const win: number[] = []
        for (let f = 1; f < nFrames; f += 1) {
            if (novelty[f] <= 0 || env[f] <= floor) continue
            // Local maximum over the immediate 3-frame neighbourhood.
            if (novelty[f] < novelty[f - 1]) continue
            if (f + 1 < nFrames && novelty[f] < novelty[f + 1]) continue
            if (f - lastOnsetFrame < minGapFrames) continue
            const lo = Math.max(0, f - half)
            const hi = Math.min(nFrames - 1, f + half)
            win.length = 0
            let sum = 0
            for (let j = lo; j <= hi; j += 1) {
                win.push(novelty[j])
                sum += novelty[j]
            }
            win.sort((a, b) => a - b)
            const median = win[win.length >> 1]
            const mean = sum / win.length
            if (novelty[f] - median - k * mean <= 0) continue
            onsets.push(Math.max(0, (f * hop) / sampleRate + this.delaySec))
            lastOnsetFrame = f
        }
        return onsets
    }
}
