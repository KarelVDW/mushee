/**
 * Shared types for the recording-pipeline evaluation harness.
 *
 * A "melody" is register-agnostic: a list of notes expressed as semitone
 * offsets from a root, with a length in beats. Concrete audio is produced by
 * transposing the melody to a target root MIDI note (`Scenario.rootMidi`) and
 * either rendering it through a soundfont (instruments) or synthesizing it
 * directly (voice / whistle).
 */

/** One note of a melody, relative to the melody's root. */
export interface MelodyNote {
    /** Semitone offset from the scenario root. */
    degree: number
    /** Length in beats. */
    beats: number
}

export interface Melody {
    name: string
    bpm: number
    notes: MelodyNote[]
}

/** A concrete, absolute-pitch note with timing in seconds. */
export interface TruthNote {
    onsetSec: number
    durSec: number
    /** Absolute MIDI pitch (concert / sounding). */
    midi: number
}

/** Ground truth for one rendered clip. */
export interface GroundTruth {
    bpm: number
    notes: TruthNote[]
    /**
     * Independent annotations of the same clip; an estimate is scored against
     * whichever it matches best, because disagreement between annotators is
     * stylistic, not error. (vocadito's two annotators differ mainly on whether
     * an ornament is its own note or part of the note it decorates — either
     * reading is a transcription a musician would accept, so penalising the
     * pipeline for picking the other one measures nothing.) Scored via
     * `scoreNotesBest` in lib/metrics.ts; plain `scoreNotes` ignores it.
     */
    alternateNotes?: TruthNote[][]
    /**
     * A manually annotated beat axis for the clip: `timeSec` is when a beat is
     * heard, `beat` is its position in quarter-note beats from the piece's beat 0
     * (negative for an anacrusis).
     *
     * Why this exists separately from `bpm`: `bpm` is one scalar, which can only
     * describe a *constant* tempo. A performance with real rubato — a choir
     * following a conductor, ritardando into a cadence — has no such scalar, and
     * pushing its notes through one misplaces every beat after the first tempo
     * change. Where a corpus ships a hand-annotated grid (Dagstuhl ChoirSet:
     * tapped in Sonic Visualiser, then reviewed by a second annotator), the grid
     * IS the reference beat axis and `lib/notation.ts`'s `truthToBeats` uses it
     * in preference to `bpm`. `bpm` remains set — to the clip's median local
     * tempo — because the rest of the harness (and the pipeline's quantizer)
     * still needs a single number.
     */
    beatGrid?: { timeSec: number; beat: number }[]
}

/** How a scenario's audio is produced. */
export type SourceKind = 'instrument' | 'voice' | 'whistle'

import type { Articulation } from './lib/synth'

export type { Articulation }

export interface Scenario {
    /** Stable id, used as the output directory name. */
    id: string
    /** Human label for reports. */
    label: string
    kind: SourceKind
    /**
     * How the singer separates notes (voice scenarios only). Set on the
     * articulation-stratified tier; absent means the original continuous-vowel
     * proxy, which has no consonants and therefore cannot produce a re-onset at all.
     * See `lib/synth.ts` for why this is the dominant variable for voice.
     */
    articulation?: Articulation
    /** MIDI note the melody's degree 0 maps to (sets the register). */
    rootMidi: number
    /** General MIDI program (0-indexed) — instruments only. */
    gmProgram?: number
    /** Optional instrument id hint, mirrors the web app's Instrument.id. */
    instrumentId?: string
}

/** A degradation condition applied to a clean clip via ffmpeg. */
export interface Condition {
    id: string
    label: string
    /** Added background noise. Omit for a clean condition. */
    noise?: { color: 'pink' | 'white'; amplitude: number }
    /**
     * Room reverberation: convolve with a synthetic impulse response
     * (lib/acoustics.ts) via ffmpeg `afir` — applied to the source BEFORE any
     * noise is mixed in (the room reverberates the performance; wind/babble
     * arrive at the microphone).
     */
    ir?: { rt60Sec: number; wetDb: number; preDelayMs?: number }
    /**
     * A synthesized noise bed (lib/acoustics.ts) mixed at `gainDb` relative to
     * the loudness-normalized source (≈ -SNR in dB).
     */
    noiseBed?: { kind: 'wind' | 'speech'; gainDb: number }
    /**
     * ffmpeg `-af` chain applied AFTER loudnorm (and after reverb/noise mixing,
     * if any): mic EQ coloration, band-limiting. Empty = none.
     */
    postFilter?: string
    /**
     * Re-encode the finished clip through a lossy CODEC and decode it back, so the
     * eval can score the path the product actually captures on: the browser's
     * MediaRecorder hands us webm/Opus (Chrome/Edge/Firefox) or mp4/AAC (Safari),
     * never WAV. Applied LAST — after loudnorm, room, noise and mic EQ — because
     * that is the physical order: the codec sees whatever reached the microphone.
     *
     * This is the one condition family whose ground truth needs no annotation
     * work: a codec round trip does not move the notes, so every clip's existing
     * truth still applies. `probe-realpath.ts` covers the same ground for the
     * streaming path but has no truth behind it; this puts the codec on the
     * scored corpus. Verify the round trip is sample-aligned before trusting any
     * onset-bias number from it (measured: see the findings log).
     */
    codec?: { container: string; encoder: string; bitrateKbps: number }
    /**
     * R20 intonation tier: per-note detune of exactly this magnitude (cents,
     * random sign per note), applied at the SYNTHESIZER — not an audio
     * degradation — with clean acoustics and the written notes as ground truth.
     * Rendered only for articulated voice scenarios; `generate.ts` skips every
     * other scenario, and `degrade-real.ts` must never select these (real-audio
     * per-note detuning is parked behind this tier's gate).
     */
    detuneCents?: number
}
