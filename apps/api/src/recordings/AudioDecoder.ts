import { spawn } from 'child_process';

import ffmpegPath from 'ffmpeg-static';

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

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
    if (!ffmpegPath) {
      throw new Error('ffmpeg-static did not resolve a binary path');
    }
    this.ffmpeg = ffmpegPath;
  }

  decode(
    buffer: Buffer,
    targetSampleRate: number,
    opts?: DecodeOptions,
  ): Promise<DecodedAudio> {
    // 80 Hz high-pass clears sub-bass rumble that the onset head otherwise
    // misreads as low-pitch onsets. It's a causal IIR, so the prefix of its
    // output is stable across re-runs with longer inputs. loudnorm is
    // optional because it's a look-ahead filter and breaks that property.
    const filters = ['highpass=f=80'];
    if (opts?.loudnorm ?? true) filters.push('loudnorm=I=-16:TP=-3');
    const filterChain = filters.join(',');

    return new Promise<DecodedAudio>((resolve, reject) => {
      const proc = spawn(this.ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
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
      ]);

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
