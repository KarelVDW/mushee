import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { beforeAll, describe, expect, it } from 'vitest';

import { AudioDecoder, StreamingDecoder } from '../../src/recordings/pipeline/audio-decoder';

const SAMPLE_RATE = 16000;
const TONE_SEC = 0.6;

/**
 * Encode a 440 Hz test tone into the given container, in-memory, using the
 * same ffmpeg-static binary the decoder runs. Each fixture mirrors what a
 * browser's MediaRecorder streams over the recording WebSocket.
 */
function encodeTone(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve a binary path');
    const proc = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${TONE_SEC}`,
      ...args,
      'pipe:1',
    ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`encode failed (${code}): ${Buffer.concat(err).toString()}`));
    });
  });
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

describe('AudioDecoder.inputFormatFor', () => {
  it('maps each browser MediaRecorder type to its ffmpeg demuxer', () => {
    expect(AudioDecoder.inputFormatFor('audio/webm;codecs=opus')).toBe('webm'); // Chrome/Edge
    expect(AudioDecoder.inputFormatFor('audio/webm')).toBe('webm');
    expect(AudioDecoder.inputFormatFor('audio/ogg;codecs=opus')).toBe('ogg'); // Firefox
    expect(AudioDecoder.inputFormatFor('audio/mp4')).toBe('mp4'); // Safari
  });

  it('normalizes case and whitespace', () => {
    expect(AudioDecoder.inputFormatFor(' Audio/MP4 ; codecs=mp4a.40.2')).toBe('mp4');
  });

  it('returns undefined for unknown types so ffmpeg probes instead', () => {
    expect(AudioDecoder.inputFormatFor('audio/wav')).toBeUndefined();
    expect(AudioDecoder.inputFormatFor('video/webm')).toBeUndefined();
    expect(AudioDecoder.inputFormatFor('not-a-mime')).toBeUndefined();
    expect(AudioDecoder.inputFormatFor('')).toBeUndefined();
  });
});

describe('decoding with an input-format hint (real ffmpeg)', () => {
  let webmOpus: Buffer; // Chrome/Edge default
  let oggOpus: Buffer; // Firefox default
  let fmp4Aac: Buffer; // Safari: fragmented MP4/AAC (100 ms fragments ≈ its chunk cadence)

  beforeAll(async () => {
    [webmOpus, oggOpus, fmp4Aac] = await Promise.all([
      encodeTone(['-c:a', 'libopus', '-f', 'webm']),
      encodeTone(['-c:a', 'libopus', '-f', 'ogg']),
      encodeTone([
        '-c:a',
        'aac',
        '-movflags',
        'frag_keyframe+empty_moov+default_base_moof',
        '-frag_duration',
        '100000',
        '-f',
        'mp4',
      ]),
    ]);
  }, 30_000);

  const cases: Array<[string, string, () => Buffer]> = [
    ['webm', 'audio/webm;codecs=opus', () => webmOpus],
    ['ogg', 'audio/ogg;codecs=opus', () => oggOpus],
    ['mp4', 'audio/mp4', () => fmp4Aac],
  ];

  it.each(cases)('one-shot decode of %s honors the hint', async (_, mimeType, buffer) => {
    const decoded = await new AudioDecoder().decode(buffer(), SAMPLE_RATE, {
      loudnorm: false,
      inputFormat: AudioDecoder.inputFormatFor(mimeType),
    });
    expect(decoded.duration).toBeGreaterThan(TONE_SEC - 0.15);
    expect(decoded.duration).toBeLessThan(TONE_SEC + 0.15);
    expect(rms(decoded.samples)).toBeGreaterThan(0.05); // the tone survived, not silence
  });

  it.each(cases)('streaming decode of %s in MediaRecorder-sized chunks honors the hint', async (_, mimeType, buffer) => {
    const decoder = new StreamingDecoder(SAMPLE_RATE, {
      loudnorm: false,
      inputFormat: AudioDecoder.inputFormatFor(mimeType),
    });
    const bytes = buffer();
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      decoder.write(bytes.subarray(offset, offset + 4096));
    }
    const samples = await decoder.finalize();
    expect(samples.length / SAMPLE_RATE).toBeGreaterThan(TONE_SEC - 0.15);
    expect(rms(samples)).toBeGreaterThan(0.05);
  });

  it('decodes a truncated fragmented-MP4 prefix (mid-recording detection pass)', async () => {
    // The profile-detection decode runs on whatever has streamed in so far;
    // Safari's container must yield samples from complete fragments even when
    // the buffer stops mid-stream.
    const prefix = fmp4Aac.subarray(0, Math.floor(fmp4Aac.length / 2));
    const decoded = await new AudioDecoder().decode(prefix, SAMPLE_RATE, {
      loudnorm: false,
      inputFormat: 'mp4',
    });
    expect(decoded.samples.length).toBeGreaterThan(0);
    expect(decoded.duration).toBeLessThan(TONE_SEC);
  });
});
