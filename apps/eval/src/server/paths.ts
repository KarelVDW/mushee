/**
 * Everything in this app that touches disk goes through here. The app is
 * local-first by design: corpora materialize into the SAME fixtures tree the
 * script harness reads (apps/api/scripts/fixtures/eval-real), so UI-created
 * corpora are visible to run-eval.ts and the agents with no export step.
 */

import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'

function findRepoRoot(): string {
    let dir = process.cwd()
    while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
        const parent = dirname(dir)
        if (parent === dir) throw new Error('could not locate the repo root (pnpm-workspace.yaml)')
        dir = parent
    }
    return dir
}

export const REPO_ROOT = findRepoRoot()
export const API_DIR = resolve(REPO_ROOT, 'apps/api')
export const EVAL_SCRIPTS_DIR = join(API_DIR, 'scripts/eval')
export const FIXTURES_DIR = join(API_DIR, 'scripts/fixtures')
export const SYNTH_ROOT = join(FIXTURES_DIR, 'eval')
export const REAL_ROOT = join(FIXTURES_DIR, 'eval-real')

/** tsx from the API workspace, so worker spawns run with the API's deps. */
export const API_TSX_BIN = join(API_DIR, 'node_modules/.bin/tsx')
