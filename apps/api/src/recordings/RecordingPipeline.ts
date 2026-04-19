import { Logger } from '@nestjs/common';
import { BasicPitch, NoteEventTime } from '@spotify/basic-pitch';
import type { GraphModel } from '@tensorflow/tfjs';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

import { AudioDecoder, DecodedAudio } from './AudioDecoder';
import type { MxmlMeasure } from './mxml.types';
import { MxmlBuilder, PendingNote } from './MxmlBuilder';
import { NoteExtractor } from './NoteExtractor';
import { RecordingDebugRenderer } from './RecordingDebugRenderer';

const DEFAULT_BPM = 120;
const DEFAULT_BEATS = 4;
const DEFAULT_BEAT_TYPE = 4;
const DEBOUNCE_MS = 1000;
const STABLE_MARGIN_SEC = 0.4;
const DEFAULT_DEBUG_DIR = resolve(
  process.cwd(),
  'debug',
  'recordings',
);

export interface ScoreUpdate {
  measures: Record<number, MxmlMeasure>;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One pipeline per recording session. Buffers raw WebM chunks, periodically
 * re-decodes the cumulative buffer, runs basic-pitch, and emits MxmlMeasure
 * deltas to the caller as notes settle.
 */
export class RecordingPipeline {
  private readonly logger = new Logger(RecordingPipeline.name);
  private readonly decoder = new AudioDecoder();
  private readonly extractor = new NoteExtractor();

  private readonly chunks: Buffer[] = [];
  private readonly emittedNotes: PendingNote[] = [];
  private readonly emittedKeys = new Set<string>();
  private lastRawNotes: NoteEventTime[] = [];
  private lastDuration = 0;
  private debugWritten = false;

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
  private builder = new MxmlBuilder({
    bpm: this.bpm,
    beats: this.beats,
    beatType: this.beatType,
  });

  private processing = false;
  private rerunRequested = false;
  private finalRequested = false;
  private debounceTimer: NodeJS.Timeout | null = null;
  private onUpdate: (update: ScoreUpdate) => void = () => {};

  constructor(private readonly modelPromise: Promise<GraphModel>) {}

  setMeta(meta: {
    bpm?: number;
    timeSignature?: { beats: number; beatType: number } | null;
  }): void {
    if (meta.bpm) this.bpm = meta.bpm;
    if (meta.timeSignature) {
      this.beats = meta.timeSignature.beats;
      this.beatType = meta.timeSignature.beatType;
    }
    this.builder = new MxmlBuilder({
      bpm: this.bpm,
      beats: this.beats,
      beatType: this.beatType,
    });
  }

  setOnUpdate(cb: (update: ScoreUpdate) => void): void {
    this.onUpdate = cb;
  }

  appendChunk(buffer: Buffer): void {
    if (!this.timings.firstChunkAt) this.timings.firstChunkAt = Date.now();
    this.chunks.push(buffer);
    this.scheduleProcess();
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
    if (!this.chunks.length) return;

    const tStart = Date.now();
    const buffer = Buffer.concat(this.chunks);
    const tConcat = Date.now();

    let decoded: DecodedAudio;
    try {
      decoded = await this.decoder.decode(buffer);
    } catch (err) {
      this.logger.debug(`Cannot decode buffer yet (${describeError(err)})`);
      return;
    }
    const tDecode = Date.now();
    if (!this.timings.firstDecodeAt) this.timings.firstDecodeAt = tDecode;

    const model = await this.modelPromise;
    const tModelReady = Date.now();
    const basicPitch = new BasicPitch(Promise.resolve(model));
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const duration = decoded.duration;
    let emitMs = 0;

    await basicPitch.evaluateModel(
      decoded.samples,
      (f, o) => {
        frames.push(...f);
        onsets.push(...o);
        const t0 = Date.now();
        this.emitFromState(frames, onsets, duration, isFinal);
        emitMs += Date.now() - t0;
      },
      () => {},
    );
    const tModelDone = Date.now();

    const tFinalEmitStart = Date.now();
    this.emitFromState(frames, onsets, duration, isFinal);
    emitMs += Date.now() - tFinalEmitStart;
    const tEnd = Date.now();

    this.logger.debug(
      `Pass timings: concat=${tConcat - tStart}ms, ` +
        `decode=${tDecode - tConcat}ms, ` +
        `model-wait=${tModelReady - tDecode}ms, ` +
        `model-eval=${tModelDone - tModelReady - emitMs}ms, ` +
        `emit=${emitMs}ms, ` +
        `total=${tEnd - tStart}ms ` +
        `(audioDur=${duration.toFixed(2)}s, bytes=${buffer.byteLength}, final=${isFinal})`,
    );
  }

  private emitFromState(
    frames: number[][],
    onsets: number[][],
    duration: number,
    isFinal: boolean,
  ): void {
    if (!frames.length || !onsets.length) return;

    const { raw, deduced } = this.extractor.extract(frames, onsets, {
      bpm: this.bpm,
    });
    this.lastRawNotes = raw;
    this.lastDuration = duration;
    const cutoff = duration - (isFinal ? 0 : STABLE_MARGIN_SEC);

    const newNotes: PendingNote[] = [];
    for (const n of deduced) {
      if (n.startTimeSeconds + n.durationSeconds > cutoff) continue;
      const key = `${Math.round(n.startTimeSeconds * 1000)}_${n.pitchMidi}`;
      if (this.emittedKeys.has(key)) continue;
      this.emittedKeys.add(key);
      newNotes.push({
        startTimeSeconds: n.startTimeSeconds,
        durationSeconds: n.durationSeconds,
        pitchMidi: n.pitchMidi,
      });
    }
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
    const totalBytes = this.chunks.reduce((s, c) => s + c.byteLength, 0);
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

    const baseDir = process.env.RECORDINGS_DEBUG_DIR ?? DEFAULT_DEBUG_DIR;
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
