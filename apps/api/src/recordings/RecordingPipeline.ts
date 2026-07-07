import { Logger } from '@nestjs/common';
import { NoteEventTime } from '@spotify/basic-pitch';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

import { AudioConverter } from './AudioConverter';
import { AudioDecoder, StreamingDecoder } from './AudioDecoder';
import type { MxmlMeasure } from './mxml.types';
import { MxmlBuilder, PendingNote } from './MxmlBuilder';
import { ExtractedNotes } from './NoteExtractor';
import type { PipelineProfile } from './profiles/PipelineProfile';
import { ProfileResolver } from './profiles/ProfileResolver';
import type { PitchTranscribeOptions } from './providers/PitchProvider';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { RecordingDebugRenderer } from './RecordingDebugRenderer';

const DEFAULT_BPM = 120;
const DEFAULT_BEATS = 4;
const DEFAULT_BEAT_TYPE = 4;
// Pass cadence. Overridable so eval harnesses can drive many incremental passes
// without waiting in real time; unset in production, where it stays 1 s.
const DEBOUNCE_MS = Number(process.env.RECORDING_DEBOUNCE_MS) || 1000;
const STABLE_MARGIN_SEC = 0.4;
/**
 * Lead-in of already-seen audio prepended to each windowed transcription pass
 * (stateless providers only). basic-pitch runs 2 s analysis windows internally,
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
const DEFAULT_DEBUG_DIR = resolve(
  process.cwd(),
  'debug',
  'recordings',
);

/**
 * Raw audio is personal data: the privacy policy promises it is processed in
 * memory only, so in production the debug bundle is disabled outright — even
 * an explicit RECORDINGS_DEBUG_DIR does not override it (fail closed).
 */
function resolveDebugDir(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  return process.env.RECORDINGS_DEBUG_DIR ?? DEFAULT_DEBUG_DIR;
}

export interface ScoreUpdate {
  measures: Record<number, MxmlMeasure>;
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
 * Per-pass transcription is bounded too: stateless providers (basic-pitch) are
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
  // Debug bundles are the only consumer of the full encoded stream after the
  // streaming decoder is live; when they're off, chunks are dropped once
  // forwarded so memory doesn't grow with recording length.
  private readonly debugDir = resolveDebugDir();
  private readonly emittedNotes: PendingNote[] = [];
  private readonly emittedKeys = new Set<string>();
  private lastRawNotes: NoteEventTime[] = [];
  private lastDuration = 0;
  private debugWritten = false;

  // Long-lived decode for this session, spawned once the profile (and thus the
  // sample rate / high-pass / loudnorm) is locked. Null until then.
  private streamDecoder: StreamingDecoder | null = null;
  // Watermark (absolute seconds): notes ending before this are already emitted
  // and frozen, so windowed passes never need to reprocess audio before it.
  private committedSec = 0;
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

