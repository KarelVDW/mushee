import { Logger } from '@nestjs/common';
import type { NoteEventTime } from './note-event';

import type { RecordingArchiver } from '../recording-archiver';
import { AudioConverter } from './audio-converter';
import { AudioDecoder, StreamingDecoder } from './audio-decoder';
import type { MxmlMeasure } from './mxml.types';
import { MxmlBuilder, PendingNote } from './mxml-builder';
import { ExtractedNotes } from './note-extractor';
import { DEFAULT_PROFILE, type PipelineProfile } from './profiles/pipeline-profile';
import { ProfileResolver } from './profiles/profile-resolver';
import type { PitchTranscribeOptions } from './providers/pitch-provider';
import { ProviderRegistry } from './providers/provider-registry';
import { RecordingDebugRenderer } from './recording-debug-renderer';

const DEFAULT_BPM = 120;
const DEFAULT_BEATS = 4;
const DEFAULT_BEAT_TYPE = 4;
// Pass cadence. Overridable so eval harnesses can drive many incremental passes
// without waiting in real time; unset in production, where it stays 1 s.
const DEBOUNCE_MS = Number(process.env.RECORDING_DEBOUNCE_MS) || 1000;
/**
 * OFFSET-confirmation margin (E5/R12): a note is committed once this much
 * audio exists past its END — the streaming analogue of Essentia Pitch2Midi's
 * note-off confirmation (its default is 200 ms; ours has been 400 ms). The
 * same margin bounds how far a later window may reach back, so it is the
 * commit-latency knob. Env-overridable so `check-streaming.ts` can measure
 * where paced-feed commits start to contradict the whole-buffer result.
 * (R12's asymmetric ONSET confirmation has no analogue here: our commit unit
 * is a whole note, so an onset is never committed before its offset. And its
 * delay compensation does not apply either — we report measured note times,
 * not confirmation times; R7 calibrated the reported-time bias at 0.)
 */
const STABLE_MARGIN_SEC = Number(process.env.RECORDING_STABLE_MARGIN_SEC) || 0.4;
/**
 * Lead-in of already-seen audio prepended to each windowed transcription pass
 * (stateless providers only). basic-pitch — removed 2026-08-22 but the seam
 * stays for any future note-level provider — ran 2 s analysis windows internally,
 * so a region's notes match a whole-buffer run only when enough real audio
 * precedes it; combined with snapping the window start to the provider's block
 * grid (`windowAlignSamples`), 3.5 s reproduces the whole-buffer result on the
 * eval corpus. Committed notes sit inside this lead-in.
 */
const CONTEXT_SEC = 3.5;
/** Sample rate / high-pass for the coarse detection decode that picks a profile. */
const DETECT_SAMPLE_RATE = 16000;
const DETECT_HIGHPASS_HZ = 30;
/** Minimum audio before we trust the pitch scan enough to lock a profile. */
const DETECT_MIN_SEC = 1.2;
/**
 * How long to keep waiting for PITCHED audio before accepting the unvoiced
 * fallback profile. The scan of a prefix that holds no reliable pitch — the
 * performer breathing, a late start after the count-in, a spoken word — used to
 * lock `default-wide` for the whole take: a 55–1900 Hz window with no register
 * band, no reverb relief, and (for whistling) a ceiling under the material. The
 * eval census found this fallback on 188 real adverse clips plus every take with
 * an unscannable lead-in, and measured that NO provider transcribes anything
 * through it (COnP ≈ 0.001). Waiting for the first pitched second costs the user
 * nothing visible — no notes exist to emit before then — so the lock now waits
 * up to this long; past it (or on the final pass) the fallback is accepted, and
 * the final pass re-resolves it over the whole take (see `process`).
 */
const DETECT_MAX_WAIT_SEC = envNumber('RECORDING_DETECT_MAX_WAIT_SEC', 8);
/**
 * Kill-switch for the final-pass re-route of a fallback-locked take
 * (`RECORDING_FINAL_REROUTE=0`). Together with `RECORDING_DETECT_MAX_WAIT_SEC=0`
 * this reproduces the pre-2026-09 lock behaviour exactly — the A/B the
 * `probe-leadin.ts` harness measures, and production's rollback.
 */
