/**
 * Build the evaluation corpus. For every (scenario × melody) it renders a clean
 * source clip — instruments via fluidsynth + FluidR3_GM, voice/whistle via
 * direct synthesis — writes the ground truth, then emits one WAV per
 * degradation condition.
 *
 * Output: scripts/fixtures/eval/<scenario>/<melody>__<condition>.wav
 *         scripts/fixtures/eval/<scenario>/<melody>.truth.json
 *
 * Idempotent and reproducible. Run: pnpm --filter api exec tsx scripts/eval/generate.ts
 */

import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { resolve, join } from 'path';

import { degrade } from './lib/degrade';
import { melodyToMidi } from './lib/midi';
import { melodyToTruth } from './lib/groundTruth';
import { synthesize } from './lib/synth';
import { floatToWav } from './lib/wav';
import { MELODIES } from './melodies';
import { CONDITIONS, SCENARIOS } from './scenarios';
import type { Melody, Scenario } from './types';

const SAMPLE_RATE = 44100;
const EVAL_ROOT = resolve(__dirname, '../fixtures/eval');
const SOUNDFONT = resolve(__dirname, 'assets/FluidR3_GM.sf2');
const TMP = resolve(__dirname, '.tmp');

function renderClean(scenario: Scenario, melody: Melody, rawWav: string): void {
  if (scenario.kind === 'instrument') {
    const midiPath = join(TMP, 'render.mid');
    writeFileSync(
      midiPath,
      melodyToMidi(melody, scenario.rootMidi, scenario.gmProgram ?? 0),
    );
    execFileSync(
      'fluidsynth',
      ['-ni', '-g', '0.6', '-F', rawWav, '-r', String(SAMPLE_RATE), SOUNDFONT, midiPath],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } else {
    const truth = melodyToTruth(melody, scenario.rootMidi);
    const samples = synthesize(truth, {
      sampleRate: SAMPLE_RATE,
      kind: scenario.kind,
      seed: scenario.rootMidi + melody.notes.length,
    });
    writeFileSync(rawWav, floatToWav(samples, SAMPLE_RATE));
  }
}

function main(): void {
  rmSync(EVAL_ROOT, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  let clips = 0;
  for (const scenario of SCENARIOS) {
    const dir = join(EVAL_ROOT, scenario.id);
    mkdirSync(dir, { recursive: true });

    for (const melody of MELODIES) {
      const truth = melodyToTruth(melody, scenario.rootMidi);
      writeFileSync(
        join(dir, `${melody.name}.truth.json`),
        JSON.stringify(truth, null, 2),
      );

      const rawWav = join(TMP, 'raw.wav');
      renderClean(scenario, melody, rawWav);

      // Trim trailing reverb/release tail to just past the last note so it
      // doesn't spawn phantom notes the ground truth doesn't have.
      const lastNote = truth.notes[truth.notes.length - 1];
      const clipDur = lastNote ? lastNote.onsetSec + lastNote.durSec + 0.4 : 1;

      for (const condition of CONDITIONS) {
        const out = join(dir, `${melody.name}__${condition.id}.wav`);
        degrade(rawWav, out, condition, SAMPLE_RATE, clipDur);
        clips += 1;
      }
    }
    console.log(`  ${scenario.id}: ${MELODIES.length * CONDITIONS.length} clips`);
  }

  rmSync(TMP, { recursive: true, force: true });
  console.log(
    `\nGenerated ${clips} clips across ${SCENARIOS.length} scenarios into ${EVAL_ROOT}`,
  );
}

main();
