/**
 * Drive the production RecordingPipeline end-to-end and walk its emitted
 * MusicXML measures back into onset/duration/pitch notes, so eval scripts can
 * score the REAL server path (chunked decode, profile lock, dedup, and the
 * MusicXML quantization round-trip) rather than the raw converter output.
 *
 * Shared by probe-realpath.ts and diagnose-real.ts.
 */

import type { MxmlMeasure } from '../../../src/recordings/mxml.types';
import { ProfileResolver } from '../../../src/recordings/profiles/ProfileResolver';
import { ProviderRegistry } from '../../../src/recordings/providers/ProviderRegistry';
import { RecordingPipeline } from '../../../src/recordings/RecordingPipeline';
import type { EstNote } from './metrics';

const STEP_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** Walk the emitted MusicXML measures back into onset/duration/pitch notes. */
export function measuresToNotes(
  measures: Record<number, MxmlMeasure>,
  beatsPerMeasure: number,
  bpm: number,
  chromaticTranspose: number,
): EstNote[] {
  const indices = Object.keys(measures).map(Number).sort((a, b) => a - b);
  let divisions = 12;
  for (const idx of indices) {
    for (const e of measures[idx].entries) {
      if (e._type === 'attributes' && e.divisions) divisions = e.divisions;
    }
  }
  const notes: EstNote[] = [];
  const secPerBeat = 60 / bpm;
  let pending: EstNote | null = null;

  for (const idx of indices) {
    const measureStartBeat = idx * beatsPerMeasure;
    let cursorBeat = 0;
    for (const e of measures[idx].entries) {
      if (e._type !== 'note') continue;
      const durBeats = e.duration / divisions;
      if (e.rest) {
        cursorBeat += durBeats;
        continue;
      }
      const onsetSec = (measureStartBeat + cursorBeat) * secPerBeat;
      const midi =
        e.pitch != null
          ? (e.pitch.octave + 1) * 12 +
            STEP_SEMITONE[e.pitch.step] +
            (e.pitch.alter ?? 0) +
            chromaticTranspose
          : 0;
      const hasStart = e.tie?.some((t) => t.type === 'start') ?? false;
      const hasStop = e.tie?.some((t) => t.type === 'stop') ?? false;
      if (!hasStop) {
        // standalone or first of a tie chain
        if (pending) notes.push(pending);
        pending = { onsetSec, durSec: durBeats * secPerBeat, midi };
        if (!hasStart) {
          notes.push(pending);
          pending = null;
        }
      } else if (pending) {
        // continuation of a tie chain
        pending.durSec += durBeats * secPerBeat;
        if (!hasStart) {
          notes.push(pending);
          pending = null;
        }
      }
      cursorBeat += durBeats;
    }
  }
  if (pending) notes.push(pending);
  return notes;
}

/**
 * Feed `audio` through a fresh RecordingPipeline in ~100 ms byte slices (like
 * MediaRecorder.start(100)) and return the transcribed notes. The pipeline
 * concatenates before decoding, so the slicing is cosmetic to the result.
 */
export async function runThroughPipeline(
  registry: ProviderRegistry,
  resolver: ProfileResolver,
  audio: Buffer,
  bpm: number,
  beats: number,
  instrumentId: string,
): Promise<EstNote[]> {
  const pipeline = new RecordingPipeline(registry, resolver);
  pipeline.setMeta({
    bpm,
    timeSignature: { beats, beatType: 4 },
    chromaticTranspose: 0,
    instrumentId,
  });
  const acc: Record<number, MxmlMeasure> = {};
  pipeline.setOnUpdate((u) => {
    for (const [k, v] of Object.entries(u.measures)) acc[Number(k)] = v;
  });
  const CHUNKS = 12;
  const size = Math.ceil(audio.byteLength / CHUNKS);
  for (let o = 0; o < audio.byteLength; o += size) {
    pipeline.appendChunk(audio.subarray(o, Math.min(o + size, audio.byteLength)));
  }
  await pipeline.finalize();
  return measuresToNotes(acc, beats, bpm, 0);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((res) => setTimeout(res, ms));

/**
 * Like `runThroughPipeline`, but feeds the audio in many small chunks spaced out
 * in wall-clock time so the pipeline's debounce fires repeatedly — exercising the
 * INCREMENTAL multi-pass path (streaming decode + windowed transcription + the
 * committed-note watermark), which the instant-feed variant collapses into one
 * final pass. Set `RECORDING_DEBOUNCE_MS` low (e.g. 150) so passes accumulate
 * quickly. Returns the final emitted notes after finalize.
 */
export async function runThroughPipelineStreaming(
  registry: ProviderRegistry,
  resolver: ProfileResolver,
  audio: Buffer,
  bpm: number,
  beats: number,
  instrumentId: string,
  opts?: { chunks?: number; chunkDelayMs?: number },
): Promise<EstNote[]> {
  const pipeline = new RecordingPipeline(registry, resolver);
  pipeline.setMeta({
    bpm,
    timeSignature: { beats, beatType: 4 },
    chromaticTranspose: 0,
    instrumentId,
  });
  const acc: Record<number, MxmlMeasure> = {};
  pipeline.setOnUpdate((u) => {
    for (const [k, v] of Object.entries(u.measures)) acc[Number(k)] = v;
  });
  const chunks = opts?.chunks ?? 60;
  const delay = opts?.chunkDelayMs ?? 50;
  const size = Math.ceil(audio.byteLength / chunks);
  for (let o = 0; o < audio.byteLength; o += size) {
    pipeline.appendChunk(audio.subarray(o, Math.min(o + size, audio.byteLength)));
    await sleep(delay);
  }
  await pipeline.finalize();
  return measuresToNotes(acc, beats, bpm, 0);
}
