/**
 * Point the human verifier at the clips where checking a draft label buys the
 * most: the whistle clips on which the pipeline and the drafted truth DISAGREE
 * most. Either the draft is wrong (and a corrected label removes a false failure
 * from every future number) or the pipeline is (and the verified clip becomes a
 * real, benchmark-grade failure case). Agreeing clips teach nothing new.
 *
 * Reads per-clip COnP for the dataset from the latest committed benchmark result
 * (`benchmarks/results/`), so the ranking reflects the shipping pipeline, and
 * rewrites the "Lowest pipeline agreement" section of the dataset's
 * `VERIFY-WORKLIST.md` between its markers — the stratified sections above it
 * are left exactly as staged.
 *
 *   tsx scripts/eval/fetch/triage-verify-worklist.ts [--dataset whistle-real] [--n 10]
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const RESULTS_DIR = resolve(__dirname, '../benchmarks/results');
const ANNOTATIONS = resolve(__dirname, '../annotations');
const BEGIN = '<!-- triage:begin -->';
const END = '<!-- triage:end -->';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

interface BenchClip { d: string; c: string; cond: string; f1: number; p: number; r: number }
interface BenchResult { meta: { id: string }; clips: BenchClip[] }

function main(): void {
  const dataset = arg('dataset', 'whistle-real');
  const n = Number(arg('n', '10'));
  const files = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).filter((f) => f.endsWith('.json')).sort() : [];
  if (!files.length) throw new Error('no benchmark results to triage from');
  const result = JSON.parse(readFileSync(join(RESULTS_DIR, files[files.length - 1]), 'utf8')) as BenchResult;
  const clips = result.clips
    .filter((c) => c.d === dataset && c.cond === 'real')
    .sort((a, b) => a.f1 - b.f1)
    .slice(0, n);
  if (!clips.length) throw new Error(`no ${dataset} clips in ${result.meta.id}`);

  const worklist = join(ANNOTATIONS, dataset, 'VERIFY-WORKLIST.md');
  if (!existsSync(worklist)) throw new Error(`no worklist at ${worklist}`);
  const meta = (clip: string): { band?: string; notes?: number } => {
    const p = join(ANNOTATIONS, dataset, `${clip}.meta.json`);
    if (!existsSync(p)) return {};
    const m = JSON.parse(readFileSync(p, 'utf8')) as { routedBand?: string; draftNotes?: number; notes?: number };
    return { band: m.routedBand, notes: m.draftNotes ?? m.notes };
  };
  const section = [
    BEGIN,
    `## 4. Lowest pipeline agreement (${clips.length}) — where a verified label changes the most`,
    '',
    `Ranked by per-clip COnP in benchmark run \`${result.meta.id}\` (regenerate with ` +
      '`fetch/triage-verify-worklist.ts`). A low score here is EITHER a wrong draft or a real pipeline ' +
      'failure; verifying these clips settles which, and either outcome moves a number.',
    '',
    ...clips.map((c) => {
      const m = meta(c.c);
      return `- [ ] \`${c.c}\` — COnP ${c.f1.toFixed(2)} (P ${c.p.toFixed(2)} / R ${c.r.toFixed(2)})` +
        `${m.band ? `, routed ${m.band}` : ''}${m.notes ? `, ${m.notes} draft notes` : ''}`;
    }),
    END,
  ].join('\n');

  const text = readFileSync(worklist, 'utf8');
  const next = text.includes(BEGIN)
    ? text.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), section)
    : `${text.trimEnd()}\n\n${section}\n`;
  writeFileSync(worklist, next);
  console.log(`${worklist}: triage section refreshed from ${result.meta.id} (${clips.length} clips)`);
}

main();
