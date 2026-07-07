import { PassThrough } from 'stream';
import { describe, expect, it, vi } from 'vitest';

import {
  RecordingArchiver,
  sniffContainer,
} from '../../src/recordings/RecordingArchiver';
import type { StorageService } from '../../src/storage/storage.service';

function fakeStorage() {
  const objects = new Map<string, Buffer>();
  const streams = new Map<string, PassThrough>();
  const storage = {
    createWriteStream: vi.fn((key: string) => {
      const stream = new PassThrough();
      const chunks: Buffer[] = [];
      stream.on('data', (c: Buffer) => chunks.push(c));
      stream.on('end', () => objects.set(key, Buffer.concat(chunks)));
      streams.set(key, stream);
      return stream;
    }),
    write: vi.fn(async (key: string, content: string | Buffer) => {
      objects.set(key, Buffer.from(content));
    }),
  } as unknown as StorageService;
  return { storage, objects, streams };
}

const WEBM_HEADER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);

describe('RecordingArchiver', () => {
  it('streams audio under the recording path with a sniffed extension', async () => {
    const { storage, objects } = fakeStorage();
    const archiver = new RecordingArchiver(storage, 'recordings/u/s/r');

    archiver.appendAudio(WEBM_HEADER);
    archiver.appendAudio(Buffer.from('more-audio'));
    await archiver.finalize({});

    expect(storage.createWriteStream).toHaveBeenCalledWith(
      'recordings/u/s/r/audio.webm',
      { contentType: 'audio/webm' },
    );
    expect(objects.get('recordings/u/s/r/audio.webm')).toEqual(
      Buffer.concat([WEBM_HEADER, Buffer.from('more-audio')]),
    );
  });

  it('writes the debug bundle beside the audio', async () => {
    const { storage, objects } = fakeStorage();
    const archiver = new RecordingArchiver(storage, 'recordings/u/s/r');

    await archiver.finalize({
      plotSvg: '<svg/>',
      scoreJson: '{"measures":{}}',
      sessionMeta: { bpm: 120 },
    });

    expect(objects.get('recordings/u/s/r/plot.svg')?.toString()).toBe('<svg/>');
    expect(objects.get('recordings/u/s/r/score.json')?.toString()).toBe(
      '{"measures":{}}',
    );
    expect(
      JSON.parse(objects.get('recordings/u/s/r/session.json')!.toString()),
    ).toEqual({ bpm: 120 });
  });

  it('survives a failing audio stream and still archives the bundle', async () => {
    const { storage, objects, streams } = fakeStorage();
    const archiver = new RecordingArchiver(storage, 'recordings/u/s/r');

    archiver.appendAudio(WEBM_HEADER);
    streams
      .get('recordings/u/s/r/audio.webm')!
      .destroy(new Error('bucket unreachable'));
    await new Promise((resolve) => setImmediate(resolve));
    // Further chunks are dropped without throwing into the recording path.
    archiver.appendAudio(Buffer.from('late'));
    await archiver.finalize({ plotSvg: '<svg/>' });

    expect(objects.get('recordings/u/s/r/plot.svg')?.toString()).toBe('<svg/>');
  });
});

describe('sniffContainer', () => {
  it.each([
    [[0x1a, 0x45, 0xdf, 0xa3], '.webm'],
    [[0x49, 0x44, 0x33, 0x00], '.mp3'],
    [[0x4f, 0x67, 0x67, 0x53], '.ogg'],
    [[0x52, 0x49, 0x46, 0x46], '.wav'],
    [[0x66, 0x4c, 0x61, 0x43], '.flac'],
    [[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], '.mp4'],
    [[0x00, 0x01, 0x02, 0x03], '.bin'],
  ])('detects %j as %s', (bytes, extension) => {
    expect(sniffContainer(Buffer.from(bytes)).extension).toBe(extension);
  });
});
