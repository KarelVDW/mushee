// --- Constants ---

/** Piano samples with their native MIDI note numbers */
const PIANO_SAMPLES: { url: string; midi: number }[] = [
    { url: '/samples/piano/piano-fs2.mp3', midi: 42 },  // F#2
    { url: '/samples/piano/piano-a2.mp3', midi: 45 },   // A2
    { url: '/samples/piano/piano-c4-iowa.mp3', midi: 60 }, // C4
    { url: '/samples/piano/piano-bb4-iowa.mp3', midi: 70 }, // Bb4
]

interface LoadedSample {
    buffer: AudioBuffer
    midi: number
}

export interface ScheduledNote {
    startTime: number
    duration: number
    midi: number
}

function midiToFrequency(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Plays MIDI notes via the Web Audio API. Has no knowledge of scores or music notation.
 */
export class MidiPlayer {
    private audioCtx: AudioContext | null = null
    private sourceNodes: AudioBufferSourceNode[] = []
    private startOffset = 0
    private samples: LoadedSample[] = []
    private samplesLoaded = false

    // Preview uses a separate, long-lived AudioContext so it doesn't interfere with score playback
    private previewCtx: AudioContext | null = null
    private previewNodes: AudioBufferSourceNode[] = []

    get currentTime(): number {
        if (!this.audioCtx) return 0
        return this.audioCtx.currentTime - this.startOffset
    }

    get isActive(): boolean {
        return this.audioCtx !== null
    }

    /** Preload piano samples. Call once on mount. */
    async loadSamples() {
        if (this.samplesLoaded) return
        const ctx = new AudioContext()
        try {
            this.samples = await Promise.all(
                PIANO_SAMPLES.map(async ({ url, midi }) => {
                    const response = await fetch(url)
                    const arrayBuffer = await response.arrayBuffer()
                    const buffer = await ctx.decodeAudioData(arrayBuffer)
                    return { buffer, midi }
                }),
            )
            this.samplesLoaded = true
        } finally {
            await ctx.close()
        }
    }

    /** Open a new audio context for playback. Notes are scheduled individually via schedule(). */
    start() {
        this.stop()
        this.audioCtx = new AudioContext()
        this.startOffset = this.audioCtx.currentTime
    }

    /** Schedule a single note on the running playback context. */
    schedule(note: ScheduledNote) {
        if (!this.audioCtx) return
        const t = this.startOffset + note.startTime
        this.sourceNodes.push(this.createSource(this.audioCtx, t, note.duration, note.midi))
    }

    stop() {
        this.stopNodes(this.sourceNodes)
        this.sourceNodes = []

        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {})
            this.audioCtx = null
        }
    }

    /** Suspend playback — freezes currentTime and halts audio output without losing state. */
    pause() {
        this.audioCtx?.suspend().catch(() => {})
    }

    /** Resume a suspended playback context. */
    resume() {
        this.audioCtx?.resume().catch(() => {})
    }

    /** Play a single note for the given duration. Stops any previous preview. */
    preview(midi: number, duration: number) {
        this.stopPreview()
        if (!this.previewCtx) this.previewCtx = new AudioContext()
        const t = this.previewCtx.currentTime
        this.previewNodes.push(this.createSource(this.previewCtx, t, duration, midi))
    }

    stopPreview() {
        this.stopNodes(this.previewNodes)
        this.previewNodes = []
    }

    // --- Internal ---

    private stopNodes(nodes: AudioBufferSourceNode[]) {
        for (const src of nodes) {
            try {
                src.stop()
                src.disconnect()
            } catch {
                /* already stopped */
            }
        }
    }

    private createSource(ctx: AudioContext, t: number, duration: number, midi: number): AudioBufferSourceNode {
        if (this.samplesLoaded && this.samples.length > 0) {
            return this.createSampleSource(ctx, t, duration, midi)
        }
        return this.createOscillatorSource(ctx, t, duration, midi)
    }

    private createSampleSource(ctx: AudioContext, t: number, duration: number, midi: number): AudioBufferSourceNode {
        let bestSample = this.samples[0]
        let bestDist = Math.abs(midi - bestSample.midi)
        for (const s of this.samples) {
            const dist = Math.abs(midi - s.midi)
            if (dist < bestDist) {
                bestSample = s
                bestDist = dist
            }
        }

        const source = ctx.createBufferSource()
        source.buffer = bestSample.buffer
        source.detune.value = (midi - bestSample.midi) * 100

        const gain = ctx.createGain()
        const attack = 0.005
        const release = Math.min(0.08, duration * 0.15)

        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.5, t + attack)
        gain.gain.setValueAtTime(0.5, t + duration - release)
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration)

        source.connect(gain).connect(ctx.destination)
        source.start(t)
        source.stop(t + duration + 0.01)

        return source
    }

    private createOscillatorSource(ctx: AudioContext, t: number, duration: number, midi: number): AudioBufferSourceNode {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()

        osc.type = 'triangle'
        osc.frequency.value = midiToFrequency(midi)

        const attack = 0.01
        const release = Math.min(0.05, duration * 0.15)

        gain.gain.setValueAtTime(0, t)
        gain.gain.linearRampToValueAtTime(0.25, t + attack)
        gain.gain.setValueAtTime(0.25, t + duration - release)
        gain.gain.linearRampToValueAtTime(0, t + duration)

        osc.connect(gain).connect(ctx.destination)
        osc.start(t)
        osc.stop(t + duration + 0.01)

        return osc as unknown as AudioBufferSourceNode
    }
}
