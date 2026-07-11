/**
 * Apply a degradation Condition to a clean WAV via the bundled ffmpeg binary,
 * writing a new WAV. Always loudness-normalizes first so noise is mixed at a
 * predictable level; then, in physical order: room reverberation (afir
 * convolution with a synthetic impulse response), background noise beds
 * (wind / babble / anoisesrc), and finally the condition's mic EQ chain.
 */

import { execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { Condition } from '../types';
import { synthesizeRoomImpulse, synthesizeSpeechNoise, synthesizeWind } from './acoustics';
import { floatToWav } from './wav';

const LOUDNORM = 'loudnorm=I=-16:TP=-3';

/** Longest noise bed we ever need; beds are trimmed to the clip by `-t`. */
const BED_DURATION_SEC = 90;

// Synthetic acoustic assets are deterministic per (kind, params, sampleRate),
// so they are rendered once per process and reused across the whole corpus.
const assetCache = new Map<string, string>();

function assetDir(): string {
  const dir = join(tmpdir(), 'mushee-eval-acoustics');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function impulseResponsePath(ir: NonNullable<Condition['ir']>, sampleRate: number): string {
  const key = `ir-${ir.rt60Sec}-${ir.wetDb}-${ir.preDelayMs ?? 12}-${sampleRate}`;
  const cached = assetCache.get(key);
  if (cached && existsSync(cached)) return cached;
  const path = join(assetDir(), `${key}.wav`);
  const samples = synthesizeRoomImpulse({
    sampleRate,
    rt60Sec: ir.rt60Sec,
    wetDb: ir.wetDb,
    preDelayMs: ir.preDelayMs,
  });
  writeFileSync(path, floatToWav(samples, sampleRate));
  assetCache.set(key, path);
  return path;
}

function noiseBedPath(bed: NonNullable<Condition['noiseBed']>, sampleRate: number): string {
  const key = `bed-${bed.kind}-${sampleRate}`;
  const cached = assetCache.get(key);
  if (cached && existsSync(cached)) return cached;
  const path = join(assetDir(), `${key}.wav`);
  const synth = bed.kind === 'wind' ? synthesizeWind : synthesizeSpeechNoise;
  const samples = synth({ sampleRate, durationSec: BED_DURATION_SEC });
  writeFileSync(path, floatToWav(samples, sampleRate));
  assetCache.set(key, path);
  return path;
}

export function degrade(
  inPath: string,
  outPath: string,
  condition: Condition,
  sampleRate = 44100,
  maxDurationSec?: number,
): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve a binary path');

  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inPath];
  const noiseDur = (maxDurationSec ?? 10).toFixed(3);

  // Assemble the input list; each optional stage records its input index.
  let irIndex = -1;
  if (condition.ir) {
    irIndex = (args.filter((a) => a === '-i').length);
    args.push('-i', impulseResponsePath(condition.ir, sampleRate));
  }
  let bedIndex = -1;
  if (condition.noiseBed) {
    bedIndex = (args.filter((a) => a === '-i').length);
    args.push('-i', noiseBedPath(condition.noiseBed, sampleRate));
  }
  let noiseIndex = -1;
  if (condition.noise) {
    noiseIndex = (args.filter((a) => a === '-i').length);
    const { color, amplitude } = condition.noise;
    // Finite noise the same length as the clip, mixed with duration=longest so
    // neither input truncates the other. (An infinite anoisesrc with
    // duration=first produced wildly inconsistent output lengths.)
    args.push('-f', 'lavfi', '-i', `anoisesrc=color=${color}:amplitude=${amplitude}:seed=12345:duration=${noiseDur}`);
  }

  const post = condition.postFilter ? `,${condition.postFilter}` : '';
  const stages: string[] = [`[0:a]${LOUDNORM}[sig]`];
  let current = 'sig';

  if (irIndex >= 0) {
    // The direct spike lives at t=0 inside the IR, so convolution preserves
    // onset positions while adding the room's smear. gtype=none: the IR's own
    // direct/wet balance IS the level design — afir's default peak auto-gain
    // (~1/sum|coeffs|) would crush the output ~35 dB.
    stages.push(`[${current}][${irIndex}:a]afir=gtype=none[rev]`);
    current = 'rev';
  }

  const mixInputs: string[] = [`[${current}]`];
  if (condition.noiseBed && bedIndex >= 0) {
    stages.push(`[${bedIndex}:a]volume=${condition.noiseBed.gainDb}dB,atrim=duration=${noiseDur}[bed]`);
    mixInputs.push('[bed]');
  }
  if (noiseIndex >= 0) mixInputs.push(`[${noiseIndex}:a]`);

  if (mixInputs.length > 1) {
    stages.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0[mix]`);
    current = 'mix';
  }

  if (condition.postFilter || mixInputs.length > 1 || irIndex >= 0) {
    stages.push(`[${current}]anull${post}[out]`);
    args.push('-filter_complex', stages.join(';'), '-map', '[out]');
  } else {
    args.push('-af', `${LOUDNORM}${post}`);
  }

  if (maxDurationSec) args.push('-t', maxDurationSec.toFixed(3));
  args.push('-ar', String(sampleRate), '-ac', '1', outPath);
  execFileSync(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
}
