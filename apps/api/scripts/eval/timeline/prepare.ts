/**
 * Timeline step 1: materialise every sampled commit's pipeline as a runnable
 * tree, without a checkout or a per-commit install.
 *
 *   pnpm exec tsx scripts/eval/timeline/prepare.ts [--commits all|<short>,…] [--force]
 *
 * Per commit (commits.json), into the gitignored .cache/timeline/:
 *
 *   trees/<short>/                 `git archive` of apps/api/src (spec files dropped),
 *                                  apps/api/{package,tsconfig}.json, tsconfig.base.json
 *   trees/<short>/apps/api/model*  symlinks into models/<dir>-<git tree id>: weights are
 *                                  extracted once per distinct content (crepe-tiny's
 *                                  shards are byte-identical 04-26 → HEAD)
 *   trees/<short>/apps/api/node_modules
 *                                  → HEAD's apps/api/node_modules (commits after the
 *                                  basic-pitch deletion, 458b3a05), or
 *                                  → legacy/apps/api/node_modules: ONE install from the
 *                                  last lockfile that still had @spotify/basic-pitch
 *                                  (commits.json `legacyLockfileFrom`), offline from the
 *                                  pnpm store; online only if offline fails (reported)
 *   trees/<short>/apps/api/timeline-worker.ts   a copy of worker.ts
 *
 * Idempotent: a finished tree carries `.prepared.json` and is only refreshed
 * (worker copy, links); `--force` re-extracts. Every commits.json field is
 * verified against git first (sha, ancestry of HEAD, subject, date, era by
 * file layout, legacy deps by package.json), and a mismatch stops the run.
 * Dependency resolutions are identical from 2026-04-19 to HEAD (tfjs 4.22,
 * ffmpeg-static 5.3.0); see timeline/README.md.
 */

import { execFileSync, spawnSync } from 'child_process'
import {
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'fs'
import { createRequire } from 'module'
import { dirname, join, relative } from 'path'

import {
    API_DIR,
    type Era,
    LEGACY_DIR,
    loadCommitsFile,
    MODELS_DIR,
    REPO_ROOT,
    selectCommits,
    type TimelineCommit,
    TREE_MARKER,
    treeDir,
    TREES_DIR,
    WORKER_FILE,
    WORKER_TEMPLATE,
} from './timeline'

const TREE_PATHS = ['apps/api/src', 'apps/api/package.json', 'apps/api/tsconfig.json', 'tsconfig.base.json']
/** Model dirs resolved from process.cwd() (YAMNet from __dirname, which lands in the same place). */
const MODEL_DIRS = ['model', 'model-crepe-tiny', 'model-yamnet']
/** What the legacy install must resolve for the eras that run on it. */
const LEGACY_PROBES = ['@spotify/basic-pitch', '@tensorflow/tfjs', '@tensorflow/tfjs-backend-wasm', '@nestjs/common', 'ffmpeg-static']

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}

function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 })
        .toString()
        .trim()
}

function gitOk(...args: string[]): boolean {
    return spawnSync('git', args, { cwd: REPO_ROOT, stdio: 'ignore' }).status === 0
}

/** `git archive <treeish> [paths] | tar -x -C <dir>`. */
function extract(treeish: string, paths: string[], dir: string): void {
    mkdirSync(dir, { recursive: true })
    const archive = spawnSync('git', ['archive', '--format=tar', treeish, ...paths], {
        cwd: REPO_ROOT,
        maxBuffer: 1 << 30,
    })
    if (archive.status !== 0) throw new Error(`git archive ${treeish}: ${archive.stderr.toString()}`)
    const tar = spawnSync('tar', ['-x', '-C', dir], { input: archive.stdout })
    if (tar.status !== 0) throw new Error(`tar -x into ${dir}: ${tar.stderr.toString()}`)
}

/** The era a commit's file layout implies — the same tests worker.ts makes inside the tree. */
function eraOf(sha: string): Era | undefined {
    const files = new Set(git('ls-tree', '-r', '--name-only', sha, 'apps/api/src/recordings').split('\n'))
    const has = (f: string): boolean => files.has(`apps/api/src/recordings/${f}`)
    if (has('pipeline/recording-pipeline.ts')) return 'D'
    if (has('providers/ProviderRegistry.ts')) return 'C'
    if (has('AudioConverter.ts')) return 'B'
    if (has('BasicPitchModelLoader.ts')) return 'A'
    return undefined
}

