/**
 * Re-runnable entry point for the frame-level pitch-model comparison
 * (CREPE-tiny — what we ship — vs SwiftF0 vs HarmoF0) on OUR corpora.
 *
 * All the measurement lives in `scripts/eval/bench_pitch_models.py`; this file
 * provisions the Python side and prints the tables, so the whole comparison is
 * one command:
 *
 *   npx tsx scripts/eval/bench-pitch-models.ts                 # everything (~40 min)
 *   npx tsx scripts/eval/bench-pitch-models.ts --setup-only    # just build the venv
 *   BENCH_LIMIT=3 npx tsx scripts/eval/bench-pitch-models.ts   # 3 clips/dataset smoke run
 *   BENCH_MODELS=swiftf0 BENCH_TIERS=probe npx tsx scripts/eval/bench-pitch-models.ts
 *   npx tsx scripts/eval/bench-pitch-models.ts --report-only   # re-print from cached JSON
 *
 * NO new devDependency is added to package.json — the Python side is a venv.
 *
 * Environments (created/checked here, never committed):
 *   .venv-pitchbench  NEW venv (uv, py3.12): swift-f0 (bundles a 398 KB ONNX),
 *                     torch + torchaudio, numpy, scipy, plus a shallow clone of
 *                     github.com/WX-Wei/HarmoF0 (MIT) under src/HarmoF0 because
 *                     its own `pip install` is broken on py>=3.10.
 *   .venv-crepe       EXISTING venv, used read-only (PYTHONDONTWRITEBYTECODE=1)
 *                     for the CREPE-tiny reference implementation.
 *
 * Results land in scripts/eval/assets/pitch-model-bench/*.json — `assets/` is already
 * gitignored, so nothing here is committable.
 *
 * The real tier is pinned to the documented 588-clip corpus (annotated-vocalset,
 * guitarset-solo, mir-qbsh, urmp-*, vocadito); other dataset dirs that appear under
 * fixtures/eval-real are skipped, since a model measured on a different clip set is
 * not comparable. See CANON_REAL in the Python companion.
 */

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const API_ROOT = resolve(__dirname, '../..')
const BENCH_PY = resolve(__dirname, 'bench_pitch_models.py')
const VENV = resolve(API_ROOT, '.venv-pitchbench')
const VENV_PY = resolve(VENV, 'bin/python')
const CREPE_PY = resolve(API_ROOT, '.venv-crepe/bin/python')
const HARMO_REPO = resolve(VENV, 'src/HarmoF0')
const OUT_DIR = resolve(__dirname, 'assets/pitch-model-bench')

/** Which interpreter can run which model. */
const RUNNERS: Record<string, { py: () => string; models: string[] }> = {
    crepe: { py: () => CREPE_PY, models: ['crepe-tiny', 'crepe-tiny-viterbi'] },
    swift: { py: () => VENV_PY, models: ['swiftf0'] },
    harmo: { py: () => VENV_PY, models: ['harmof0'] },
}

/** Single-thread everything so the CPU-per-second-of-audio numbers compare. */
const SINGLE_THREAD_ENV = {
    OMP_NUM_THREADS: '1',
    MKL_NUM_THREADS: '1',
    OPENBLAS_NUM_THREADS: '1',
    VECLIB_MAXIMUM_THREADS: '1',
    NUMEXPR_NUM_THREADS: '1',
    TF_NUM_INTRAOP_THREADS: '1',
    TF_NUM_INTEROP_THREADS: '1',
    TF_CPP_MIN_LOG_LEVEL: '3',
    PYTHONDONTWRITEBYTECODE: '1',
}

function run(cmd: string, args: string[], env: Record<string, string> = {}): void {
    execFileSync(cmd, args, {
        cwd: API_ROOT,
        stdio: 'inherit',
        env: { ...process.env, ...SINGLE_THREAD_ENV, ...env },
    })
}

function setup(): void {
    if (!existsSync(VENV_PY)) {
        console.log('[setup] creating .venv-pitchbench (uv, python 3.12)')
        run('uv', ['venv', '--python', '3.12', VENV])
        // Keep the venv invisible to git without touching the repo .gitignore.
        writeFileSync(resolve(VENV, '.gitignore'), '*\n')
    }
    console.log('[setup] installing python deps')
    run('uv', ['pip', 'install', 'numpy', 'scipy', 'swift-f0', 'torch', 'torchaudio'], {
        VIRTUAL_ENV: VENV,
    })
    if (!existsSync(resolve(HARMO_REPO, 'harmof0/network.py'))) {
        console.log('[setup] cloning WX-Wei/HarmoF0 (MIT) — pip install is broken on py>=3.10')
        run('git', ['clone', '--depth', '1', 'https://github.com/WX-Wei/HarmoF0.git', HARMO_REPO])
    }
    if (!existsSync(CREPE_PY)) {
        console.warn(`[setup] WARNING: ${CREPE_PY} missing — CREPE-tiny cannot be measured`)
    }
}

function main(): void {
    const args = process.argv.slice(2)
    const reportOnly = args.includes('--report-only')
    const setupOnly = args.includes('--setup-only')
    const models = (process.env.BENCH_MODELS ?? 'crepe-tiny,crepe-tiny-viterbi,swiftf0,harmof0').split(',').filter(Boolean)
    const tiers = (process.env.BENCH_TIERS ?? 'real,probe').split(',').filter(Boolean)
    const limit = process.env.BENCH_LIMIT ?? '0'

    if (!reportOnly) setup()
    if (setupOnly) return

    mkdirSync(OUT_DIR, { recursive: true })
    const outputs: string[] = []

    for (const tier of tiers) {
        for (const [key, runner] of Object.entries(RUNNERS)) {
            const wanted = runner.models.filter((m) => models.includes(m))
            if (wanted.length === 0) continue
            const out = resolve(OUT_DIR, `${tier}-${key}.json`)
            outputs.push(out)
            if (reportOnly) continue
            console.log(`\n[bench] ${tier} :: ${wanted.join(',')}`)
            run(runner.py(), [BENCH_PY, '--models', wanted.join(','), '--tier', tier, '--limit', limit, '--out', out])
        }
    }

    const present = outputs.filter((p) => existsSync(p))
    for (const variant of ['all', 'core']) {
        console.log(`\n\n================ variant=${variant} ================`)
        run(VENV_PY, [BENCH_PY, '--aggregate', ...present, '--variant', variant])
    }
}

main()