  // Resolved once, from the first ~1.2 s of audio (or on finalize), then locked
  // for the session: which provider runs and with what frequency window /
  // high-pass / thresholds. `converter` is built to match the chosen provider.
  private profile: PipelineProfile | null = null;
  private converter: AudioConverter | null = null;
  private instrumentHint: string | undefined;
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
    if (typeof meta.mimeType === 'string') {
      this.inputFormat = AudioDecoder.inputFormatFor(meta.mimeType);
    }
    this.builder = new MxmlBuilder({
      bpm: this.bpm,
      beats: this.beats,
      beatType: this.beatType,
      chromaticTranspose: this.chromaticTranspose,
    });
  }

  setOnUpdate(cb: (update: ScoreUpdate) => void): void {
    this.onUpdate = cb;
  }

  appendChunk(buffer: Buffer): void {
    if (!this.timings.firstChunkAt) this.timings.firstChunkAt = Date.now();
    this.chunkBytes += buffer.byteLength;
    // Encoded chunks are retained only while the decoder still needs them for
    // its container-header seed (or indefinitely when the debug bundle wants
    // the full stream).
    if (!this.streamDecoder || this.debugDir) this.chunks.push(buffer);
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
    await this.writeDebugBundle();
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
      const decoder = new StreamingDecoder(provider.sampleRate, {
        highpassHz: profile.highpassHz,
        loudnorm: provider.normalizeLoudness,
        inputFormat: this.inputFormat,
      });
      decoder.write(Buffer.concat(this.chunks));
      this.streamDecoder = decoder;
      // The decoder owns the bytes now; without a debug bundle the encoded
      // stream never needs to be replayed, so stop holding on to it.
      if (!this.debugDir) this.chunks.length = 0;
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
    });
    this.profile = profile;
    this.converter = new AudioConverter(this.registry.get(profile.providerName));
    this.logger.log(
      `Adaptive profile locked: ${profile.id} provider=${profile.providerName} ` +
        `window=${profile.minFreqHz.toFixed(0)}-${profile.maxFreqHz.toFixed(0)}Hz ` +
        `hp=${profile.highpassHz.toFixed(0)}Hz (hint=${this.instrumentHint ?? 'none'})`,
    );
    return true;
  }

  private pitchOptions(profile: PipelineProfile): PitchTranscribeOptions {
    return {
      minFreqHz: profile.minFreqHz,
      maxFreqHz: profile.maxFreqHz,
      confidenceThreshold: profile.confidenceThreshold,
      onsetThreshold: profile.onsetThreshold,
      frameThreshold: profile.frameThreshold,
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
      });
    }
    this.uncommittedFromSec = earliestUncommitted;
    if (!newNotes.length) return;

    this.emittedNotes.push(...newNotes);
    this.emittedNotes.sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

    const affected = new Set<number>();
    for (const n of newNotes) {
      affected.add(this.builder.measureIndexFor(n.startTimeSeconds));
    }

    const measures: Record<number, MxmlMeasure> = {};
    for (const idx of affected) {
      measures[idx] = this.builder.buildMeasure(idx, this.emittedNotes);
    }
    if (!this.timings.firstUpdateAt) this.timings.firstUpdateAt = Date.now();
    this.onUpdate({ measures });
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

  private async writeDebugBundle(): Promise<void> {
    if (this.debugWritten) return;
    if (this.lastDuration <= 0 && !this.chunks.length) return;
    this.debugWritten = true;

    const baseDir = this.debugDir;
    if (!baseDir) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionDir = join(baseDir, stamp);

    try {
      await mkdir(sessionDir, { recursive: true });
    } catch (err) {
      this.logger.warn(
        `Failed to create debug dir ${sessionDir}: ${describeError(err)}`,
      );
      return;
    }

    if (this.chunks.length) {
      const audio = Buffer.concat(this.chunks);
      const audioPath = join(sessionDir, `audio${detectExtension(audio)}`);
      try {
        await writeFile(audioPath, audio);
      } catch (err) {
        this.logger.warn(
          `Failed to write debug audio: ${describeError(err)}`,
        );
      }
    }

    if (this.lastDuration > 0 || this.lastRawNotes.length) {
      const svg = new RecordingDebugRenderer().render({
        rawNotes: this.lastRawNotes,
        deducedNotes: this.emittedNotes,
        durationSec: this.lastDuration,
        bpm: this.bpm,
        beatsPerMeasure: this.beats,
      });
      const svgPath = join(sessionDir, 'plot.svg');
      try {
        await writeFile(svgPath, svg, 'utf8');
      } catch (err) {
        this.logger.warn(
          `Failed to write debug image: ${describeError(err)}`,
        );
      }
    }

    if (this.emittedNotes.length) {
      const measures: Record<number, MxmlMeasure> = {};
      const indices = new Set(
        this.emittedNotes.map((n) =>
          this.builder.measureIndexFor(n.startTimeSeconds),
        ),
      );
      for (const idx of indices) {
        measures[idx] = this.builder.buildMeasure(idx, this.emittedNotes);
      }
      const scorePath = join(sessionDir, 'score.json');
      try {
        await writeFile(
          scorePath,
          JSON.stringify({ measures }, null, 2),
          'utf8',
        );
      } catch (err) {
        this.logger.warn(`Failed to write debug score: ${describeError(err)}`);
      }
    }

    this.logger.log(`Wrote debug bundle: ${sessionDir}`);
  }
}

function detectExtension(buffer: Buffer): string {
  if (buffer.length >= 4) {
    if (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    ) {
      return '.webm';
    }
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      return '.mp3';
    }
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
      return '.mp3';
    }
    if (
      buffer[0] === 0x4f &&
      buffer[1] === 0x67 &&
      buffer[2] === 0x67 &&
      buffer[3] === 0x53
    ) {
      return '.ogg';
    }
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46
    ) {
      return '.wav';
    }
    if (
      buffer[0] === 0x66 &&
      buffer[1] === 0x4c &&
      buffer[2] === 0x61 &&
      buffer[3] === 0x43
    ) {
      return '.flac';
    }
  }
  return '.bin';
}
