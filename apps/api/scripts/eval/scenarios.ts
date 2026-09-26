import type { Condition, Scenario } from './types'

/**
 * The evaluation matrix. Roots are chosen to place each melody in the source's
 * natural register — and, for the known-broken cases, deliberately at the
 * extremes the current pipeline mishandles:
 *   - whistle-high (~2 kHz) sits far above the old 1100 Hz ceiling
 *   - voice-bass (~85 Hz) sits at/under the old 80 Hz highpass + 65 Hz floor
 *   - voice-soprano-high / piccolo push the upper ceiling
 * trumpet-mid is the known-good control that must not regress.
 *
 * GM programs mirror apps/web Instrument.gmProgram values.
 */
export const SCENARIOS: Scenario[] = [
    // --- Instruments (rendered via FluidR3_GM) ---
    { id: 'trumpet-mid', label: 'Trumpet (mid, control)', kind: 'instrument', gmProgram: 56, instrumentId: 'trumpet', rootMidi: 60 },
    { id: 'trombone-low', label: 'Trombone (low brass)', kind: 'instrument', gmProgram: 57, instrumentId: 'trombone', rootMidi: 48 },
    { id: 'tuba-verylow', label: 'Tuba (very low)', kind: 'instrument', gmProgram: 58, instrumentId: 'tuba', rootMidi: 36 },
    { id: 'flute-high', label: 'Flute (high)', kind: 'instrument', gmProgram: 73, instrumentId: 'flute', rootMidi: 72 },
    { id: 'clarinet-mid', label: 'Clarinet (mid)', kind: 'instrument', gmProgram: 71, instrumentId: 'clarinet', rootMidi: 55 },
    { id: 'oboe-high', label: 'Oboe (high)', kind: 'instrument', gmProgram: 68, instrumentId: 'oboe', rootMidi: 72 },
    { id: 'bassoon-low', label: 'Bassoon (low double reed)', kind: 'instrument', gmProgram: 70, instrumentId: 'bassoon', rootMidi: 46 },
    { id: 'violin-high', label: 'Violin (high strings)', kind: 'instrument', gmProgram: 40, instrumentId: 'violin', rootMidi: 72 },
    { id: 'cello-low', label: 'Cello (low strings)', kind: 'instrument', gmProgram: 42, instrumentId: 'cello', rootMidi: 48 },
    { id: 'piccolo-veryhigh', label: 'Piccolo (very high)', kind: 'instrument', gmProgram: 72, instrumentId: 'piccolo', rootMidi: 84 },
    { id: 'harmonica-mid', label: 'Harmonica (free reed)', kind: 'instrument', gmProgram: 22, instrumentId: 'harmonica', rootMidi: 60 },

    // --- Voice (synthesized proxy, bass -> soprano) ---
    { id: 'voice-bass', label: 'Voice — bass', kind: 'voice', instrumentId: 'voice-lead', rootMidi: 41 },
    { id: 'voice-tenor', label: 'Voice — tenor', kind: 'voice', instrumentId: 'voice-lead', rootMidi: 50 },
    { id: 'voice-alto', label: 'Voice — alto', kind: 'voice', instrumentId: 'voice-lead', rootMidi: 57 },
    { id: 'voice-soprano', label: 'Voice — soprano (high)', kind: 'voice', instrumentId: 'voice-lead', rootMidi: 74 },

    // --- Whistling (synthesized proxy) ---
    // Articulation-stratified voice tier. One register (alto) × four articulations,
    // sharing `voice-alto`'s root so all five carry BYTE-IDENTICAL ground truth and
    // the only variable is the acoustics — articulation is the thing that decides
    // voice accuracy (Li et al. 2021 measured a 19-point spread across it), so it is
    // the thing worth isolating.
    //
    // These are also the only clips whose AUDIO realises a re-onset — continuous
    // voicing across a repeated pitch. Note the distinction: every synthetic melody's
    // *truth* has always contained re-onsets (7 per scenario, from the repeated notes
    // in `tune`/`rhythm`), but `synthesize` detaches every note by `gapSec` = 40 ms,
    // so the rendered audio silently disagrees with its own labels and those onsets
    // arrive as trivially easy silence-onsets. That is why `voice-alto` scores
    // re-onset recall 1.000 and means nothing by it. Left as-is rather than fixed:
    // closing the gap would change the bytes of every clip in the standing corpus and
    // invalidate the numbers in the findings log, and the articulated synthesizer
    // (which honours the truth's timing) is the supported way to get real ones.
    {
        id: 'voice-plosive',
        label: 'Voice — "ta-ta-ta" (plosive)',
        kind: 'voice',
        instrumentId: 'voice-lead',
        articulation: 'plosive',
        rootMidi: 57,
    },
    {
        id: 'voice-continuant',
        label: 'Voice — "la-la-la" (continuant)',
        kind: 'voice',
        instrumentId: 'voice-lead',
        articulation: 'continuant',
        rootMidi: 57,
    },
    { id: 'voice-hum', label: 'Voice — closed-mouth hum', kind: 'voice', instrumentId: 'voice-lead', articulation: 'hum', rootMidi: 57 },
    {
        id: 'voice-legato',
        label: 'Voice — sustained legato vowel',
        kind: 'voice',
        instrumentId: 'voice-lead',
        articulation: 'vowel',
        rootMidi: 57,
    },

    { id: 'whistle-mid', label: 'Whistle (mid ~1 kHz)', kind: 'whistle', rootMidi: 84 },
    { id: 'whistle-high', label: 'Whistle (high ~1.5-3 kHz)', kind: 'whistle', rootMidi: 90 },
]

