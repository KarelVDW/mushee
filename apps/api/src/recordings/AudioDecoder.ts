import { spawn } from 'child_process';

import ffmpegPath from 'ffmpeg-static';

export const TARGET_SAMPLE_RATE = 22050;

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

/**
 * Decodes an arbitrary audio container (WebM/Opus, MP3, WAV, ...) to mono
 * 32-bit float PCM at basic-pitch's required sample rate, via ffmpeg.
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

  decode(buffer: Buffer): Promise<DecodedAudio> {
    return new Promise<DecodedAudio>((resolve, reject) => {
      const proc = spawn(this.ffmpeg, [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-f',
        'f32le',
        '-ac',
        '1',
        '-ar',
        String(TARGET_SAMPLE_RATE),
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
          sampleRate: TARGET_SAMPLE_RATE,
          duration: samples.length / TARGET_SAMPLE_RATE,
        });
      });

      proc.stdin.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code !== 'EPIPE') reject(err);
      });

      proc.stdin.end(buffer);
    });
  }
}
