/** Minimum waveform gain: RMS from a desktop mic rarely exceeds ~0.2, so ×10 fills the staff. */
const WAVEFORM_GAIN = 10
/**
 * Cap for the self-calibrating waveform gain (see {@link WaveformMeter.sample}):
 * quiet capture paths get boosted at most this much, so a take with no real
 * signal can't blow room noise up into full-height bars.
 */
const WAVEFORM_GAIN_MAX = 40
/** RMS below this is room noise or breath, not singing — it never calibrates the meter. */
const WAVEFORM_NOISE_GATE = 0.01
/**
 * Per-voiced-sample decay of the calibration peak (~30 Hz sampling → halves
 * after ~2.3 s of singing), so one loud pop at the start doesn't pin the
 * meter low for the rest of the take. Silence doesn't decay it: the gain
 * would otherwise creep up between phrases and pump the noise floor.
 */
const WAVEFORM_PEAK_DECAY = 0.99

/** Level meter on a mic stream for the live recording waveform. */
export class WaveformMeter {
    private readonly ctx: AudioContext
    private readonly analyser: AnalyserNode
    private readonly data: Uint8Array<ArrayBuffer>
    /** Running voiced-RMS peak of the take; calibrates the gain (see sample). */
    private peak = 0

    constructor(stream: MediaStream) {
        this.ctx = new AudioContext()
        const source = this.ctx.createMediaStreamSource(stream)
        this.analyser = this.ctx.createAnalyser()
        this.analyser.fftSize = 256
        source.connect(this.analyser)
        this.data = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))
    }

    /** The mic's level right now (RMS over the analyser window), normalized to 0..1. */
    sample(): number {
        this.analyser.getByteTimeDomainData(this.data)
        let sumSquares = 0
        for (let i = 0; i < this.data.length; i++) {
            const v = (this.data[i] - 128) / 128
            sumSquares += v * v
        }
        const rms = Math.sqrt(sumSquares / this.data.length)
        // Self-calibrating gain: desktop mics deliver RMS around 0.1–0.2, but
        // iOS forces its voice-processing capture path back on (see
        // RecordingEngine.start's mic settings) and yields a fraction of that —
        // a fixed gain leaves mobile bars barely visible. Normalize against the
        // take's own voiced peak so the loudest singing fills the staff on every
        // device; the gain never drops below the desktop tuning, so hot mics
        // render exactly as before.
        if (rms >= WAVEFORM_NOISE_GATE) {
            this.peak = Math.max(rms, this.peak * WAVEFORM_PEAK_DECAY)
        }
        const gain = this.peak > 0 ? Math.min(Math.max(1 / this.peak, WAVEFORM_GAIN), WAVEFORM_GAIN_MAX) : WAVEFORM_GAIN
        return Math.min(rms * gain, 1)
    }

    /** Release the analyser's audio context. */
    close(): void {
        this.ctx.close().catch(() => {})
    }
}