/**
 * Degradation conditions, in two tiers. The first three are moderate — a clean
 * take, a roomy/condenser mic, a noisy band-limited phone mic. The adverse
 * tier models the real-world circumstances users actually record in (an
 * echoey room, a windy backdrop, street chatter, a phone across the room):
 * hard, but every note is still clearly audible to a human listener.
 */
export const CONDITIONS: Condition[] = [
    { id: 'clean', label: 'Clean' },
    {
        id: 'room-mic',
        label: 'Room + condenser mic',
        noise: { color: 'pink', amplitude: 0.004 },
        postFilter: 'aecho=0.8:0.7:35:0.2,highpass=f=90,lowpass=f=9000',
    },
    {
        id: 'noisy-phone',
        label: 'Noisy phone mic',
        // Pink noise is low-frequency-dominant; kept moderate so a clearly-audible
        // note still sits above the floor ("relative quality" input), rather than
        // masking low fundamentals entirely.
        noise: { color: 'pink', amplitude: 0.012 },
        postFilter: 'highpass=f=85,lowpass=f=7000',
    },

    // --- Adverse tier ---
    {
        id: 'echoey-room',
        label: 'Echoey room (RT60 0.9 s)',
        // Genuine reverberation (impulse-response convolution), unlike room-mic's
        // single slapback tap: onsets smear, offsets ring into the next note.
        ir: { rt60Sec: 0.9, wetDb: -2, preDelayMs: 15 },
        noise: { color: 'pink', amplitude: 0.003 },
        // volume pad: direct+wet peaks would clip the s16 output otherwise
        postFilter: 'volume=-7dB,highpass=f=60,lowpass=f=11000',
    },
    {
        id: 'wind-outdoor',
        label: 'Windy backdrop (gusts)',
        // Gusty low-frequency-dominant wind at the mic; the killer for low
        // registers, and gusts fool amplitude-based onset detection.
        noiseBed: { kind: 'wind', gainDb: -8 },
        postFilter: 'highpass=f=25',
    },
    {
        id: 'street-noise',
        label: 'Street / chatter backdrop',
        // Speech-shaped babble sits exactly in the voice band — the hardest
        // masker for sung input.
        noiseBed: { kind: 'speech', gainDb: -14 },
        noise: { color: 'pink', amplitude: 0.003 },
    },
    {
        id: 'distant-mic',
        label: 'Distant mic in live room',
        // Wet-dominant reverb + noise floor + air absorption: a phone recording
        // from across an untreated room.
        ir: { rt60Sec: 1.3, wetDb: 4, preDelayMs: 25 },
        noise: { color: 'pink', amplitude: 0.006 },
        postFilter: 'volume=-11dB,lowpass=f=8000',
    },

    // --- Capture-path tier: the codec the product actually records through ------
    // Every number in this harness is measured on WAV; no user ever sends us one.
    // The browser's MediaRecorder gives us webm/Opus (Chrome, Edge, Firefox) or
    // mp4/AAC (Safari), and `probe-realpath.ts` probes that path with no truth
    // behind it. These conditions put it on the scored corpus instead: the codec
    // round trip cannot move a note, so the clip's existing ground truth still
    // applies exactly. Opt-in — `DEGRADE_CONDITIONS=phone-opus-96k,…` — because
    // they multiply corpus runtime like any other condition.
    //
    // Bitrates bracket what browsers actually negotiate: ~96 kbps is the common
    // MediaRecorder default for mono Opus, 32 kbps is a constrained connection,
    // and 16 kbps is where Opus starts band-limiting hard — which matters more for
    // whistling (1–3 kHz fundamentals) than for any other input we take.
    {
        id: 'phone-opus-96k',
        label: 'webm/Opus 96 kbps (browser default)',
        codec: { container: 'webm', encoder: 'libopus', bitrateKbps: 96 },
    },
    {
        id: 'phone-opus-32k',
        label: 'webm/Opus 32 kbps (constrained)',
        codec: { container: 'webm', encoder: 'libopus', bitrateKbps: 32 },
    },
    {
        id: 'phone-opus-16k',
        label: 'webm/Opus 16 kbps (band-limiting)',
        codec: { container: 'webm', encoder: 'libopus', bitrateKbps: 16 },
    },
    {
        id: 'phone-aac-64k',
        label: 'mp4/AAC 64 kbps (Safari path)',
        codec: { container: 'mp4', encoder: 'aac', bitrateKbps: 64 },
    },

    // --- R20 intonation tier (Deep Autotuner's synthetic de-tuning, §14.3) ---
    // The performer's error, not the room's: every note exactly N cents off with
    // a random sign, clean acoustics, truth = the notes the singer INTENDED.
    // Fixed magnitude rather than the synth's Gaussian scatter so the dose is
    // controlled; `intonation-0c` (scatterless) is the tier's own baseline —
    // deliberately not `clean`, whose articulated renders carry the 19 ¢ scatter.
    // Rendered for articulated voice scenarios only; ±100 ¢ stays the outer
    // bound and 20–60 ¢ is where spelling decisions actually flip.
    { id: 'intonation-0c', label: 'Intonation ±0 ¢ (tier baseline)', detuneCents: 0 },
    { id: 'intonation-20c', label: 'Intonation ±20 ¢ per note', detuneCents: 20 },
    { id: 'intonation-40c', label: 'Intonation ±40 ¢ per note', detuneCents: 40 },
    { id: 'intonation-60c', label: 'Intonation ±60 ¢ per note', detuneCents: 60 },
    { id: 'intonation-80c', label: 'Intonation ±80 ¢ per note', detuneCents: 80 },
]
