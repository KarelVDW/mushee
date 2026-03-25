import type { Note } from '@/model/Note'
import type { Pitch } from '@/model/Pitch'
import type { Score } from '@/model/Score'

// --- Constants ---

const DEFAULT_BPM = 90
const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Piano samples with their native MIDI note numbers */
const PIANO_SAMPLES: { url: string; midi: number }[] = [
    { url: '/samples/piano/piano-fs2.mp3', midi: 42 },  // F#2
    { url: '/samples/piano/piano-a2.mp3', midi: 45 },   // A2
    { url: '/samples/piano/piano-c4-iowa.mp3', midi: 60 }, // C4
    { url: '/samples/piano/piano-bb4-iowa.mp3', midi: 70 }, // Bb4
]

// --- Helpers ---

function pitchToMidi(pitch: Pitch): number {
    return (pitch.octave + 1) * 12 + (SEMITONES[pitch.name] ?? 0) + pitch.alter
}

function midiToFrequency(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12)
}

// --- Types ---

export interface PlaybackPosition {
    measureIndex: number
    beat: number
}

interface TimelineEntry {
    startTime: number
    duration: number
    beatSpan: number
    midi?: number          // undefined = rest or tied-from-previous
    audioDuration?: number // for tie chains, longer than visual duration
    measureIndex: number
    beat: number
}

interface LoadedSample {
    buffer: AudioBuffer
    midi: number
}

// --- PlaybackEngine ---

export class PlaybackEngine {
    private audioCtx: AudioContext | null = null
    private sourceNodes: AudioBufferSourceNode[] = []
    private startOffset = 0
    private totalDuration = 0
    private timeline: TimelineEntry[] = []
    private _isPlaying = false
    private animationId = 0
    private cursorEl: SVGRectElement | null = null
    private resolvePosition: ((pos: PlaybackPosition) => { x: number; rowY: number } | null) | null = null
    private onFinish: (() => void) | null = null
    private samples: LoadedSample[] = []
    private samplesLoaded = false

