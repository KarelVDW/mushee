import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

/**
 * Build the ffmpeg audio-filter chain shared by the one-shot and streaming
 * decoders. High-pass first (causal IIR, clears sub-bass rumble), then optional
 * `loudnorm`. See `DecodeOptions` for why `loudnorm` is opt-out.
 */
function buildFilterChain(highpassHz: number, loudnorm: boolean): string {
  const filters = [`highpass=f=${highpassHz}`];
  if (loudnorm) filters.push('loudnorm=I=-16:TP=-3');
  return filters.join(',');
}

/** ffmpeg args to decode an arbitrary container on stdin to mono f32le on stdout.
 *  `inputFormat` (a demuxer name, e.g. 'webm'/'ogg'/'mp4') pins the container
 *  instead of probing the pipe — probing a fragmented MP4 stream (Safari's
 *  MediaRecorder output) is where auto-detection is least reliable. */
function decodeArgs(
  filterChain: string,
  targetSampleRate: number,
  inputFormat?: string,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    ...(inputFormat ? ['-f', inputFormat] : []),
    '-i',
    'pipe:0',
    '-af',
    filterChain,
    '-f',
    'f32le',
    '-ac',
    '1',
    '-ar',
    String(targetSampleRate),
    'pipe:1',
  ];
}

function resolveFfmpeg(): string {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static did not resolve a binary path');
  }
  return ffmpegPath;
}

/** MediaRecorder base MIME type → ffmpeg demuxer name. A whitelist, not a
 *  parse: the value ends up in a spawn argv, and anything unknown falls back
 *  to ffmpeg's own container probing. */
const INPUT_FORMATS: Record<string, string> = {
  'audio/webm': 'webm', // Chrome/Edge (Opus)
  'audio/ogg': 'ogg', // Firefox (Opus)
  'audio/mp4': 'mp4', // Safari (AAC, fragmented)
};

export interface DecodeOptions {
  /**
   * Apply ffmpeg's `loudnorm` filter (~-16 LUFS, -3 dBFS true-peak ceiling).
   * Stabilizes amplitude for downstream consumers that care, but DEPENDS ON
   * THE FULL INPUT — re-decoding a longer prefix of the same stream will
   * change earlier output samples, breaking any per-frame caching the
   * provider does. Disable when the caller needs prefix-stable output.
   * Defaults to true.
   */
  loudnorm?: boolean;

  /**
   * Cutoff for the causal high-pass that clears sub-bass rumble before pitch
   * detection. Must sit below the lowest expected fundamental, so low-register
   * sources (bass voice, tuba) need a lower value than the 80 Hz default — the
   * profile picks this from the detected/expected range.
   */
  highpassHz?: number;

  /**
   * ffmpeg demuxer name ('webm', 'ogg', 'mp4', ...) when the container is known
   * up front — skips probing the pipe. Omit to let ffmpeg auto-detect.
   */
  inputFormat?: string;
}

/**
 * Decodes an arbitrary audio container (WebM/Opus, MP3, WAV, ...) to mono
 * 32-bit float PCM at the requested sample rate, via ffmpeg.
 *
 * Tolerates truncated / still-streaming inputs — ffmpeg decodes the parts it
 * can parse and exits with an error on the tail, which we ignore as long as
 * some samples came through.
 */
export class AudioDecoder {
  private readonly ffmpeg: string;

  constructor() {
    this.ffmpeg = resolveFfmpeg();
  }

  /**
   * ffmpeg input-format hint for a MediaRecorder MIME type
   * ('audio/webm;codecs=opus' → 'webm'). Undefined for unrecognized types —
   * then ffmpeg probes the container itself.
   */
  static inputFormatFor(mimeType: string): string | undefined {
    return INPUT_FORMATS[mimeType.split(';')[0].trim().toLowerCase()];
  }

  decode(
    buffer: Buffer,
    targetSampleRate: number,
    opts?: DecodeOptions,
  ): Promise<DecodedAudio> {
    // High-pass clears sub-bass rumble that the onset head otherwise misreads
    // as low-pitch onsets. It's a causal IIR, so the prefix of its output is
    // stable across re-runs with longer inputs. loudnorm is optional because
    // it's a look-ahead filter and breaks that property.
    const highpassHz = opts?.highpassHz ?? 80;
    const filterChain = buildFilterChain(highpassHz, opts?.loudnorm ?? true);

    return new Promise<DecodedAudio>((resolve, reject) => {
      const proc = spawn(
        this.ffmpeg,
        decodeArgs(filterChain, targetSampleRate, opts?.inputFormat),
      );

      const outChunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      proc.stdout.on('data', (c: Buffer) => outChunks.push(c));
      proc.stderr.on('data', (c: Buffer) => errChunks.push(c));

      proc.on('error', (err) => reject(err));

      proc.on('close', (code) => {
        const out = Buffer.concat(outChunks);
        const err = Buffer.concat(errChunks).toString('utf8');
        if (out.byteLength === 0) {
          reject(
            new Error(
              `ffmpeg produced no audio (exit ${code}): ${err.trim() || 'no stderr'}`,
            ),
          );
          return;
        }
        const samples = new Float32Array(
          out.buffer,
          out.byteOffset,
          out.byteLength / Float32Array.BYTES_PER_ELEMENT,
        );
        resolve({
          samples,
          sampleRate: targetSampleRate,
          duration: samples.length / targetSampleRate,
        });
      });

      proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EPIPE') reject(err);
      });

      proc.stdin.end(buffer);
    });
  }
}

