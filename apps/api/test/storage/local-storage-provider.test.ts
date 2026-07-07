import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { finished } from 'stream/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStorageProvider } from '../../src/storage/local-storage.provider';

describe('LocalStorageProvider', () => {
  let root: string;
  let provider: LocalStorageProvider;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'mushee-storage-'));
    provider = new LocalStorageProvider(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips write/read, creating parent directories', async () => {
    await provider.write('scores/user-1/a.musicxml', '<score/>');
    await expect(provider.read('scores/user-1/a.musicxml')).resolves.toBe(
      '<score/>',
    );
  });

  it('streams chunk-by-chunk and the object is complete after finish', async () => {
    const stream = provider.createWriteStream('recordings/u/s/r/audio.webm');
    stream.write(Buffer.from('abc'));
    stream.write(Buffer.from('def'));
    stream.end();
    await finished(stream);
    const content = await readFile(
      join(root, 'recordings/u/s/r/audio.webm'),
    );
    expect(content.toString()).toBe('abcdef');
  });

  it('treats deleting an absent key as success', async () => {
    await expect(provider.delete('nope/missing.bin')).resolves.toBeUndefined();
  });

  it('deletes everything under a prefix', async () => {
    await provider.write('recordings/u1/s1/r1/audio.webm', 'x');
    await provider.write('recordings/u1/s2/r2/plot.svg', 'y');
    await provider.write('recordings/u2/s3/r3/audio.webm', 'z');
    await provider.deletePrefix('recordings/u1/');
    await expect(provider.read('recordings/u1/s1/r1/audio.webm')).rejects.toThrow();
    await expect(provider.read('recordings/u2/s3/r3/audio.webm')).resolves.toBe('z');
  });

  it('refuses keys that escape the root', async () => {
    await expect(provider.write('../outside.txt', 'x')).rejects.toThrow(
      /escapes root/,
    );
  });
});