    get isPlaying() {
        return this._isPlaying
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

    play(
        score: Score,
        cursorEl: SVGRectElement,
        resolvePosition: (pos: PlaybackPosition) => { x: number; rowY: number } | null,
        onFinish: () => void,
    ) {
        this.stop()
        this.cursorEl = cursorEl
        this.resolvePosition = resolvePosition
        this.onFinish = onFinish

        this.audioCtx = new AudioContext()
        this.timeline = this.buildTimeline(score)
        if (this.timeline.length === 0) return

        const lastEntry = this.timeline[this.timeline.length - 1]
        this.totalDuration = lastEntry.startTime + lastEntry.duration
        this.startOffset = this.audioCtx.currentTime
        this._isPlaying = true

        // Schedule all notes
        for (const entry of this.timeline) {
            if (entry.midi !== undefined) {
                const dur = entry.audioDuration ?? entry.duration
                this.scheduleNote(entry.startTime, dur, entry.midi)
            }
        }

        this.animationId = requestAnimationFrame(this.tick)
    }

    stop() {
        this._isPlaying = false
        if (this.animationId) {
            cancelAnimationFrame(this.animationId)
            this.animationId = 0
        }

        for (const src of this.sourceNodes) {
            try {
                src.stop()
                src.disconnect()
            } catch {
                /* already stopped */
            }
        }
        this.sourceNodes = []

        if (this.audioCtx) {
            this.audioCtx.close().catch(() => {})
            this.audioCtx = null
        }

        if (this.cursorEl) this.cursorEl.setAttribute('display', 'none')
        this.cursorEl = null
        this.resolvePosition = null
    }

    // --- Audio scheduling ---

    private scheduleNote(startTime: number, duration: number, midi: number) {
        const ctx = this.audioCtx
        if (!ctx) return
        const t = this.startOffset + startTime

        if (this.samplesLoaded && this.samples.length > 0) {
            this.scheduleSample(ctx, t, duration, midi)
        } else {
            this.scheduleOscillator(ctx, t, duration, midi)
        }
    }

    private scheduleSample(ctx: AudioContext, t: number, duration: number, midi: number) {
        // Find the closest sample by MIDI note
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
        // Detune to match the requested pitch (100 cents per semitone)
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

        this.sourceNodes.push(source)
    }

    private scheduleOscillator(ctx: AudioContext, t: number, duration: number, midi: number) {
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

        // Store as AudioBufferSourceNode[] — OscillatorNode has same stop/disconnect API
        this.sourceNodes.push(osc as unknown as AudioBufferSourceNode)
    }

    // --- Animation ---

    private tick = () => {
        if (!this._isPlaying || !this.audioCtx) return

        const elapsed = this.audioCtx.currentTime - this.startOffset

        if (elapsed >= this.totalDuration) {
            this._isPlaying = false
            cancelAnimationFrame(this.animationId)
            this.animationId = 0
            if (this.cursorEl) this.cursorEl.setAttribute('display', 'none')

            // Clean up audio nodes
            for (const src of this.sourceNodes) {
                try { src.disconnect() } catch { /* ok */ }
            }
            this.sourceNodes = []
            if (this.audioCtx) {
                this.audioCtx.close().catch(() => {})
                this.audioCtx = null
            }

            this.onFinish?.()
            return
        }

        const pos = this.getPositionAtTime(elapsed)
        if (pos && this.cursorEl && this.resolvePosition) {
            const resolved = this.resolvePosition(pos)
            if (resolved) {
                this.cursorEl.setAttribute('x', String(resolved.x - 1.5))
                this.cursorEl.setAttribute('transform', `translate(0, ${resolved.rowY})`)
                this.cursorEl.setAttribute('display', '')
            }
        }

        this.animationId = requestAnimationFrame(this.tick)
    }

    private getPositionAtTime(elapsed: number): PlaybackPosition | null {
        let current: TimelineEntry | null = null
        for (let i = this.timeline.length - 1; i >= 0; i--) {
            if (this.timeline[i].startTime <= elapsed) {
                current = this.timeline[i]
                break
            }
        }
        if (!current) return null

        const progress = Math.min(1, (elapsed - current.startTime) / current.duration)
        const beat = current.beat + current.beatSpan * progress

        return { measureIndex: current.measureIndex, beat }
    }

    // --- Timeline construction ---

    private buildTimeline(score: Score): TimelineEntry[] {
        const entries: TimelineEntry[] = []
        let time = 0
        let bpm = DEFAULT_BPM

        for (const measure of score.measures) {
            // Check for tempo at start of measure (beat 0) before iterating notes
            const tempoAtStart = measure.tempoAtBeat(0)
            if (tempoAtStart) bpm = tempoAtStart.bpm

            for (const note of measure.notes) {
                const beat = measure.beatOffsetOf(note)

                // Check for tempo changes at this beat
                if (beat > 0) {
                    const tempo = measure.tempoAtBeat(beat)
                    if (tempo) bpm = tempo.bpm
                }

                const beatSpan = note.duration.effectiveBeats
                const durationSecs = (beatSpan * 60) / bpm

                // Determine MIDI note (skip rests and tied-from-previous notes)
                let midi: number | undefined
                if (note.pitch && !note.tiesBack) {
                    midi = pitchToMidi(note.pitch)
                }

                // For tie chains, extend audio duration
                let audioDuration: number | undefined
                if (midi !== undefined && note.tiesForward) {
                    audioDuration = this.getTiedAudioDuration(note, durationSecs, bpm)
                }

                entries.push({
                    startTime: time,
                    duration: durationSecs,
                    beatSpan,
                    midi,
                    audioDuration,
                    measureIndex: measure.index,
                    beat,
                })

                time += durationSecs
            }
        }

        return entries
    }

    private getTiedAudioDuration(note: Note, baseDuration: number, bpm: number): number {
        let total = baseDuration
        let current: Note | null = note
        while (current?.tiesForward) {
            const next = current.getNext()
            if (!next) break
            total += (next.duration.effectiveBeats * 60) / bpm
            current = next
        }
        return total
    }
}
