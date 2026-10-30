/**
 * Every location this app reads, in one place. The app is local-only and read-only: the
 * benchmark and timeline results are git-tracked JSON inside this app (`apps/eval/data`), the
 * corpus and the per-run caches are the harness's gitignored working state on this machine.
 * Nothing here writes.
 */

import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'

import type { RunKind } from '@/lib/dto'

export class EvalPaths {
    static readonly repoRoot = EvalPaths.findRepoRoot()
    static readonly appDir = join(EvalPaths.repoRoot, 'apps/eval')
    static readonly apiDir = join(EvalPaths.repoRoot, 'apps/api')
    static readonly harnessDir = join(EvalPaths.apiDir, 'scripts/eval')
    static readonly fixturesDir = join(EvalPaths.apiDir, 'scripts/fixtures')

    /** The real corpus: `<tier>/<dataset>/` with `<clip>.truth.json` + `<clip>__real.wav`. */
    static readonly realCorpus = join(EvalPaths.fixturesDir, 'eval-real')
    /** The realistic synthetic corpus: flat `<dataset>/` with `__dry`/`__studio`/… renders. */
    static readonly synthCorpus = join(EvalPaths.fixturesDir, 'eval-synth')

    /** Committed resynth truth artifacts: `<dataset>/<clip>.resynth.json`. */
    static readonly resynthAnnotations = join(EvalPaths.harnessDir, 'annotations/resynth')
    /** Blind resynth runs on human-truth clips, the method's calibration. */
    static readonly resynthCalibration = join(EvalPaths.harnessDir, 'annotations/resynth-calibration')
    /** The resynth loop's live work state: `<dataset>/<clip>/{state,spec,judge,report}.json` + `synth.flac`. */
    static readonly resynthWork = join(EvalPaths.repoRoot, 'synthetic-corpus/work/resynth')

    /** The pipeline's notes per benchmark run: `<resultId>.jsonl`, lines `{d,c,cond,notes}`. */
    static readonly runNotes = join(EvalPaths.harnessDir, '.cache/notes')
    /** The pipeline's notes per historical commit: `<short>.jsonl`, lines `{d,c,notes,ms,err}`, plus `<short>.summary.json`. */
    static readonly timelineNotes = join(EvalPaths.harnessDir, '.cache/timeline/notes')
    /** The timeline's plan (git-tracked): the sampled commits and the fixed clip set. */
    static readonly timelinePlan = join(EvalPaths.harnessDir, 'timeline')

    /**
     * The timeline: `index.json` + one `<commitDate>_<short>.json` per commit. EVAL_TIMELINE_DIR
     * points the app at another copy (a preview of a timeline still being built elsewhere).
     */
    static readonly timeline = process.env.EVAL_TIMELINE_DIR
        ? resolve(process.env.EVAL_TIMELINE_DIR)
        : join(EvalPaths.appDir, 'data/timeline')

    /**
     * One directory per benchmark kind. The results moved here from the harness on 2026-10-30;
     * a checkout from before the move still reads from the old place.
     */
    static benchmarks(kind: Exclude<RunKind, 'timeline'>): string {
        const current = join(EvalPaths.appDir, 'data/benchmarks', kind)
        if (existsSync(current)) return current
        return join(EvalPaths.harnessDir, 'benchmarks', kind === 'real' ? 'results' : 'results-synth')
    }

    private static findRepoRoot(): string {
        let dir = process.cwd()
        while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
            const parent = dirname(dir)
            if (parent === dir) throw new Error('could not locate the repo root (pnpm-workspace.yaml)')
            dir = parent
        }
        return dir
    }
}