export interface StreamingDecodeOptions {
  /** See `DecodeOptions.loudnorm`. Defaults to true. */
  loudnorm?: boolean;
  /** See `DecodeOptions.highpassHz`. Defaults to 80. */
  highpassHz?: number;
  /** See `DecodeOptions.inputFormat`. Omit to auto-detect. */
  inputFormat?: string;
}

/**
 * Long-lived ffmpeg decode for one recording. Feed the encoded container stream
 * incrementally with `write()`; ffmpeg decodes it to mono f32le PCM which we
 * accumulate into a growing `Float32Array`. Each input byte is decoded exactly
 * once, so total decode work is O(stream length) instead of the O(n²) you get
 * from re-decoding the whole buffer on every pass.
 *
 * Output samples are append-only: once a sample index is filled it is never
 * rewritten (ffmpeg single-pass filters are causal + bounded look-ahead, so the
 * emitted prefix is stable). `samples(...)` therefore hands back a zero-copy
 * subarray that stays valid for the duration of an async transcription pass even
 * if more audio arrives meanwhile (later writes only ever land at higher indices,
 * and a capacity grow allocates a new backing array while the old one — and any
 * view into it — is left intact).
 */
export class StreamingDecoder {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly errChunks: Buffer[] = [];
  private readonly closed: Promise<void>;
  private buf: Float32Array;
  private len = 0;
  /** Leftover stdout bytes (< 4) carried to the next chunk to keep float alignment. */
  private carry: Buffer = Buffer.alloc(0);
  private ended = false;

  constructor(
    readonly sampleRate: number,
    opts?: StreamingDecodeOptions,
  ) {
    const filterChain = buildFilterChain(
      opts?.highpassHz ?? 80,
      opts?.loudnorm ?? true,
    );
    this.buf = new Float32Array(sampleRate * 8); // ~8 s initial, grows as needed
    this.proc = spawn(
      resolveFfmpeg(),
      decodeArgs(filterChain, sampleRate, opts?.inputFormat),
    );

    this.proc.stdout.on('data', (c: Buffer) => this.ingest(c));
    this.proc.stderr.on('data', (c: Buffer) => this.errChunks.push(c));
    this.proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
      // EPIPE is expected if ffmpeg exits before we finish writing; ignore it.
      if (err.code !== 'EPIPE') this.errChunks.push(Buffer.from(String(err)));
    });

    this.closed = new Promise<void>((resolve, reject) => {
      this.proc.on('error', reject);
      this.proc.on('close', () => resolve());
    });
  }

  /** Feed the next slice of the encoded stream. No-op once `finalize()` ran. */
  write(chunk: Buffer): void {
    if (this.ended || !chunk.length) return;
    // Node buffers writes internally; backpressure is a non-issue at WebM/Opus
    // bitrates, and the EPIPE guard covers an early ffmpeg exit.
    this.proc.stdin.write(chunk);
  }

  /** Decoded PCM so far, as a stable zero-copy view over `[start, end)` samples. */
  samples(start = 0, end = this.len): Float32Array {
    const lo = Math.max(0, Math.min(start, this.len));
    const hi = Math.max(lo, Math.min(end, this.len));
    return this.buf.subarray(lo, hi);
  }

  get decodedSamples(): number {
    return this.len;
  }

  get durationSec(): number {
    return this.len / this.sampleRate;
  }

  /**
   * Close stdin and wait for ffmpeg to flush the rest of the stream (including
   * any filter look-ahead tail), then return the full decoded PCM. Idempotent —
   * safe to call more than once (the session finalizes on both limit-reached and
   * close).
   */
  async finalize(): Promise<Float32Array> {
    if (!this.ended) {
      this.ended = true;
      this.proc.stdin.end();
    }
    await this.closed;
    return this.samples();
  }

  private ingest(chunk: Buffer): void {
    const data = this.carry.length ? Buffer.concat([this.carry, chunk]) : chunk;
    const fullBytes = data.length - (data.length % 4);
    // Copy the <4-byte tail (don't hold a view into the stream's buffer).
    this.carry =
      fullBytes === data.length ? EMPTY : Buffer.from(data.subarray(fullBytes));
    const nFloats = fullBytes / 4;
    if (nFloats === 0) return;
    this.ensureCapacity(this.len + nFloats);
    // data may not be 4-byte aligned for a Float32Array view, so read explicitly.
    for (let i = 0; i < nFloats; i++) {
      this.buf[this.len + i] = data.readFloatLE(i * 4);
    }
    this.len += nFloats;
  }

  private ensureCapacity(needed: number): void {
    if (needed <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < needed) cap *= 2;
    const grown = new Float32Array(cap);
    grown.set(this.buf.subarray(0, this.len));
    this.buf = grown;
  }
}

const EMPTY = Buffer.alloc(0);
