/**
 * Apply a degradation Condition to a clean WAV via the bundled ffmpeg binary,
 * writing a new WAV. Always loudness-normalizes first so noise is mixed at a
 * predictable level, then optionally mixes background noise, then applies the
 * condition's post EQ/reverb chain.
 */

import { execFileSync } from 'child_process';

import ffmpegPath from 'ffmpeg-static';

import type { Condition } from '../types';

const LOUDNORM = 'loudnorm=I=-16:TP=-3';

export function degrade(
  inPath: string,
  outPath: string,
  condition: Condition,
  sampleRate = 44100,
  maxDurationSec?: number,
): void {
  if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve a binary path');

  const post = condition.postFilter ? `,${condition.postFilter}` : '';
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inPath];

  if (condition.noise) {
    const { color, amplitude } = condition.noise;
    // Finite noise the same length as the clip, mixed with duration=longest so
    // neither input truncates the other. (An infinite anoisesrc with
    // duration=first produced wildly inconsistent output lengths.)
    const noiseDur = (maxDurationSec ?? 10).toFixed(3);
    args.push(
      '-f',
      'lavfi',
      '-i',
      `anoisesrc=color=${color}:amplitude=${amplitude}:seed=12345:duration=${noiseDur}`,
      '-filter_complex',
      `[0:a]${LOUDNORM}[s];[s][1:a]amix=inputs=2:duration=longest:normalize=0${post}[out]`,
      '-map',
      '[out]',
    );
  } else {
    args.push('-af', `${LOUDNORM}${post}`);
  }

  if (maxDurationSec) args.push('-t', maxDurationSec.toFixed(3));
  args.push('-ar', String(sampleRate), '-ac', '1', outPath);
  execFileSync(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'inherit'] });
}
