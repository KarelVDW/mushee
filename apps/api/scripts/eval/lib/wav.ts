/** Minimal mono WAV (PCM16) writer for synthesized clips. No dependencies. */

export function floatToWav(samples: Float32Array, sampleRate: number): Buffer {
  const numSamples = samples.length;
  const dataBytes = numSamples * 2; // 16-bit
  const buffer = Buffer.alloc(44 + dataBytes);

  // RIFF header
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');

  // fmt chunk
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // audio format = PCM
  buffer.writeUInt16LE(1, 22); // channels = mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let i = 0; i < numSamples; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), offset);
    offset += 2;
  }
  return buffer;
}

/**
 * Read a mono PCM16 RIFF/WAVE file back to floats. The inverse of
 * `floatToWav`, and the only reader the harness needs: every wav it writes or
 * stages is normalised to mono PCM16 first (fetch-whistle-real.ts, generate.ts).
 *
 * The `data` chunk is found by walking the chunk list rather than assuming
 * offset 44 — ffmpeg emits a `LIST`/`INFO` block ahead of it, so a fixed offset
 * reads metadata as audio (the same trap `degrade-real.ts` documents for
 * durations).
 */
export function wavToFloat(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('not a RIFF/WAVE file');
  }
  let sampleRate = 0;
  let channels = 1;
  let bitsPerSample = 16;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bitsPerSample = buf.readUInt16LE(offset + 22);
    }
    if (id === 'data') {
      if (bitsPerSample !== 16) throw new Error(`expected PCM16, got ${bitsPerSample}-bit`);
      const bytes = Math.min(size, buf.length - offset - 8);
      const frames = Math.floor(bytes / 2 / channels);
      const samples = new Float32Array(frames);
      let p = offset + 8;
      for (let i = 0; i < frames; i += 1) {
        // Channel 0 only; staged audio is mono, but a stray stereo file
        // downmixes to its left channel rather than reading interleaved noise.
        samples[i] = buf.readInt16LE(p) / 32768;
        p += 2 * channels;
      }
      return { samples, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}