function verify(c: TimelineCommit): void {
    const problems: string[] = []
    const full = gitOk('rev-parse', '--verify', '-q', `${c.sha}^{commit}`) ? git('rev-parse', `${c.sha}^{commit}`) : ''
    if (full !== c.sha) problems.push(`sha does not resolve (${full || 'missing'})`)
    else {
        if (!c.sha.startsWith(c.short)) problems.push(`short ${c.short} is not a prefix of the sha`)
        if (!gitOk('merge-base', '--is-ancestor', c.sha, 'HEAD')) problems.push('not an ancestor of HEAD')
        const [date, subject] = git('log', '-1', '--format=%cI%n%s', c.sha).split('\n')
        if (date !== c.date) problems.push(`date ${c.date} ≠ git ${date}`)
        if (subject !== c.subject) problems.push(`subject differs from git: ${subject}`)
        const era = eraOf(c.sha)
        if (era !== c.era) problems.push(`era ${c.era} ≠ layout ${era ?? 'unknown'}`)
        const legacy = git('show', `${c.sha}:apps/api/package.json`).includes('"@spotify/basic-pitch"')
        if (legacy !== c.needsLegacyDeps) problems.push(`needsLegacyDeps ${c.needsLegacyDeps} ≠ package.json ${legacy}`)
    }
    if (problems.length) throw new Error(`commits.json ${c.short}: ${problems.join('; ')}`)
}

/** A relative symlink `link → target`, replacing whatever was there. */
function link(target: string, linkPath: string): void {
    if (existsSync(linkPath) || isSymlink(linkPath)) {
        if (isSymlink(linkPath)) unlinkSync(linkPath)
        else throw new Error(`${linkPath} exists and is not a symlink`)
    }
    symlinkSync(relative(dirname(linkPath), target), linkPath)
}

function isSymlink(p: string): boolean {
    try {
        return lstatSync(p).isSymbolicLink()
    } catch {
        return false
    }
}

function removeSpecs(dir: string): number {
    let n = 0
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) n += removeSpecs(p)
        else if (/\.(spec|test)\.ts$/.test(e.name)) {
            unlinkSync(p)
            n += 1
        }
    }
    return n
}

function duKb(dir: string): number {
    const r = spawnSync('du', ['-sk', dir])
    return Number(r.stdout.toString().split('\t')[0]) || 0
}

/** One shared copy per distinct model dir content, keyed by its git tree id. */
function ensureModelDir(sha: string, dir: string): string | undefined {
    const spec = `${sha}:apps/api/${dir}`
    if (!gitOk('rev-parse', '--verify', '-q', spec)) return undefined
    const id = git('rev-parse', spec)
    const target = join(MODELS_DIR, `${dir}-${id.slice(0, 12)}`)
    if (!existsSync(target)) {
        const tmp = `${target}.tmp-${process.pid}`
        rmSync(tmp, { recursive: true, force: true })
        extract(id, [], tmp)
        renameSync(tmp, target)
    }
    return target
}

// ---------------------------------------------------------------------------
// the legacy install
// ---------------------------------------------------------------------------

function legacyReady(from: string): boolean {
    const marker = join(LEGACY_DIR, TREE_MARKER)
    if (!existsSync(marker)) return false
    return (JSON.parse(readFileSync(marker, 'utf8')) as { from: string }).from === from
}

/** The env for the nested pnpm: ours, minus whatever an outer `pnpm exec` exported about ITS project. */
function pnpmEnv(): NodeJS.ProcessEnv {
    return Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^npm_(config|package|lifecycle)_/i.test(k)))
}