const FINAL_REROUTE = process.env.RECORDING_FINAL_REROUTE !== '0';

/** Numeric env override; `0` is a legitimate value (unlike `Number(x) || d`). */
function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

/** The resolver's "no reliable pitch in this audio" outcome, with or without a hint. */
function isFallbackProfile(profile: PipelineProfile): boolean {
  return profile.id === DEFAULT_PROFILE.id || profile.id.startsWith(`${DEFAULT_PROFILE.id}+`);
}

export interface ScoreUpdate {
  measures: Record<number, MxmlMeasure>;
}

/**
 * How the locked profile decided what is at the microphone. Emitted once per
 * session so the client can show the user what the pipeline believes it is
 * hearing — a mis-routed take is invisible otherwise, and the user is the one
 * person who knows the truth.
 */
export interface SourceResolution {
  source: 'voice' | 'instrument';
  decidedBy: 'explicit' | 'classifier' | 'prior';
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One pipeline per recording session. Audio is decoded once, incrementally, by a
 * long-lived `StreamingDecoder` (each byte decoded exactly once into a growing
 * PCM buffer) rather than by re-decoding the whole container every pass.
 * Periodically it runs the configured `AudioConverter` and emits MxmlMeasure
 * deltas as notes settle.
 *
 * Per-pass transcription is bounded too: stateless providers (none currently) are
 * fed only a trailing window of PCM — committed audio is never re-sent — while
 * providers that cache across passes (CREPE) get the whole buffer and stay
 * incremental internally. Together this makes per-pass work proportional to the
 * new audio, not the total recording length.
 */
export class RecordingPipeline {
  private readonly logger = new Logger(RecordingPipeline.name);
  private readonly decoder = new AudioDecoder();

  private readonly chunks: Buffer[] = [];
  private chunkBytes = 0;
  private readonly emittedNotes: PendingNote[] = [];
  private readonly emittedKeys = new Set<string>();
  private lastRawNotes: NoteEventTime[] = [];
  private lastDuration = 0;
  private archived = false;
  // Set by the session once its recording row exists; archives the encoded
  // audio (streamed chunk-by-chunk) and the debug bundle to blob storage.
  private archiver: RecordingArchiver | null = null;

  // Long-lived decode for this session, spawned once the profile (and thus the
  // sample rate / high-pass / loudnorm) is locked. Null until then.
  private streamDecoder: StreamingDecoder | null = null;
  // Watermark (absolute seconds): notes ending before this are already emitted
  // and frozen, so windowed passes never need to reprocess audio before it.
  private committedSec = 0;
  // Highest measure index emitted so far, and the first index never emitted — used
  // to fill in bars the performer rested through (see affectedMeasures).
  private lastEmittedMeasure = -1;
  private firstUnemittedMeasure = 0;
  // Set when the final pass re-routed the take (see `rerouteFinal`): everything
  // emitted so far came from the wrong profile, so the final emission must
  // rebuild every measure — including ones that end up empty.
  private reemitAll = false;
  // Earliest onset (absolute seconds) of a note seen last pass that wasn't yet
  // committed (still within the stable margin or extending past it). The next
  // window backs up to include it so a long sustained note's onset is never cut.
  private uncommittedFromSec = Infinity;

  private readonly timings = {
    firstChunkAt: 0,
    firstDecodeAt: 0,
    firstUpdateAt: 0,
    processCount: 0,
    processTotalMs: 0,
    processMaxMs: 0,
  };

  private bpm = DEFAULT_BPM;
  private beats = DEFAULT_BEATS;
  private beatType = DEFAULT_BEAT_TYPE;
  private chromaticTranspose = 0;
  // Key signature at the recording start (fifths), for voice pitch spelling.
  private keyFifths: number | null = null;
  private builder = new MxmlBuilder({
    bpm: this.bpm,
    beats: this.beats,
    beatType: this.beatType,
    chromaticTranspose: this.chromaticTranspose,
  });

  private processing = false;
  private rerunRequested = false;
  private finalRequested = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private onUpdate: (update: ScoreUpdate) => void = () => {};
  private onSourceResolved: (resolution: SourceResolution) => void = () => {};

  // Resolved once, from the first ~1.2 s of audio (or on finalize), then locked
  // for the session: which provider runs and with what frequency window /
  // high-pass / thresholds. `converter` is built to match the chosen provider.
  private profile: PipelineProfile | null = null;
  private converter: AudioConverter | null = null;
  private instrumentHint: string | undefined;
  // Explicit "what are you recording?" choice from the client, when it made one.
  // Overrides the score's instrument as the voice-routing signal.
  private sourceKind: 'voice' | 'instrument' | undefined;
  // ffmpeg input-format hint derived from the client's negotiated MIME type.
  // Undefined (unknown type / no meta) means ffmpeg probes the container.
  private inputFormat: string | undefined;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly resolver: ProfileResolver,
  ) {}

  setMeta(meta: {
    bpm?: number;
    timeSignature?: { beats: number; beatType: number } | null;
    chromaticTranspose?: number;
    instrumentId?: string;
    sourceKind?: 'voice' | 'instrument' | null;
    keyFifths?: number | null;
    mimeType?: string | null;
  }): void {
    if (meta.bpm) this.bpm = meta.bpm;
    if (meta.timeSignature) {
      this.beats = meta.timeSignature.beats;
      this.beatType = meta.timeSignature.beatType;
    }
    if (typeof meta.chromaticTranspose === 'number') {
      this.chromaticTranspose = meta.chromaticTranspose;
    }
    if (meta.instrumentId) this.instrumentHint = meta.instrumentId;
    if (meta.sourceKind === 'voice' || meta.sourceKind === 'instrument') {
      this.sourceKind = meta.sourceKind;
    }
    if (typeof meta.keyFifths === 'number') this.keyFifths = meta.keyFifths;
    if (typeof meta.mimeType === 'string') {
      this.inputFormat = AudioDecoder.inputFormatFor(meta.mimeType);
    }
    this.builder = new MxmlBuilder({
      bpm: this.bpm,
      beats: this.beats,
      beatType: this.beatType,
      chromaticTranspose: this.chromaticTranspose,
      keyFifths: this.keyFifths,
    });
    // The builder is rebuilt on meta, but the routing decision (voice spelling
    // on the take's own tuning grid) belongs to the locked profile.
    this.builder.setVoiceSpelling(this.profile?.isVoice ?? false);
  }

  setOnUpdate(cb: (update: ScoreUpdate) => void): void {
    this.onUpdate = cb;
  }

  setOnSourceResolved(cb: (resolution: SourceResolution) => void): void {
    this.onSourceResolved = cb;
  }

  setArchiver(archiver: RecordingArchiver): void {
    this.archiver = archiver;
  }

  appendChunk(buffer: Buffer): void {
    if (!this.timings.firstChunkAt) this.timings.firstChunkAt = Date.now();
    this.chunkBytes += buffer.byteLength;
    // Stream the encoded audio to storage as it arrives — never buffered
    // toward a whole-take upload, so memory stays flat for any take length.
    this.archiver?.appendAudio(buffer);
    // The encoded stream is kept for the whole session: it seeds the decoder
    // (container header first) and it is what the final pass re-decodes when it
    // has to re-route a take whose prefix held no pitch (`rerouteFinal`). Cheap —
    // a few MB per hour at browser Opus bitrates.
    this.chunks.push(buffer);
    // Once the decoder is live, forward each chunk straight into it so the byte
    // is decoded once. Chunks buffered before the decoder spawned are fed in one
    // shot at spawn time (see `process`), so this only ever runs for new audio.
    this.streamDecoder?.write(buffer);
    this.scheduleProcess();
  }

  /** Seconds of audio decoded so far — the session's billing meter reads this. */
  get audioDurationSec(): number {
    return this.streamDecoder?.durationSec ?? 0;
  }

  async finalize(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.finalRequested = true;
    await this.kick();
    await this.archive();
    this.logTimings();
  }