function ensureLegacy(from: string): void {
    if (legacyReady(from)) {
        console.log(`legacy install: ready (${relative(REPO_ROOT, LEGACY_DIR)})`)
        return
    }
    if (!git('show', `${from}:apps/api/package.json`).includes('"@spotify/basic-pitch"')) {
        throw new Error(`legacyLockfileFrom ${from} has no @spotify/basic-pitch`)
    }
    console.log(`legacy install: workspace manifests + lockfile from ${from.slice(0, 8)}`)
    rmSync(LEGACY_DIR, { recursive: true, force: true })
    const manifests = git('ls-tree', '-r', '--name-only', from)
        .split('\n')
        .filter((f) => /^(apps|packages)\/[^/]+\/package\.json$/.test(f))
    // inference-proto is a workspace dependency of the API: its files, not just its manifest.
    extract(from, ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'packages/inference-proto', ...manifests], LEGACY_DIR)

    const install = (mode: 'offline' | 'online'): boolean => {
        const args = [
            'install',
            '--frozen-lockfile',
            '--filter',
            '@mushee/api...',
            ...(mode === 'offline' ? ['--offline'] : ['--prefer-offline']),
        ]
        console.log(`  pnpm ${args.join(' ')}`)
        const t0 = Date.now()
        const r = spawnSync('pnpm', args, { cwd: LEGACY_DIR, env: pnpmEnv(), stdio: 'inherit' })
        console.log(`  → exit ${r.status} in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
        return r.status === 0
    }
    let mode: 'offline' | 'online' = 'offline'
    if (!install('offline')) {
        console.warn('legacy install: OFFLINE INSTALL FAILED — retrying online (--prefer-offline)')
        mode = 'online'
        if (!install('online')) throw new Error('legacy install failed offline and online')
    }

    const req = createRequire(join(LEGACY_DIR, 'apps/api/package.json'))
    const resolved = Object.fromEntries(LEGACY_PROBES.map((p) => [p, relative(LEGACY_DIR, req.resolve(p))]))
    writeFileSync(
        join(LEGACY_DIR, TREE_MARKER),
        JSON.stringify({ from, mode, resolved, preparedAt: new Date().toISOString() }, null, 4) + '\n',
    )
    console.log(`legacy install: done (${mode}), ${(duKb(LEGACY_DIR) / 1024).toFixed(0)} MB on disk (store hard links count once)`)
}

// ---------------------------------------------------------------------------
// trees
// ---------------------------------------------------------------------------

function prepareTree(c: TimelineCommit, force: boolean): void {
    const dir = treeDir(c)
    const marker = join(dir, TREE_MARKER)
    const fresh = force || !existsSync(marker) || (JSON.parse(readFileSync(marker, 'utf8')) as { sha: string }).sha !== c.sha
    if (fresh) {
        rmSync(dir, { recursive: true, force: true })
        const tmp = join(TREES_DIR, `.${c.short}.tmp-${process.pid}`)
        rmSync(tmp, { recursive: true, force: true })
        const paths = TREE_PATHS.filter((p) => git('ls-tree', '--name-only', c.sha, p) !== '')
        extract(c.sha, paths, tmp)
        const specs = removeSpecs(join(tmp, 'apps/api/src'))
        const models: Record<string, string> = {}
        for (const m of MODEL_DIRS) {
            const target = ensureModelDir(c.sha, m)
            if (!target) continue
            link(target, join(tmp, 'apps/api', m))
            models[m] = relative(MODELS_DIR, target)
        }
        writeFileSync(
            join(tmp, TREE_MARKER),
            JSON.stringify(
                { sha: c.sha, era: c.era, deps: c.needsLegacyDeps ? 'legacy' : 'head', paths, models, specsDropped: specs },
                null,
                4,
            ) + '\n',
        )
        renameSync(tmp, dir)
    }
    // Always refreshed, so a changed worker template or a rebuilt install reaches every tree.
    link(c.needsLegacyDeps ? join(LEGACY_DIR, 'apps/api/node_modules') : join(API_DIR, 'node_modules'), join(dir, 'apps/api/node_modules'))
    copyFileSync(WORKER_TEMPLATE, join(dir, 'apps/api', WORKER_FILE))
    console.log(
        `  ${c.short}  era ${c.era}  deps ${c.needsLegacyDeps ? 'legacy' : 'HEAD  '}  ${fresh ? 'extracted' : 'refreshed'}  ` +
            `${(duKb(dir) / 1024).toFixed(1)} MB  ${c.date.slice(0, 10)}  ${c.subject.slice(0, 60)}`,
    )
}

function main(): void {
    const force = process.argv.includes('--force')
    const commits = selectCommits(arg('commits'))
    const { legacyLockfileFrom } = loadCommitsFile()
    for (const c of commits) verify(c)
    console.log(`verified ${commits.length} commits against git (sha, ancestry, date, subject, era, deps)`)

    mkdirSync(TREES_DIR, { recursive: true })
    mkdirSync(MODELS_DIR, { recursive: true })
    if (commits.some((c) => c.needsLegacyDeps)) ensureLegacy(legacyLockfileFrom)
    if (!existsSync(join(API_DIR, 'node_modules')) || !statSync(join(API_DIR, 'node_modules')).isDirectory()) {
        throw new Error(`${API_DIR}/node_modules missing — run pnpm install in the repo first`)
    }
    for (const c of commits) prepareTree(c, force)
    console.log(`trees in ${relative(REPO_ROOT, TREES_DIR)}; shared model dirs ${(duKb(MODELS_DIR) / 1024).toFixed(1)} MB`)
}

main()