  private scheduleProcess(): void {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.kick();
    }, DEBOUNCE_MS);
  }

  private async kick(): Promise<void> {
    if (this.processing) {
      this.rerunRequested = true;
      return;
    }
    this.processing = true;
    try {
      do {
        this.rerunRequested = false;
        const isFinal = this.finalRequested;
        if (isFinal) this.finalRequested = false;
        const start = Date.now();
        try {
          await this.process(isFinal);
        } catch (err) {
          this.logger.warn(`Process pass failed: ${describeError(err)}`);
          if (err instanceof Error && err.stack) {
            this.logger.warn(err.stack);
          }
        }
        const elapsed = Date.now() - start;
        this.timings.processCount += 1;
        this.timings.processTotalMs += elapsed;
        if (elapsed > this.timings.processMaxMs) {
          this.timings.processMaxMs = elapsed;
        }
      } while (this.rerunRequested || this.finalRequested);
    } finally {
      this.processing = false;
    }
  }

  private async process(isFinal: boolean): Promise<void> {
    if (!this.chunkBytes) return;

    const tStart = Date.now();

    // Lock the adaptive profile (provider + frequency window + high-pass) from
    // the first audio before doing any real transcription. Until it resolves we
    // emit nothing — the first real emission lands shortly after, invisible to
    // the user.
    if (!this.converter || !this.profile) {
      await this.resolveProfile(Buffer.concat(this.chunks), isFinal);
    } else if (
      isFinal &&
      FINAL_REROUTE &&
      isFallbackProfile(this.profile) &&
      this.streamDecoder
    ) {
      // The take was locked on the unvoiced fallback (a lead-in longer than
      // DETECT_MAX_WAIT_SEC). Now that the whole take exists, ask the resolver
      // again — a real register band beats a blind window every time.
      await this.rerouteFinal();
    }
    const converter = this.converter;
    const profile = this.profile;
    if (!converter || !profile) return;
    const provider = converter.provider;

    // Spawn the long-lived decoder once the profile is locked, seeding it with
    // every chunk buffered so far (it must see the container header first).
    // From here `appendChunk` forwards new chunks straight in — each byte is
    // decoded exactly once instead of re-decoding the whole stream every pass.
    if (!this.streamDecoder) {
      this.streamDecoder = this.spawnDecoder(profile, provider.sampleRate, provider.normalizeLoudness);
    }

    // On the final pass, flush ffmpeg (incl. any filter look-ahead tail) and take
    // the complete PCM; otherwise take a stable snapshot of what's decoded so far.
    const full = isFinal
      ? await this.streamDecoder.finalize()
      : this.streamDecoder.samples();
    if (!full.length) return;
    if (!this.timings.firstDecodeAt) this.timings.firstDecodeAt = Date.now();
    const tDecode = Date.now();

    const duration = full.length / provider.sampleRate;

    // Stateless providers reprocess whatever they're handed, so feed only a
    // trailing window: back to `CONTEXT_SEC` before the committed watermark and
    // before any still-open note's onset, so committed audio is never re-sent yet
    // boundary notes keep full context. Providers that cache across passes get
    // the whole buffer and stay incremental internally.
    let windowStartSec = 0;
    let windowSamples = full;
    if (!provider.cachesAcrossPasses) {
      const anchorSec = Math.min(this.committedSec, this.uncommittedFromSec);
      const rawStart = Math.max(
        0,
        Math.floor((anchorSec - CONTEXT_SEC) * provider.sampleRate),
      );
      // Snap to the provider's analysis-block grid so the window's framing (and
      // thus its note timing) matches a whole-buffer run; this only moves the
      // start earlier, never cutting into the needed context.
      const align = Math.max(1, provider.windowAlignSamples);
      const startSample = Math.floor(rawStart / align) * align;
      windowStartSec = startSample / provider.sampleRate;
      windowSamples = full.subarray(startSample);
    }

    // Recomputed from this pass's notes below; reset so a pass that finds nothing
    // uncommitted doesn't inherit a stale onset and keep the window wide forever.
    this.uncommittedFromSec = Infinity;
    let emitMs = 0;
    let emitCount = 0;
    await converter.convert(
      windowSamples,
      { bpm: this.bpm },
      (extracted) => {
        const t0 = Date.now();
        this.emitFromExtracted(extracted, duration, windowStartSec, isFinal);
        emitMs += Date.now() - t0;
        emitCount += 1;
      },
      this.pitchOptions(profile),
    );
    const tEnd = Date.now();

    // Everything ending before the stable margin is now frozen; the next window
    // may start from here. (The final pass commits to the very end.)
    if (!isFinal) {
      this.committedSec = Math.max(
        this.committedSec,
        duration - STABLE_MARGIN_SEC,
      );
    }

    // A re-routed final pass that found no notes at all still owes the client a
    // rebuild: the measures it emitted under the wrong profile must be cleared.
    if (isFinal && this.reemitAll) this.emitAllMeasures();

    this.logger.debug(
      `Pass timings: decode-wait=${tDecode - tStart}ms, ` +
        `convert=${tEnd - tDecode - emitMs}ms, ` +
        `emit=${emitMs}ms (${emitCount}x), ` +
        `total=${tEnd - tStart}ms ` +
        `(audioDur=${duration.toFixed(2)}s, ` +
        `window=${windowStartSec.toFixed(2)}-${duration.toFixed(2)}s, ` +
        `samples=${full.length}, final=${isFinal})`,
    );
  }

  /**
   * Run the coarse pitch scan on the current buffer and lock the resulting
   * profile + matching converter. Returns whether a profile is now available.
   * Waits for at least `DETECT_MIN_SEC` of audio unless this is the final pass.
   */
  private async resolveProfile(buffer: Buffer, isFinal: boolean): Promise<boolean> {
    let detect;
    try {
      detect = await this.decoder.decode(buffer, DETECT_SAMPLE_RATE, {
        loudnorm: false,
        highpassHz: DETECT_HIGHPASS_HZ,
        inputFormat: this.inputFormat,
      });
    } catch (err) {
      this.logger.debug(`Detection decode not ready (${describeError(err)})`);
      return false;
    }
    if (!isFinal && detect.duration < DETECT_MIN_SEC) return false;

    const profile = this.resolver.resolve(detect.samples, DETECT_SAMPLE_RATE, {
      instrumentId: this.instrumentHint,
      sourceKind: this.sourceKind,
    });
    // No reliable pitch yet (breath, a late start, speech): keep listening
    // rather than lock the blind fallback for the whole take. Nothing is lost by
    // waiting — there are no notes to emit before the first pitched audio.
    if (!isFinal && isFallbackProfile(profile) && detect.duration < DETECT_MAX_WAIT_SEC) {
      this.logger.debug(
        `No pitched audio in the first ${detect.duration.toFixed(1)} s — profile lock deferred`,
      );
      return false;
    }
    this.lockProfile(profile);
    return true;
  }

  /** Install `profile` (and a converter for its provider) as the session's routing. */
  private lockProfile(profile: PipelineProfile): void {
    this.profile = profile;
    this.converter = new AudioConverter(this.registry.get(profile.providerName), {
      profile,
    });
    this.logger.log(
      `Adaptive profile locked: ${profile.id} provider=${profile.providerName} ` +
        `window=${profile.minFreqHz.toFixed(0)}-${profile.maxFreqHz.toFixed(0)}Hz ` +
        `hp=${profile.highpassHz.toFixed(0)}Hz seg=${profile.segmentMode ?? 'default'} ` +
        `(hint=${this.instrumentHint ?? 'none'}, source=${this.sourceKind ?? 'auto'}, ` +
        `decidedBy=${profile.sourceDecidedBy ?? 'n/a'})`,
    );
    // Sung takes are SPELLED on their own tuning grid at the notation layer
    // (voice-notation.ts); the flag lives on the builder, which setMeta may
    // have created before the profile existed — so set it here too.
    this.builder.setVoiceSpelling(profile.isVoice ?? false);
    // Tell the client what the pipeline believes it is hearing — the user is
    // the one observer who can tell us when this is wrong. `sourceBelief`, not
    // `isVoice`: belief is the observation, `isVoice` the routing outcome, and
    // they can diverge (e.g. the pitch-down very-high band never routes voice).
    this.onSourceResolved({
      source: profile.sourceBelief ?? (profile.isVoice ? 'voice' : 'instrument'),
      decidedBy: profile.sourceDecidedBy ?? 'prior',
    });
  }

  private spawnDecoder(
    profile: PipelineProfile,
    sampleRate: number,
    loudnorm: boolean,
  ): StreamingDecoder {
    const decoder = new StreamingDecoder(sampleRate, {
      highpassHz: profile.highpassHz,
      loudnorm,
      denoise: profile.denoise,
      inputFormat: this.inputFormat,
    });
    decoder.write(Buffer.concat(this.chunks));
    return decoder;
  }

  /**
   * Final-pass escape from the unvoiced fallback: re-resolve over the WHOLE take
   * and, if a real register band comes back, transcribe the take again under it.
   *
   * Everything emitted so far came from a profile chosen without hearing a single
   * pitched frame, so it is discarded: the emitted-note set and the commit
   * watermark reset, a fresh decoder is seeded from the retained encoded stream
   * (the new profile may change the sample rate, high-pass or denoise chain), and
   * `reemitAll` makes the final emission rebuild every measure — including bars
   * that are now empty. The cost is one extra full-take inference at stop, paid
   * only on takes whose first `DETECT_MAX_WAIT_SEC` held no pitch, where the
   * alternative was a score the fallback measured as empty anyway.
   */
  private async rerouteFinal(): Promise<void> {
    if (!this.streamDecoder) return;
    let detect;
    try {
      detect = await this.decoder.decode(Buffer.concat(this.chunks), DETECT_SAMPLE_RATE, {
        loudnorm: false,
        highpassHz: DETECT_HIGHPASS_HZ,
        inputFormat: this.inputFormat,
      });
    } catch (err) {
      this.logger.debug(`Final re-resolve decode failed (${describeError(err)})`);
      return;
    }
    const profile = this.resolver.resolve(detect.samples, DETECT_SAMPLE_RATE, {
      instrumentId: this.instrumentHint,
      sourceKind: this.sourceKind,
    });
    if (isFallbackProfile(profile)) return; // still nothing pitched — keep what we have

    this.logger.log(
      `Final pass re-routes the take: ${this.profile?.id ?? 'none'} → ${profile.id} ` +
        `(no pitched audio in the first ${DETECT_MAX_WAIT_SEC} s)`,
    );
    // Let the old ffmpeg drain and exit; its PCM is not needed any more.
    void this.streamDecoder.finalize().catch(() => undefined);
    this.lockProfile(profile);
    const provider = this.converter!.provider;
    this.streamDecoder = this.spawnDecoder(profile, provider.sampleRate, provider.normalizeLoudness);
    this.emittedNotes.length = 0;
    this.emittedKeys.clear();
    this.committedSec = 0;
    this.uncommittedFromSec = Infinity;
    this.reemitAll = true;
  }

  /** Rebuild and send every measure emitted so far from the current note set. */
  private emitAllMeasures(): void {
    this.reemitAll = false;
    if (this.lastEmittedMeasure < 0) return;
    const measures: Record<number, MxmlMeasure> = {};
    for (let m = 0; m <= this.lastEmittedMeasure; m += 1) {
      measures[m] = this.builder.buildMeasure(m, this.emittedNotes);
    }
    this.onUpdate({ measures });
  }

  private pitchOptions(profile: PipelineProfile): PitchTranscribeOptions {
    return {
      minFreqHz: profile.minFreqHz,
      maxFreqHz: profile.maxFreqHz,
      confidenceThreshold: profile.confidenceThreshold,
      minFramesPerNote: profile.minFramesPerNote,
      // Segmentation is a profile decision as of the voice flow: the resolver picks
      // WHERE to listen and now also HOW to decide where notes are.
      segmentMode: profile.segmentMode,
      smoothFrames: profile.smoothFrames,
    };
  }

  /**
   * Fold one pass's extracted notes into the emitted set. Note times come in
   * relative to the transcribed window, so `offsetSec` (the window's absolute
   * start) is added to every time before comparing against the absolute stable
   * cutoff and the dedup keys. Tracks the earliest still-uncommitted onset so the
   * next window can back up far enough to keep a long open note's onset in view.
   */
  private emitFromExtracted(
    extracted: ExtractedNotes,
    duration: number,
    offsetSec: number,
    isFinal: boolean,
  ): void {
    const { raw, deduced } = extracted;
    if (!raw.length && !deduced.length) return;

    this.lastRawNotes = offsetSec
      ? raw.map((n) => ({ ...n, startTimeSeconds: n.startTimeSeconds + offsetSec }))
      : raw;
    this.lastDuration = duration;
    const cutoff = duration - (isFinal ? 0 : STABLE_MARGIN_SEC);

    let earliestUncommitted = Infinity;
    const newNotes: PendingNote[] = [];
    for (const n of deduced) {
      const startSec = n.startTimeSeconds + offsetSec;
      if (startSec + n.durationSeconds > cutoff) {
        earliestUncommitted = Math.min(earliestUncommitted, startSec);
        continue;
      }
      const key = `${Math.round(startSec * 1000)}_${n.pitchMidi}`;
      if (this.emittedKeys.has(key)) continue;
      this.emittedKeys.add(key);
      newNotes.push({
        startTimeSeconds: startSec,
        durationSeconds: n.durationSeconds,
        pitchMidi: n.pitchMidi,
        // The voice decoder's unrounded pitch — the builder spells sung takes
        // on the take's own tuning grid from it (voice-notation.ts). This copy
        // is field-by-field, so forgetting the field here silently reverts
        // voice spelling to absolute names; it did, once.
        pitchMidiFloat: (n as PendingNote).pitchMidiFloat,
      });
    }
    this.uncommittedFromSec = earliestUncommitted;
    if (!newNotes.length) return;

    this.emittedNotes.push(...newNotes);
    this.emittedNotes.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

    const affected = new Set(this.affectedMeasures(newNotes));
    // Voice spelling is a TAKE-GLOBAL decision: the tuning offset (and the
    // key's vote on the naming) is estimated over every note so far, so early
    // measures were spelled from a half-built estimate. The final pass knows
    // the whole take — re-emit everything so the score the user keeps is
    // spelled from one consistent grid.
    // Likewise after a final-pass re-route: every earlier measure was built
    // from notes the wrong profile produced.
    if (isFinal && (this.profile?.isVoice || this.reemitAll)) {
      for (let m = 0; m <= this.lastEmittedMeasure; m += 1) affected.add(m);
      this.reemitAll = false;
    }
    const measures: Record<number, MxmlMeasure> = {};
    for (const idx of [...affected].sort((a, b) => a - b)) {
      measures[idx] = this.builder.buildMeasure(idx, this.emittedNotes);
    }
    if (!this.timings.firstUpdateAt) this.timings.firstUpdateAt = Date.now();
    this.onUpdate({ measures });
  }

  /**
   * Which measures must be rebuilt for a batch of newly committed notes.
   *
   * Two things beyond "the bar each note starts in", both of which were previously
   * missing and both of which lose music:
   *
   *  - **Every bar a note sounds through.** A held note is written into each bar it
   *    spans, tied across the barlines, so all of them change. Keying off the onset
   *    alone truncated any note longer than a bar — a note held for five bars was
   *    emitted as one.
   *  - **Bars containing nothing at all.** A bar the performer rested through has no
   *    onset to key off, so it was never emitted and the score simply had a hole
   *    where a bar of rest belonged. `buildMeasure` already renders it correctly (a
   *    whole rest) once asked, so the watermark below makes sure it is asked.
   */
  private affectedMeasures(newNotes: PendingNote[]): number[] {
    const affected = new Set<number>();
    let lowest = Infinity;
    for (const n of newNotes) {
      const [first, last] = this.builder.measureRangeFor(
        n.startTimeSeconds,
        n.durationSeconds,
      );
      for (let m = first; m <= last; m += 1) affected.add(m);
      lowest = Math.min(lowest, first);
      this.lastEmittedMeasure = Math.max(this.lastEmittedMeasure, last);
    }
    // Fill every bar from the first never-emitted one through this batch's end.
    // Two kinds of silent bar hide in that range: bars the performer rested
    // through since the previous batch, and bars BETWEEN two notes of this batch
    // (one burst pass can commit notes spanning a multi-bar rest — filling only
    // up to the batch's lowest bar left those interior bars as holes). Bars the
    // range re-adds that were already emitted just rebuild idempotently.
    if (Number.isFinite(lowest)) {
      const from = Math.min(this.firstUnemittedMeasure, lowest);
      for (let m = from; m <= this.lastEmittedMeasure; m += 1) affected.add(m);
    }
    this.firstUnemittedMeasure = this.lastEmittedMeasure + 1;
    return [...affected].sort((a, b) => a - b);
  }

  private logTimings(): void {
    const t = this.timings;
    if (!t.firstChunkAt) return;
    const totalBytes = this.chunkBytes;
    const relativeTo = (at: number): string =>
      at ? `${at - t.firstChunkAt}ms` : 'never';
    const avgPassMs = t.processCount
      ? Math.round(t.processTotalMs / t.processCount)
      : 0;
    const totalMs = Date.now() - t.firstChunkAt;
    this.logger.debug(
      `Session timings: first-response=${relativeTo(t.firstUpdateAt)}, ` +
        `first-decode=${relativeTo(t.firstDecodeAt)}, ` +
        `passes=${t.processCount} (avg=${avgPassMs}ms, max=${t.processMaxMs}ms), ` +
        `total=${totalMs}ms, chunks=${this.chunks.length} (${totalBytes} bytes)`,
    );
  }

  /**
   * Close out the archive: finish the streaming audio upload and store the
   * debug bundle (pitch plot, emitted score, session metadata) beside it.
   * Idempotent — `finalize` can run more than once (end message + close).
   */
  private async archive(): Promise<void> {
    if (this.archived || !this.archiver) return;
    this.archived = true;

    let plotSvg: string | undefined;
    if (this.lastDuration > 0 || this.lastRawNotes.length) {
      plotSvg = new RecordingDebugRenderer().render({
        rawNotes: this.lastRawNotes,
        deducedNotes: this.emittedNotes,
        durationSec: this.lastDuration,
        bpm: this.bpm,
        beatsPerMeasure: this.beats,
      });
    }

    let scoreJson: string | undefined;
    if (this.emittedNotes.length) {
      const measures: Record<number, MxmlMeasure> = {};
      // The archive is a whole take, so it is every bar from the first to the last —
      // including bars that only carry a held note's continuation and bars the
      // performer rested through. Keying off note onsets (as this did) dropped both.
      let highest = 0;
      for (const n of this.emittedNotes) {
        const [, last] = this.builder.measureRangeFor(
          n.startTimeSeconds,
          n.durationSeconds,
        );
        highest = Math.max(highest, last);
      }
      const indices = new Set<number>();
      for (let m = 0; m <= highest; m += 1) indices.add(m);
      for (const idx of indices) {
        measures[idx] = this.builder.buildMeasure(idx, this.emittedNotes);
      }
      scoreJson = JSON.stringify({ measures }, null, 2);
    }

    await this.archiver.finalize({
      plotSvg,
      scoreJson,
      sessionMeta: {
        bpm: this.bpm,
        beats: this.beats,
        beatType: this.beatType,
        chromaticTranspose: this.chromaticTranspose,
        instrumentHint: this.instrumentHint ?? null,
        sourceKind: this.sourceKind ?? null,
        profile: this.profile
          ? {
              id: this.profile.id,
              provider: this.profile.providerName,
              segmentMode: this.profile.segmentMode ?? null,
              isVoice: this.profile.isVoice ?? false,
              // Debuggability of mis-routing: what the resolver believed was at
              // the mic and on which evidence — 'explicit' (client declared),
              // 'classifier' (audio verdict), or 'prior' (score instrument;
              // also the classifier-abstain fallback). `isVoice` above is the
              // routing outcome; belief and routing can diverge (e.g. on the
              // very-high band, which never takes the voice overlay).
              sourceBelief: this.profile.sourceBelief ?? null,
              sourceDecidedBy: this.profile.sourceDecidedBy ?? null,
            }
          : null,
        audioDurationSec: this.lastDuration,
        emittedNoteCount: this.emittedNotes.length,
        rawNotes: this.lastRawNotes,
        emittedNotes: this.emittedNotes,
        timings: this.timings,
      },
    });
  }
}
